/* Grammar Duel: Learn mode (Duolingo-style path, hearts, XP, streaks, leaderboard) and the content CMS.
 * Included from main.c, so it shares its helpers (db_*, reply_*, lint_cached, ...).
 *
 * Content: units -> lessons -> challenges. A challenge is either
 *   "fix"    a text with mistakes; Harper checks the answer (its issues are stored when the challenge is saved)
 *   "choose" a question with options, exactly one correct
 */

#define MAX_HEARTS 5
#define HEART_REGEN_MS (30LL * 60 * 1000) /* one heart back every 30 minutes */
#define XP_PER_CHALLENGE 10

static const char *LEARN_SCHEMA =
    "CREATE TABLE IF NOT EXISTS units ("
    "  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);"
    "CREATE TABLE IF NOT EXISTS lessons ("
    "  id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE, title TEXT NOT NULL,"
    "  position INTEGER NOT NULL DEFAULT 0);"
    "CREATE TABLE IF NOT EXISTS challenges ("
    "  id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,"
    "  type TEXT NOT NULL CHECK (type IN ('fix', 'choose')), question TEXT NOT NULL, text TEXT, lints_json TEXT,"
    "  position INTEGER NOT NULL DEFAULT 0);"
    "CREATE TABLE IF NOT EXISTS challenge_options ("
    "  id INTEGER PRIMARY KEY, challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE, text TEXT NOT NULL,"
    "  correct INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0);"
    "CREATE TABLE IF NOT EXISTS challenge_progress ("
    "  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
    "  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,"
    "  completed_at INTEGER NOT NULL, PRIMARY KEY (user_id, challenge_id));"
    "CREATE TABLE IF NOT EXISTS xp_events ("
    "  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, xp INTEGER NOT NULL,"
    "  at INTEGER NOT NULL);"
    "CREATE INDEX IF NOT EXISTS xp_events_user_at ON xp_events(user_id, at);"
    "CREATE INDEX IF NOT EXISTS xp_events_at ON xp_events(at);"
    "CREATE INDEX IF NOT EXISTS lessons_unit ON lessons(unit_id);"
    "CREATE INDEX IF NOT EXISTS challenges_lesson ON challenges(lesson_id);"
    "CREATE INDEX IF NOT EXISTS options_challenge ON challenge_options(challenge_id);"
    "CREATE TABLE IF NOT EXISTS unit_feedback ("
    "  id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,"
    "  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, rating INTEGER, category TEXT, text TEXT NOT NULL,"
    "  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')), created_at INTEGER NOT NULL);"
    "CREATE INDEX IF NOT EXISTS unit_feedback_unit ON unit_feedback(unit_id, status);";

/* Columns added to users after the first release (ignored if they already exist). */
static const char *USER_COLUMNS[] = {
    "ALTER TABLE users ADD COLUMN hearts INTEGER NOT NULL DEFAULT 5",
    "ALTER TABLE users ADD COLUMN hearts_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
};

static char s_admins[1024]; /* comma-separated, lowercase: emails, or dev:<name> for guest logins */

/* ---------------------------------------------------------------- setup */

static char *read_file(const char *path) {
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) return NULL;
  fseek(fp, 0, SEEK_END);
  long n = ftell(fp);
  fseek(fp, 0, SEEK_SET);
  char *buf = n >= 0 ? malloc((size_t) n + 1) : NULL;
  if (buf != NULL && fread(buf, 1, (size_t) n, fp) == (size_t) n) buf[n] = '\0';
  else {
    free(buf);
    buf = NULL;
  }
  fclose(fp);
  return buf;
}

/* Harper's issues for a "fix" text, as malloc'd JSON, or NULL if there are none (the text can't be graded). */
static char *fix_lints(const char *text) {
  char *lints = lint_cached(text);
  if (lints != NULL && strcmp(lints, "[]") == 0) {
    free(lints);
    return NULL;
  }
  return lints;
}

/* Loads the starter content the first time the server runs (when there are no units). */
static void learn_seed(const char *path) {
  if (db_int(0, "SELECT COUNT(*) FROM units", "") > 0) return;
  char *json = read_file(path);
  if (json == NULL) {
    MG_INFO(("no starter content at %s", path));
    return;
  }
  struct mg_str s = mg_str(json);
  int units = 0, challenges = 0;
  char p[160];
  for (int u = 0;; u++) {
    snprintf(p, sizeof(p), "$.units[%d].title", u);
    char *title = mg_json_get_str(s, p);
    if (title == NULL) break;
    snprintf(p, sizeof(p), "$.units[%d].description", u);
    char *desc = mg_json_get_str(s, p);
    db_exec("INSERT INTO units (title, description, position) VALUES (?, ?, ?)", "ssi", title, desc != NULL ? desc : "", (long long) u);
    long long unit_id = sqlite3_last_insert_rowid(s_db);
    units++;
    free(title);
    free(desc);
    for (int l = 0;; l++) {
      snprintf(p, sizeof(p), "$.units[%d].lessons[%d].title", u, l);
      char *ltitle = mg_json_get_str(s, p);
      if (ltitle == NULL) break;
      db_exec("INSERT INTO lessons (unit_id, title, position) VALUES (?, ?, ?)", "isi", unit_id, ltitle, (long long) l);
      long long lesson_id = sqlite3_last_insert_rowid(s_db);
      free(ltitle);
      for (int k = 0;; k++) {
        snprintf(p, sizeof(p), "$.units[%d].lessons[%d].challenges[%d].type", u, l, k);
        char *type = mg_json_get_str(s, p);
        if (type == NULL) break;
        snprintf(p, sizeof(p), "$.units[%d].lessons[%d].challenges[%d].question", u, l, k);
        char *question = mg_json_get_str(s, p);
        snprintf(p, sizeof(p), "$.units[%d].lessons[%d].challenges[%d].text", u, l, k);
        char *text = mg_json_get_str(s, p);
        char *lints = (strcmp(type, "fix") == 0 && text != NULL) ? fix_lints(text) : NULL;
        if (strcmp(type, "fix") == 0 && lints == NULL) {
          MG_ERROR(("seed: Harper finds nothing to fix in \"%s\", skipped", text != NULL ? text : ""));
        } else {
          db_exec("INSERT INTO challenges (lesson_id, type, question, text, lints_json, position) VALUES (?, ?, ?, ?, ?, ?)", "issssi", lesson_id, type,
                  question != NULL ? question : "", text, lints, (long long) k);
          long long challenge_id = sqlite3_last_insert_rowid(s_db);
          challenges++;
          for (int o = 0; strcmp(type, "choose") == 0; o++) {
            snprintf(p, sizeof(p), "$.units[%d].lessons[%d].challenges[%d].options[%d].text", u, l, k, o);
            char *otext = mg_json_get_str(s, p);
            if (otext == NULL) break;
            snprintf(p, sizeof(p), "$.units[%d].lessons[%d].challenges[%d].options[%d].correct", u, l, k, o);
            bool correct = false;
            mg_json_get_bool(s, p, &correct);
            db_exec("INSERT INTO challenge_options (challenge_id, text, correct, position) VALUES (?, ?, ?, ?)", "isii", challenge_id, otext,
                    (long long) correct, (long long) o);
            free(otext);
          }
        }
        free(type);
        free(question);
        free(text);
        free(lints);
      }
    }
  }
  free(json);
  MG_INFO(("loaded starter content: %d units, %d challenges", units, challenges));
}

static void learn_init(const char *seed_path, const char *admins) {
  if (sqlite3_exec(s_db, LEARN_SCHEMA, NULL, NULL, NULL) != SQLITE_OK) MG_ERROR(("learn schema: %s", sqlite3_errmsg(s_db)));
  for (size_t i = 0; i < sizeof(USER_COLUMNS) / sizeof(USER_COLUMNS[0]); i++) sqlite3_exec(s_db, USER_COLUMNS[i], NULL, NULL, NULL);
  size_t n = 0;
  for (const char *a = admins; *a && n + 1 < sizeof(s_admins); a++)
    if (*a != ' ') s_admins[n++] = (char) ((*a >= 'A' && *a <= 'Z') ? *a + 32 : *a);
  s_admins[n] = '\0';
  learn_seed(seed_path);
}

/* Whether `key` (an email, or dev:<name>) is in ADMINS. */
static int admin_key_listed(const char *key) {
  if (key == NULL || !*key || !s_admins[0]) return 0;
  size_t klen = strlen(key);
  for (const char *p = s_admins; *p;) {
    const char *end = strchr(p, ',');
    size_t len = end != NULL ? (size_t) (end - p) : strlen(p);
    if (len == klen && strncasecmp(p, key, len) == 0) return 1;
    if (end == NULL) break;
    p = end + 1;
  }
  return 0;
}

/* Whether the user is an admin right now, checked against ADMINS on every call (so removing someone
 * from ADMINS takes effect immediately). Keeps the stored is_admin flag in step for display. */
static int is_admin(long long uid) {
  char *key = db_text("SELECT CASE provider WHEN 'google' THEN COALESCE(email, '') ELSE 'dev:' || subject END FROM users WHERE id = ?", "i", uid);
  int admin = admin_key_listed(key);
  free(key);
  db_exec("UPDATE users SET is_admin = ? WHERE id = ? AND is_admin <> ?", "iii", (long long) admin, uid, (long long) admin);
  return admin;
}

/* ---------------------------------------------------------------- hearts, XP, streak */

/* Current hearts, after giving back the ones regenerated since `hearts_at`. */
static int hearts_now(long long uid, long long *next_ms) {
  long long now = now_ms();
  long long hearts = db_int(MAX_HEARTS, "SELECT hearts FROM users WHERE id = ?", "i", uid);
  long long at = db_int(0, "SELECT hearts_at FROM users WHERE id = ?", "i", uid);
  if (hearts < MAX_HEARTS) {
    long long gained = (now - at) / HEART_REGEN_MS;
    if (gained > 0) {
      hearts = hearts + gained >= MAX_HEARTS ? MAX_HEARTS : hearts + gained;
      at = hearts >= MAX_HEARTS ? now : at + gained * HEART_REGEN_MS;
      db_exec("UPDATE users SET hearts = ?, hearts_at = ? WHERE id = ?", "iii", hearts, at, uid);
    }
  }
  if (next_ms != NULL) *next_ms = hearts < MAX_HEARTS ? HEART_REGEN_MS - (now - at) : 0;
  return (int) hearts;
}

static void set_hearts(long long uid, int hearts) {
  if (hearts < 0) hearts = 0;
  if (hearts > MAX_HEARTS) hearts = MAX_HEARTS;
  /* Start the regeneration clock when dropping below full. */
  db_exec("UPDATE users SET hearts_at = CASE WHEN hearts >= ? THEN ? ELSE hearts_at END, hearts = ? WHERE id = ?", "iiii", (long long) MAX_HEARTS,
          now_ms(), (long long) hearts, uid);
}

static int streak_days(long long uid) {
  sqlite3_stmt *st = NULL;
  if (sqlite3_prepare_v2(s_db,
                         "SELECT DISTINCT CAST(julianday(date(at / 1000, 'unixepoch')) AS INTEGER) AS d FROM xp_events WHERE user_id = ?"
                         " ORDER BY d DESC",
                         -1, &st, NULL) != SQLITE_OK)
    return 0;
  sqlite3_bind_int64(st, 1, uid);
  long long today = db_int(0, "SELECT CAST(julianday(date('now')) AS INTEGER)", "");
  int streak = 0;
  long long expect = today;
  while (sqlite3_step(st) == SQLITE_ROW) {
    long long d = sqlite3_column_int64(st, 0);
    if (streak == 0 && d == today - 1) expect = today - 1; /* today's lesson not done yet: the streak is still alive */
    if (d != expect) break;
    streak++;
    expect--;
  }
  sqlite3_finalize(st);
  return streak;
}

#define WEEK_START_MS "CAST(strftime('%s', date('now', 'weekday 0', '-6 days')) AS INTEGER) * 1000"

static char *stats_json(long long uid) {
  long long next = 0;
  int hearts = hearts_now(uid, &next);
  long long xp = db_int(0, "SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE user_id = ?", "i", uid);
  long long week = db_int(0, "SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE user_id = ? AND at >= " WEEK_START_MS, "i", uid);
  return mg_mprintf("{\"xp\":%lld,\"weekXp\":%lld,\"hearts\":%d,\"maxHearts\":%d,\"nextHeartMs\":%lld,\"streak\":%d}", xp, week, hearts, MAX_HEARTS,
                    next, streak_days(uid));
}

/* ---------------------------------------------------------------- learner API */

static void reply_learn_path(struct mg_connection *c, long long uid) {
  char *units = db_text(
      "SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'description', u.description,"
      "  'feedbackSent', json(CASE WHEN EXISTS (SELECT 1 FROM unit_feedback f WHERE f.unit_id = u.id AND f.user_id = ?1) THEN 'true' ELSE 'false' END),"
      "  'lessons',"
      "  (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title,"
      "     'total', (SELECT COUNT(*) FROM challenges c WHERE c.lesson_id = l.id),"
      "     'done', (SELECT COUNT(*) FROM challenges c JOIN challenge_progress p ON p.challenge_id = c.id AND p.user_id = ?1"
      "              WHERE c.lesson_id = l.id)) AS y"
      "   FROM lessons l WHERE l.unit_id = u.id ORDER BY l.position, l.id))) AS x"
      " FROM units u ORDER BY u.position, u.id)",
      "i", uid);
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"units\":%s,\"stats\":%s}", units != NULL ? units : "[]", stats);
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(units);
}

static void reply_lesson(struct mg_connection *c, long long uid, long long lesson_id) {
  char *lesson = db_text(
      "SELECT json_object('id', l.id, 'title', l.title, 'unitId', u.id, 'unitTitle', u.title, 'challenges',"
      "  (SELECT json_group_array(json(x)) FROM (SELECT json_object('id', c.id, 'type', c.type, 'question', c.question, 'text', c.text,"
      "     'marks', (SELECT json_group_array(json_object('start16', json_extract(v.value, '$.start16'), 'end16', json_extract(v.value, '$.end16')))"
      "               FROM json_each(COALESCE(c.lints_json, '[]')) v),"
      "     'options', (SELECT json_group_array(json_object('id', o.id, 'text', o.text))"
      "                 FROM (SELECT * FROM challenge_options o WHERE o.challenge_id = c.id ORDER BY o.position, o.id) o),"
      "     'completed', json(CASE WHEN EXISTS (SELECT 1 FROM challenge_progress p WHERE p.challenge_id = c.id AND p.user_id = ?2)"
      "                         THEN 'true' ELSE 'false' END)) AS x"
      "   FROM challenges c WHERE c.lesson_id = l.id ORDER BY c.position, c.id)))"
      " FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.id = ?1",
      "ii", lesson_id, uid);
  if (lesson == NULL) return reply_error(c, 404, "No such lesson");
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"lesson\":%s,\"stats\":%s}", lesson, stats);
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(lesson);
}

/* Checks one answer. Correct: +XP (and +1 heart when practising a finished challenge). Wrong: -1 heart. */
static void answer_challenge(struct mg_connection *c, struct mg_http_message *hm, long long uid, long long cid) {
  char *type = db_text("SELECT type FROM challenges WHERE id = ?", "i", cid);
  if (type == NULL) return reply_error(c, 404, "No such challenge");
  int practice = db_int(0, "SELECT 1 FROM challenge_progress WHERE user_id = ? AND challenge_id = ?", "ii", uid, cid) == 1;
  int hearts = hearts_now(uid, NULL);
  if (!practice && hearts <= 0) {
    free(type);
    return mg_http_reply(c, 403, "Content-Type: application/json\r\nCache-Control: no-store\r\n", "{%m:%m,%m:0}", MG_ESC("error"),
                         MG_ESC("You're out of hearts. Practise a finished lesson or wait for a heart to come back."), MG_ESC("hearts"));
  }

  int correct = 0;
  char *extra = NULL; /* type-specific feedback fields, as ,"key":value pairs */
  if (strcmp(type, "choose") == 0) {
    long long chosen = mg_json_get_long(hm->body, "$.optionId", -1);
    correct = db_int(0, "SELECT correct FROM challenge_options WHERE id = ? AND challenge_id = ?", "ii", chosen, cid) == 1;
    long long right = db_int(-1, "SELECT id FROM challenge_options WHERE challenge_id = ? AND correct = 1", "i", cid);
    extra = mg_mprintf(",\"correctOptionId\":%lld", right);
  } else {
    char *answer = mg_json_get_str(hm->body, "$.text");
    char *original = db_text("SELECT text FROM challenges WHERE id = ?", "i", cid);
    char *lints = db_text("SELECT lints_json FROM challenges WHERE id = ?", "i", cid);
    if (answer == NULL || original == NULL || lints == NULL || utf8_len(answer) > MAX_TEXT) {
      free(answer);
      free(original);
      free(lints);
      free(type);
      return reply_error(c, 400, "Send your corrected text");
    }
    clean_text(answer);
    char *result = duel_score(original, lints, answer);
    char *solution = duel_solution(original, lints);
    if (result == NULL || solution == NULL) {
      duel_free(result);
      duel_free(solution);
      free(answer);
      free(original);
      free(lints);
      free(type);
      return reply_error(c, 500, "Couldn't check your answer");
    }
    long total = mg_json_get_long(mg_str(result), "$.total", 0);
    long fixed = mg_json_get_long(mg_str(result), "$.fixed", 0);
    int rlen = 0, ilen = 0;
    int roff = mg_json_get(mg_str(result), "$.remaining", &rlen);
    int ioff = mg_json_get(mg_str(result), "$.introduced", &ilen);
    correct = fixed == total && ilen <= 2; /* "[]" */
    extra = mg_mprintf(",\"fixed\":%ld,\"total\":%ld,\"remaining\":%.*s,\"introduced\":%.*s,%m:%m", fixed, total, roff < 0 ? 2 : rlen,
                       roff < 0 ? "[]" : result + roff, ioff < 0 ? 2 : ilen, ioff < 0 ? "[]" : result + ioff, MG_ESC("solution"), MG_ESC(solution));
    duel_free(result);
    duel_free(solution);
    free(answer);
    free(original);
    free(lints);
  }

  int xp = 0;
  if (correct) {
    xp = XP_PER_CHALLENGE;
    db_exec("INSERT OR IGNORE INTO challenge_progress (user_id, challenge_id, completed_at) VALUES (?, ?, ?)", "iii", uid, cid, now_ms());
    db_exec("INSERT INTO xp_events (user_id, xp, at) VALUES (?, ?, ?)", "iii", uid, (long long) xp, now_ms());
    if (practice) set_hearts(uid, hearts + 1);
  } else if (!practice) {
    set_hearts(uid, hearts - 1);
  }
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"correct\":%s,\"practice\":%s,\"xp\":%d,\"stats\":%s%s}", correct ? "true" : "false", practice ? "true" : "false", xp,
                          stats, extra != NULL ? extra : "");
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(extra);
  free(type);
}

static void reply_leaderboard(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  char period[8] = "week";
  mg_http_get_var(&hm->query, "period", period, sizeof(period));
  int all = strcmp(period, "all") == 0;
  long long since = all ? 0 : db_int(0, "SELECT " WEEK_START_MS, "");
  char *board = db_text(
      "WITH s AS (SELECT u.id, u.name, u.picture, SUM(x.xp) AS xp FROM users u JOIN xp_events x ON x.user_id = u.id AND x.at >= ?1 GROUP BY u.id),"
      " r AS (SELECT *, RANK() OVER (ORDER BY xp DESC) AS rank FROM s)"
      " SELECT json_object('period', ?3, 'rows',"
      "  (SELECT json_group_array(json_object('rank', rank, 'name', name, 'picture', picture, 'xp', xp,"
      "     'isYou', json(CASE WHEN id = ?2 THEN 'true' ELSE 'false' END))) FROM (SELECT * FROM r ORDER BY rank, name LIMIT 20)),"
      "  'me', (SELECT json_object('rank', rank, 'xp', xp) FROM r WHERE id = ?2))",
      "iis", since, uid, all ? "all" : "week");
  reply_json(c, 200, board != NULL ? board : "{\"rows\":[],\"me\":null}", NULL);
  free(board);
}

static char *body_str(struct mg_http_message *hm, const char *path, size_t max_chars);

static const char *FEEDBACK_CATEGORIES[] = {"too-easy", "too-hard", "mistake", "idea"};

static void send_feedback(struct mg_connection *c, struct mg_http_message *hm, long long uid, long long unit_id) {
  if (db_int(0, "SELECT COUNT(*) FROM units WHERE id = ?", "i", unit_id) == 0) return reply_error(c, 404, "No such unit");
  /* A light limit against spam: 5 suggestions per unit per player per day. */
  if (db_int(0, "SELECT COUNT(*) FROM unit_feedback WHERE unit_id = ? AND user_id = ? AND created_at > ?", "iii", unit_id, uid, now_ms() - 86400000LL) >= 5)
    return reply_error(c, 429, "Thanks! You've sent a lot of suggestions for this unit today. Try again tomorrow.");
  char *text = body_str(hm, "$.text", 1000);
  if (text == NULL) return reply_error(c, 400, "Tell us what should change");
  long long rating = mg_json_get_long(hm->body, "$.rating", 0);
  char *category = body_str(hm, "$.category", 20);
  int known = 0;
  for (size_t i = 0; category != NULL && i < sizeof(FEEDBACK_CATEGORIES) / sizeof(FEEDBACK_CATEGORIES[0]); i++) known |= strcmp(category, FEEDBACK_CATEGORIES[i]) == 0;
  db_exec("INSERT INTO unit_feedback (unit_id, user_id, rating, category, text, created_at) VALUES (?, ?, NULLIF(?, 0), ?, ?, ?)", "iiissi", unit_id, uid,
          rating >= 1 && rating <= 5 ? rating : 0LL, known ? category : NULL, text, now_ms());
  free(text);
  free(category);
  reply_json(c, 201, "{\"ok\":true}", NULL);
}

/* Returns 1 if it handled the request. */
static int handle_learn(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  struct mg_str caps[2];
  if (method_is(hm, "GET") && uri_is(hm, "/api/learn")) {
    reply_learn_path(c, uid);
    return 1;
  }
  if (method_is(hm, "GET") && uri_is(hm, "/api/leaderboard")) {
    reply_leaderboard(c, hm, uid);
    return 1;
  }
  if (method_is(hm, "GET") && mg_match(hm->uri, mg_str("/api/learn/lessons/*"), caps)) {
    reply_lesson(c, uid, strtoll(caps[0].buf, NULL, 10));
    return 1;
  }
  if (method_is(hm, "POST") && mg_match(hm->uri, mg_str("/api/learn/units/*/feedback"), caps)) {
    if (require_json(c, hm)) send_feedback(c, hm, uid, strtoll(caps[0].buf, NULL, 10));
    return 1;
  }
  if (method_is(hm, "POST") && mg_match(hm->uri, mg_str("/api/learn/challenges/*/answer"), caps)) {
    if (require_json(c, hm)) answer_challenge(c, hm, uid, strtoll(caps[0].buf, NULL, 10));
    return 1;
  }
  return 0;
}

/* ---------------------------------------------------------------- CMS (admins only) */

static char *admin_content_json(void) {
  return db_text(
      "SELECT json_object('units', (SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title,"
      " 'newFeedback', (SELECT COUNT(*) FROM unit_feedback f WHERE f.unit_id = u.id AND f.status = 'new'),"
      " 'description', u.description, 'lessons', (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title,"
      "   'challenges', (SELECT json_group_array(json(z)) FROM (SELECT json_object('id', c.id, 'type', c.type, 'question', c.question,"
      "     'text', c.text, 'lints', json(COALESCE(c.lints_json, '[]')),"
      "     'options', (SELECT json_group_array(json_object('id', o.id, 'text', o.text, 'correct', json(CASE WHEN o.correct THEN 'true' ELSE 'false' END)))"
      "                 FROM (SELECT * FROM challenge_options o WHERE o.challenge_id = c.id ORDER BY o.position, o.id) o)) AS z"
      "     FROM challenges c WHERE c.lesson_id = l.id ORDER BY c.position, c.id))) AS y"
      "   FROM lessons l WHERE l.unit_id = u.id ORDER BY l.position, l.id))) AS x FROM units u ORDER BY u.position, u.id)),"
      " 'newFeedback', (SELECT COUNT(*) FROM unit_feedback WHERE status = 'new'),"
      " 'players', (SELECT COUNT(*) FROM users), 'xpToday', (SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE at >= CAST(strftime('%s', date('now')) AS INTEGER) * 1000))",
      "");
}

static void reply_content(struct mg_connection *c, int status) {
  char *content = admin_content_json();
  reply_json(c, status, content != NULL ? content : "{\"units\":[]}", NULL);
  free(content);
}

/* Trimmed string field from the body, or NULL if missing or empty. Caps its length. */
static char *body_str(struct mg_http_message *hm, const char *path, size_t max_chars) {
  char *s = mg_json_get_str(hm->body, path);
  if (s == NULL) return NULL;
  clean_text(s);
  utf8_truncate(s, max_chars);
  if (s[0] == '\0') {
    free(s);
    return NULL;
  }
  return s;
}

/* Renumbers siblings 0..n-1 (stable), then swaps item `id` with its neighbour in direction `dir`. */
static const char *move_item(const char *kind, long long id, long long dir) {
  const char *table, *parent;
  if (strcmp(kind, "unit") == 0) table = "units", parent = NULL;
  else if (strcmp(kind, "lesson") == 0) table = "lessons", parent = "unit_id";
  else if (strcmp(kind, "challenge") == 0) table = "challenges", parent = "lesson_id";
  else return "Unknown kind";
  char sql[600];
  long long pid = 0;
  if (parent != NULL) {
    snprintf(sql, sizeof(sql), "SELECT %s FROM %s WHERE id = ?", parent, table);
    pid = db_int(-1, sql, "i", id);
    if (pid < 0) return "Not found";
  }
  const char *same = parent != NULL ? parent : "1";
  snprintf(sql, sizeof(sql),
           "UPDATE %s SET position = (SELECT COUNT(*) FROM %s t2 WHERE t2.%s = %s.%s AND (t2.position < %s.position OR"
           " (t2.position = %s.position AND t2.id < %s.id))) WHERE %s = ?",
           table, table, same, table, same, table, table, table, same);
  if (parent != NULL) db_exec(sql, "i", pid);
  else {
    snprintf(sql, sizeof(sql),
             "UPDATE units SET position = (SELECT COUNT(*) FROM units t2 WHERE t2.position < units.position OR"
             " (t2.position = units.position AND t2.id < units.id))");
    db_exec(sql, "");
  }
  snprintf(sql, sizeof(sql), "SELECT position FROM %s WHERE id = ?", table);
  long long pos = db_int(-1, sql, "i", id);
  if (parent != NULL) snprintf(sql, sizeof(sql), "SELECT id FROM %s WHERE %s = ? AND position = ?", table, parent);
  else snprintf(sql, sizeof(sql), "SELECT id FROM %s WHERE ? = ? AND position = ?", table);
  long long other = parent != NULL ? db_int(-1, sql, "ii", pid, pos + dir) : db_int(-1, sql, "iii", 0LL, 0LL, pos + dir);
  if (other < 0) return NULL; /* already first/last */
  snprintf(sql, sizeof(sql), "UPDATE %s SET position = ? WHERE id = ?", table);
  db_exec(sql, "ii", pos + dir, id);
  db_exec(sql, "ii", pos, other);
  return NULL;
}

/* Saves a challenge from the request body (insert when id < 0). Returns an error message or NULL. */
static const char *save_challenge(struct mg_http_message *hm, long long id) {
  char *type = body_str(hm, "$.type", 10);
  char *question = body_str(hm, "$.question", 200);
  long long lesson_id = id < 0 ? mg_json_get_long(hm->body, "$.lessonId", -1) : db_int(-1, "SELECT lesson_id FROM challenges WHERE id = ?", "i", id);
  const char *err = NULL;
  char *text = NULL, *lints = NULL;
  if (type == NULL || (strcmp(type, "fix") != 0 && strcmp(type, "choose") != 0)) err = "Pick a challenge type";
  else if (question == NULL) err = "Write the question or instruction";
  else if (db_int(0, "SELECT COUNT(*) FROM lessons WHERE id = ?", "i", lesson_id) == 0) err = "That lesson doesn't exist";
  int noptions = 0, ncorrect = 0;
  if (err == NULL && strcmp(type, "fix") == 0) {
    text = body_str(hm, "$.text", 1000);
    if (text == NULL || utf8_len(text) < 3) err = "Write the text with mistakes in it";
    else if ((lints = fix_lints(text)) == NULL) err = "Harper finds no mistakes in this text, so there's nothing to fix. Add a mistake Harper catches.";
  } else if (err == NULL) {
    char p[64];
    for (int o = 0; o < 8; o++) {
      snprintf(p, sizeof(p), "$.options[%d].text", o);
      char *t = body_str(hm, p, 200);
      if (t == NULL) {
        snprintf(p, sizeof(p), "$.options[%d]", o);
        if (mg_json_get(hm->body, p, NULL) < 0) break;
        err = "Options can't be empty";
        break;
      }
      noptions++;
      snprintf(p, sizeof(p), "$.options[%d].correct", o);
      bool b = false;
      mg_json_get_bool(hm->body, p, &b);
      ncorrect += b;
      free(t);
    }
    if (err == NULL && noptions < 2) err = "Add at least two options";
    else if (err == NULL && ncorrect != 1) err = "Mark exactly one option as correct";
  }
  if (err == NULL) {
    if (id < 0) {
      long long pos = db_int(0, "SELECT COALESCE(MAX(position), -1) + 1 FROM challenges WHERE lesson_id = ?", "i", lesson_id);
      db_exec("INSERT INTO challenges (lesson_id, type, question, text, lints_json, position) VALUES (?, ?, ?, ?, ?, ?)", "issssi", lesson_id, type,
              question, text, lints, pos);
      id = sqlite3_last_insert_rowid(s_db);
    } else {
      db_exec("UPDATE challenges SET type = ?, question = ?, text = ?, lints_json = ? WHERE id = ?", "ssssi", type, question, text, lints, id);
      db_exec("DELETE FROM challenge_options WHERE challenge_id = ?", "i", id);
    }
    if (strcmp(type, "choose") == 0) {
      char p[64];
      for (int o = 0; o < noptions; o++) {
        snprintf(p, sizeof(p), "$.options[%d].text", o);
        char *t = body_str(hm, p, 200);
        snprintf(p, sizeof(p), "$.options[%d].correct", o);
        bool b = false;
        mg_json_get_bool(hm->body, p, &b);
        db_exec("INSERT INTO challenge_options (challenge_id, text, correct, position) VALUES (?, ?, ?, ?)", "isii", id, t, (long long) b, (long long) o);
        free(t);
      }
    }
  }
  free(type);
  free(question);
  free(text);
  free(lints);
  return err;
}

/* Returns 1 if it handled the request. */
static int handle_admin(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  if (!mg_match(hm->uri, mg_str("/api/admin/#"), NULL)) return 0;
  if (!is_admin(uid)) {
    reply_error(c, 403, "Admins only");
    return 1;
  }
  int is_get = method_is(hm, "GET"), is_post = method_is(hm, "POST"), is_put = method_is(hm, "PUT"), is_del = method_is(hm, "DELETE");
  if ((is_post || is_put) && !require_json(c, hm)) return 1;
  struct mg_str caps[2];
  const char *err = NULL;

  if (is_get && uri_is(hm, "/api/admin/content")) {
    reply_content(c, 200);
    return 1;
  }

  /* Preview: what Harper underlines in a draft "fix" text. */
  if (is_post && uri_is(hm, "/api/admin/preview")) {
    char *text = body_str(hm, "$.text", 1000);
    char *lints = text != NULL ? lint_cached(text) : NULL;
    char *body = mg_mprintf("{\"lints\":%s}", lints != NULL ? lints : "[]");
    reply_json(c, 200, body, NULL);
    free(body);
    free(lints);
    free(text);
    return 1;
  }

  if (is_get && uri_is(hm, "/api/admin/feedback")) {
    char status[8] = "new";
    mg_http_get_var(&hm->query, "status", status, sizeof(status));
    char *list = db_text(
        "SELECT json_object('items', (SELECT json_group_array(json(x)) FROM (SELECT json_object('id', f.id, 'unitId', f.unit_id, 'unitTitle', un.title,"
        " 'user', u.name, 'picture', u.picture, 'rating', f.rating, 'category', f.category, 'text', f.text, 'status', f.status,"
        " 'createdAt', f.created_at) AS x FROM unit_feedback f JOIN units un ON un.id = f.unit_id JOIN users u ON u.id = f.user_id"
        " WHERE ?1 = 'all' OR f.status = ?1 ORDER BY f.status = 'done', f.created_at DESC LIMIT 200)),"
        " 'newCount', (SELECT COUNT(*) FROM unit_feedback WHERE status = 'new'))",
        "s", strcmp(status, "all") == 0 ? "all" : strcmp(status, "done") == 0 ? "done" : "new");
    reply_json(c, 200, list != NULL ? list : "{\"items\":[],\"newCount\":0}", NULL);
    free(list);
    return 1;
  }
  if ((is_put || is_del) && mg_match(hm->uri, mg_str("/api/admin/feedback/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (is_del) db_exec("DELETE FROM unit_feedback WHERE id = ?", "i", id);
    else {
      char *status = body_str(hm, "$.status", 8);
      if (status == NULL || (strcmp(status, "new") != 0 && strcmp(status, "done") != 0)) {
        free(status);
        reply_error(c, 400, "Status must be new or done");
        return 1;
      }
      db_exec("UPDATE unit_feedback SET status = ? WHERE id = ?", "si", status, id);
      free(status);
    }
    reply_json(c, 200, "{\"ok\":true}", NULL);
    return 1;
  }

  if (is_post && uri_is(hm, "/api/admin/units")) {
    char *title = body_str(hm, "$.title", 80);
    char *desc = body_str(hm, "$.description", 200);
    if (title == NULL) err = "Give the unit a title";
    else
      db_exec("INSERT INTO units (title, description, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM units))", "ss", title,
              desc != NULL ? desc : "");
    free(title);
    free(desc);
  } else if ((is_put || is_del) && mg_match(hm->uri, mg_str("/api/admin/units/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (is_del) db_exec("DELETE FROM units WHERE id = ?", "i", id);
    else {
      char *title = body_str(hm, "$.title", 80);
      char *desc = body_str(hm, "$.description", 200);
      if (title == NULL) err = "Give the unit a title";
      else db_exec("UPDATE units SET title = ?, description = ? WHERE id = ?", "ssi", title, desc != NULL ? desc : "", id);
      free(title);
      free(desc);
    }
  } else if (is_post && uri_is(hm, "/api/admin/lessons")) {
    char *title = body_str(hm, "$.title", 80);
    long long unit_id = mg_json_get_long(hm->body, "$.unitId", -1);
    if (title == NULL) err = "Give the lesson a title";
    else if (db_int(0, "SELECT COUNT(*) FROM units WHERE id = ?", "i", unit_id) == 0) err = "That unit doesn't exist";
    else
      db_exec("INSERT INTO lessons (unit_id, title, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE unit_id = ?1))", "is",
              unit_id, title);
    free(title);
  } else if ((is_put || is_del) && mg_match(hm->uri, mg_str("/api/admin/lessons/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (is_del) db_exec("DELETE FROM lessons WHERE id = ?", "i", id);
    else {
      char *title = body_str(hm, "$.title", 80);
      if (title == NULL) err = "Give the lesson a title";
      else db_exec("UPDATE lessons SET title = ? WHERE id = ?", "si", title, id);
      free(title);
    }
  } else if (is_post && uri_is(hm, "/api/admin/challenges")) {
    err = save_challenge(hm, -1);
  } else if ((is_put || is_del) && mg_match(hm->uri, mg_str("/api/admin/challenges/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (is_del) db_exec("DELETE FROM challenges WHERE id = ?", "i", id);
    else if (db_int(0, "SELECT COUNT(*) FROM challenges WHERE id = ?", "i", id) == 0) err = "That challenge doesn't exist";
    else err = save_challenge(hm, id);
  } else if (is_post && uri_is(hm, "/api/admin/move")) {
    char *kind = body_str(hm, "$.kind", 20);
    long long dir = mg_json_get_long(hm->body, "$.dir", 0);
    err = kind == NULL || (dir != 1 && dir != -1) ? "Bad move" : move_item(kind, mg_json_get_long(hm->body, "$.id", -1), dir);
    free(kind);
  } else {
    reply_error(c, 404, "Not found");
    return 1;
  }
  if (err != NULL) reply_error(c, 400, err);
  else reply_content(c, 200);
  return 1;
}
