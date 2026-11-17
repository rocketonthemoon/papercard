/* Labas: Learn mode (Duolingo-style path, hearts, XP, streaks, spaced-repetition review, leaderboard) and the content CMS.
 * Included from main.c, so it shares its helpers (db_*, reply_*, ...).
 *
 * Content: units (decks, each with a CEFR level) -> lessons -> words. Exercises are generated from the words
 * by the engine (duel_challenges):
 *   pick_en  a Lithuanian word; pick its meaning      pick_lt  an English word; pick the Lithuanian one
 *   type_lt  an English word; type the Lithuanian    build    an English phrase; put Lithuanian tiles in order
 * A lesson first asks you to recognise each word (pick), then to produce it (type or build). A word counts as
 * learned once you've produced it, and from then on it is scheduled for review (SM-2).
 */

#define MAX_HEARTS 5
#define HEART_REGEN_MS (30LL * 60 * 1000) /* one heart back every 30 minutes */
#define XP_PER_CHALLENGE 10
#define DAY_MS 86400000LL
#define REVIEW_BATCH "15" /* words per review session */

static const char *LEARN_SCHEMA =
    "CREATE TABLE IF NOT EXISTS units ("
    "  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',"
    "  position INTEGER NOT NULL DEFAULT 0);"
    "CREATE TABLE IF NOT EXISTS lessons ("
    "  id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE, title TEXT NOT NULL,"
    "  position INTEGER NOT NULL DEFAULT 0);"
    "CREATE TABLE IF NOT EXISTS words ("
    "  id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,"
    "  lt TEXT NOT NULL, en TEXT NOT NULL,"
    "  pos TEXT NOT NULL DEFAULT 'noun' CHECK (pos IN ('noun', 'verb', 'phrase', 'other')),"
    "  gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'm', 'f', 'mpl', 'fpl')),"
    "  also TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);"
    /* Spaced repetition (SM-2): a row exists once the word is learned. ease is a percentage (250 = 2.5). */
    "CREATE TABLE IF NOT EXISTS word_progress ("
    "  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
    "  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,"
    "  learned_at INTEGER NOT NULL, reps INTEGER NOT NULL DEFAULT 1, interval_days INTEGER NOT NULL DEFAULT 1,"
    "  ease INTEGER NOT NULL DEFAULT 250, lapses INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, reviewed_at INTEGER,"
    "  PRIMARY KEY (user_id, word_id));"
    "CREATE TABLE IF NOT EXISTS xp_events ("
    "  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, xp INTEGER NOT NULL,"
    "  at INTEGER NOT NULL);"
    "CREATE INDEX IF NOT EXISTS xp_events_user_at ON xp_events(user_id, at);"
    "CREATE INDEX IF NOT EXISTS xp_events_at ON xp_events(at);"
    "CREATE INDEX IF NOT EXISTS lessons_unit ON lessons(unit_id);"
    "CREATE INDEX IF NOT EXISTS words_lesson ON words(lesson_id);"
    "CREATE INDEX IF NOT EXISTS word_progress_due ON word_progress(user_id, due_at);"
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

static const char *POS_VALUES[] = {"noun", "verb", "phrase", "other"};
static const char *GENDER_VALUES[] = {"", "m", "f", "mpl", "fpl"};

static char s_admins[1024]; /* comma-separated, lowercase: emails, or dev:<name> for guest logins */
static char *s_pool;        /* every word as engine JSON (wrong options, decoy tiles); rebuilt after content edits */

/* A word as the engine wants it. `?2` must be bound to the user id (for "completed"). */
#define WORD_JSON                                                                                                                                  \
  "json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender, 'unitId', l.unit_id, 'completed',"                       \
  " json(CASE WHEN EXISTS (SELECT 1 FROM word_progress p WHERE p.word_id = w.id AND p.user_id = ?2) THEN 'true' ELSE 'false' END))"

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

static int in_list(const char *s, const char **list, size_t n) {
  for (size_t i = 0; s != NULL && i < n; i++)
    if (strcmp(s, list[i]) == 0) return 1;
  return 0;
}
#define IN(s, arr) in_list((s), (arr), sizeof(arr) / sizeof((arr)[0]))

static void pool_reset(void) {
  free(s_pool);
  s_pool = NULL;
}

static const char *pool_json(void) {
  if (s_pool == NULL)
    s_pool = db_text("SELECT json_group_array(json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender, 'unitId', l.unit_id))"
                     " FROM words w JOIN lessons l ON l.id = w.lesson_id",
                     "");
  return s_pool != NULL ? s_pool : "[]";
}

/* Exercises for the words in `targets` (engine JSON), as a malloc'd JSON array. */
static char *challenges_for(const char *targets, const char *mode) {
  char *list = duel_challenges(targets != NULL ? targets : "[]", pool_json(), mode);
  char *out = strdup(list != NULL ? list : "[]");
  duel_free(list);
  return out;
}

/* Loads the starter course the first time the server runs (when there are no units). */
static void learn_seed(const char *path) {
  if (db_int(0, "SELECT COUNT(*) FROM units", "") > 0) return;
  char *json = read_file(path);
  if (json == NULL) {
    MG_INFO(("no starter content at %s", path));
    return;
  }
  struct mg_str s = mg_str(json);
  int units = 0, words = 0;
  char p[160];
  sqlite3_exec(s_db, "BEGIN", NULL, NULL, NULL);
  for (int u = 0;; u++) {
    snprintf(p, sizeof(p), "$.units[%d].title", u);
    char *title = mg_json_get_str(s, p);
    if (title == NULL) break;
    snprintf(p, sizeof(p), "$.units[%d].description", u);
    char *desc = mg_json_get_str(s, p);
    snprintf(p, sizeof(p), "$.units[%d].level", u);
    char *level = mg_json_get_str(s, p);
    db_exec("INSERT INTO units (title, description, level, position) VALUES (?, ?, ?, ?)", "sssi", title, desc != NULL ? desc : "",
            level != NULL ? level : "", (long long) u);
    long long unit_id = sqlite3_last_insert_rowid(s_db);
    units++;
    free(title);
    free(desc);
    free(level);
    for (int l = 0;; l++) {
      snprintf(p, sizeof(p), "$.units[%d].lessons[%d].title", u, l);
      char *ltitle = mg_json_get_str(s, p);
      if (ltitle == NULL) break;
      db_exec("INSERT INTO lessons (unit_id, title, position) VALUES (?, ?, ?)", "isi", unit_id, ltitle, (long long) l);
      long long lesson_id = sqlite3_last_insert_rowid(s_db);
      free(ltitle);
      for (int k = 0;; k++) {
        char *f[6];
        static const char *names[6] = {"lt", "en", "pos", "gender", "also", "note"};
        for (int i = 0; i < 6; i++) {
          snprintf(p, sizeof(p), "$.units[%d].lessons[%d].words[%d].%s", u, l, k, names[i]);
          f[i] = mg_json_get_str(s, p);
        }
        int done = f[0] == NULL;
        if (!done) {
          int rc = db_exec("INSERT INTO words (lesson_id, lt, en, pos, gender, also, note, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "issssssi", lesson_id,
                           f[0], f[1] != NULL ? f[1] : "", f[2] != NULL ? f[2] : "noun", f[3] != NULL ? f[3] : "", f[4] != NULL ? f[4] : "",
                           f[5] != NULL ? f[5] : "", (long long) k);
          if (rc == SQLITE_DONE) words++;
          else MG_ERROR(("seed: couldn't add \"%s\"", f[0]));
        }
        for (int i = 0; i < 6; i++) free(f[i]);
        if (done) break;
      }
    }
  }
  sqlite3_exec(s_db, "COMMIT", NULL, NULL, NULL);
  free(json);
  pool_reset();
  MG_INFO(("loaded starter course: %d units, %d words", units, words));
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
  long long learned = db_int(0, "SELECT COUNT(*) FROM word_progress WHERE user_id = ?", "i", uid);
  long long due = db_int(0, "SELECT COUNT(*) FROM word_progress WHERE user_id = ? AND due_at <= ?", "ii", uid, now_ms());
  long long next_due = db_int(0, "SELECT MIN(due_at) FROM word_progress WHERE user_id = ? AND due_at > ?", "ii", uid, now_ms());
  return mg_mprintf("{\"xp\":%lld,\"weekXp\":%lld,\"hearts\":%d,\"maxHearts\":%d,\"nextHeartMs\":%lld,\"streak\":%d,\"learned\":%lld,\"due\":%lld,"
                    "\"nextDueAt\":%lld}",
                    xp, week, hearts, MAX_HEARTS, next, streak_days(uid), learned, due, next_due);
}

/* ---------------------------------------------------------------- spaced repetition (SM-2) */

/* The first time a word is produced correctly in a lesson: first review tomorrow. */
static void srs_learn(long long uid, long long wid) {
  long long now = now_ms();
  db_exec("INSERT OR IGNORE INTO word_progress (user_id, word_id, learned_at, reps, interval_days, ease, lapses, due_at) VALUES (?, ?, ?, 1, 1, 250, 0, ?)",
          "iiii", uid, wid, now, now + DAY_MS);
}

/* A review answer. `quality`: 5 perfect, 4 right, 3 right with a slip (accents, typo), 0 wrong. */
static void srs_review(long long uid, long long wid, int quality) {
  long long reps = db_int(0, "SELECT reps FROM word_progress WHERE user_id = ? AND word_id = ?", "ii", uid, wid);
  long long interval = db_int(1, "SELECT interval_days FROM word_progress WHERE user_id = ? AND word_id = ?", "ii", uid, wid);
  long long ease = db_int(250, "SELECT ease FROM word_progress WHERE user_id = ? AND word_id = ?", "ii", uid, wid);
  long long now = now_ms(), due;
  if (quality < 3) {
    /* Forgotten: back to the start, and it stays due so it comes round again this session. */
    ease = ease - 20 < 130 ? 130 : ease - 20;
    db_exec("UPDATE word_progress SET reps = 0, interval_days = 0, ease = ?, lapses = lapses + 1, due_at = ?, reviewed_at = ? WHERE user_id = ? AND word_id = ?",
            "iiiii", ease, now, now, uid, wid);
    return;
  }
  int q = quality > 5 ? 5 : quality;
  ease += 10 - (5 - q) * (8 + (5 - q) * 2);
  if (ease < 130) ease = 130;
  reps++;
  if (reps == 1) interval = 1;
  else if (reps == 2) interval = 3;
  else {
    long long next = (interval * ease + 50) / 100;
    interval = next > interval ? next : interval + 1;
  }
  if (interval > 365) interval = 365;
  due = now + interval * DAY_MS;
  db_exec("UPDATE word_progress SET reps = ?, interval_days = ?, ease = ?, due_at = ?, reviewed_at = ? WHERE user_id = ? AND word_id = ?", "iiiiiii", reps,
          interval, ease, due, now, uid, wid);
}

/* ---------------------------------------------------------------- learner API */

static void reply_learn_path(struct mg_connection *c, long long uid) {
  char *units = db_text(
      "SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'description', u.description, 'level', u.level,"
      "  'feedbackSent', json(CASE WHEN EXISTS (SELECT 1 FROM unit_feedback f WHERE f.unit_id = u.id AND f.user_id = ?1) THEN 'true' ELSE 'false' END),"
      "  'lessons',"
      "  (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title,"
      "     'total', (SELECT COUNT(*) FROM words w WHERE w.lesson_id = l.id),"
      "     'done', (SELECT COUNT(*) FROM words w JOIN word_progress p ON p.word_id = w.id AND p.user_id = ?1 WHERE w.lesson_id = l.id)) AS y"
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
  char *lesson = db_text("SELECT json_object('id', l.id, 'title', l.title, 'unitId', u.id, 'unitTitle', u.title, 'level', u.level)"
                         " FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.id = ?",
                         "i", lesson_id);
  if (lesson == NULL) return reply_error(c, 404, "No such lesson");
  char *targets = db_text("SELECT json_group_array(json(x)) FROM (SELECT " WORD_JSON " AS x FROM words w JOIN lessons l ON l.id = w.lesson_id"
                          " WHERE w.lesson_id = ?1 ORDER BY w.position, w.id)",
                          "ii", lesson_id, uid);
  char *challenges = challenges_for(targets, "lesson");
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"lesson\":%s,\"challenges\":%s,\"stats\":%s}", lesson, challenges, stats);
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(challenges);
  free(targets);
  free(lesson);
}

/* A review session: the words that are due, most overdue first. */
static void reply_review(struct mg_connection *c, long long uid) {
  char *targets = db_text("SELECT json_group_array(json(x)) FROM (SELECT " WORD_JSON " AS x FROM word_progress p0"
                          " JOIN words w ON w.id = p0.word_id JOIN lessons l ON l.id = w.lesson_id"
                          " WHERE p0.user_id = ?2 AND p0.due_at <= ?1 ORDER BY p0.due_at, w.id LIMIT " REVIEW_BATCH ")",
                          "ii", now_ms(), uid);
  char *challenges = challenges_for(targets, "review");
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"challenges\":%s,\"stats\":%s}", challenges, stats);
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(challenges);
  free(targets);
}

/* Every word in the course, with your progress on it. */
static void reply_words(struct mg_connection *c, long long uid) {
  char *units = db_text(
      "SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'level', u.level, 'lessons',"
      "  (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title, 'words',"
      "     (SELECT json_group_array(json(z)) FROM (SELECT json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender,"
      "        'note', w.note, 'learned', json(CASE WHEN p.word_id IS NULL THEN 'false' ELSE 'true' END), 'dueAt', p.due_at, 'reps', p.reps) AS z"
      "      FROM words w LEFT JOIN word_progress p ON p.word_id = w.id AND p.user_id = ?1 WHERE w.lesson_id = l.id ORDER BY w.position, w.id))) AS y"
      "   FROM lessons l WHERE l.unit_id = u.id ORDER BY l.position, l.id))) AS x"
      " FROM units u ORDER BY u.position, u.id)",
      "i", uid);
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"units\":%s,\"stats\":%s,\"now\":%lld}", units != NULL ? units : "[]", stats, now_ms());
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(units);
}

/* Checks one answer. Lessons: correct = +XP (and +1 heart when practising a learned word); wrong = -1 heart.
 * Producing a word correctly (type or build) for the first time marks it learned. Reviews cost no hearts:
 * they reschedule the word, and earn XP only when it was due. */
static void answer_word(struct mg_connection *c, struct mg_http_message *hm, long long uid, long long wid) {
  if (db_int(0, "SELECT COUNT(*) FROM words WHERE id = ?", "i", wid) == 0) return reply_error(c, 404, "No such word");
  char kind[12] = "";
  char *k = mg_json_get_str(hm->body, "$.kind");
  if (k != NULL) snprintf(kind, sizeof(kind), "%s", k);
  free(k);
  int is_pick = strcmp(kind, "pick_en") == 0 || strcmp(kind, "pick_lt") == 0;
  int is_text = strcmp(kind, "type_lt") == 0 || strcmp(kind, "build") == 0;
  if (!is_pick && !is_text) return reply_error(c, 400, "Unknown exercise");
  bool review = false;
  mg_json_get_bool(hm->body, "$.review", &review);
  int learned = db_int(0, "SELECT 1 FROM word_progress WHERE user_id = ? AND word_id = ?", "ii", uid, wid) == 1;
  if (review && !learned) return reply_error(c, 400, "You haven't learned this word yet");
  int practice = learned && !review;
  int hearts = hearts_now(uid, NULL);
  if (!review && !practice && hearts <= 0)
    return mg_http_reply(c, 403, "Content-Type: application/json\r\nCache-Control: no-store\r\n", "{%m:%m,%m:0}", MG_ESC("error"),
                         MG_ESC("You're out of hearts. Review your words, practise a finished lesson or wait for a heart to come back."), MG_ESC("hearts"));

  int correct = 0, quality = 0;
  const char *verdict = "wrong";
  char *grade = NULL, *confused = NULL;
  if (is_pick) {
    long long chosen = mg_json_get_long(hm->body, "$.optionId", -1);
    /* Right if the chosen word means the same (another row with identical text counts too). */
    correct = db_int(0,
                     strcmp(kind, "pick_en") == 0 ? "SELECT c.id = w.id OR lower(c.en) = lower(w.en) FROM words c, words w WHERE c.id = ? AND w.id = ?"
                                                  : "SELECT c.id = w.id OR c.lt = w.lt FROM words c, words w WHERE c.id = ? AND w.id = ?",
                     "ii", chosen, wid) == 1;
    verdict = correct ? "exact" : "wrong";
    quality = correct ? 4 : 0;
  } else {
    char *answer = mg_json_get_str(hm->body, "$.text");
    if (answer == NULL || utf8_len(answer) > 300) {
      free(answer);
      return reply_error(c, 400, "Send your answer");
    }
    char *lt = db_text("SELECT lt FROM words WHERE id = ?", "i", wid);
    char *also = db_text("SELECT also FROM words WHERE id = ?", "i", wid);
    char *accepted = duel_accepted(lt != NULL ? lt : "", also != NULL ? also : "");
    char *others = db_text("SELECT json_group_array(lt) FROM words WHERE id <> ?", "i", wid);
    grade = duel_grade(accepted != NULL ? accepted : "[]", others != NULL ? others : "[]", answer, strcmp(kind, "type_lt") == 0);
    free(answer);
    free(lt);
    free(also);
    duel_free(accepted);
    free(others);
    if (grade == NULL) return reply_error(c, 500, "Couldn't check your answer");
    bool ok = false;
    mg_json_get_bool(mg_str(grade), "$.correct", &ok);
    correct = ok;
    char *v = mg_json_get_str(mg_str(grade), "$.verdict");
    verdict = v == NULL ? "wrong" : strcmp(v, "exact") == 0 ? "exact" : strcmp(v, "accents") == 0 ? "accents" : strcmp(v, "typo") == 0 ? "typo" : "wrong";
    free(v);
    quality = !correct ? 0 : strcmp(verdict, "exact") == 0 ? 5 : 3;
    char *conf = mg_json_get_str(mg_str(grade), "$.confused");
    if (conf != NULL) confused = db_text("SELECT json_object('lt', lt, 'en', en) FROM words WHERE lt = ? LIMIT 1", "s", conf);
    free(conf);
  }

  int xp = 0;
  if (review) {
    int due = db_int(0, "SELECT due_at <= ? FROM word_progress WHERE user_id = ? AND word_id = ?", "iii", now_ms(), uid, wid) == 1;
    if (due) {
      srs_review(uid, wid, quality);
      if (correct) xp = XP_PER_CHALLENGE;
    }
  } else if (correct) {
    xp = XP_PER_CHALLENGE;
    if (practice) set_hearts(uid, hearts + 1);
    else if (is_text) srs_learn(uid, wid);
  } else if (!practice) {
    set_hearts(uid, hearts - 1);
  }
  if (xp > 0) db_exec("INSERT INTO xp_events (user_id, xp, at) VALUES (?, ?, ?)", "iii", uid, (long long) xp, now_ms());

  char *word = db_text("SELECT json_object('id', id, 'lt', lt, 'en', en, 'pos', pos, 'gender', gender, 'note', note) FROM words WHERE id = ?", "i", wid);
  char *expected = grade != NULL ? mg_json_get_str(mg_str(grade), "$.expected") : NULL;
  char *stats = stats_json(uid);
  char *body = mg_mprintf("{\"correct\":%s,\"verdict\":%m,\"practice\":%s,\"review\":%s,\"learned\":%s,\"xp\":%d,\"stats\":%s,\"word\":%s,"
                          "\"correctOptionId\":%lld,\"expected\":%m,\"confused\":%s}",
                          correct ? "true" : "false", MG_ESC(verdict), practice ? "true" : "false", review ? "true" : "false",
                          db_int(0, "SELECT 1 FROM word_progress WHERE user_id = ? AND word_id = ?", "ii", uid, wid) == 1 ? "true" : "false", xp, stats,
                          word != NULL ? word : "null", wid, MG_ESC(expected != NULL ? expected : ""), confused != NULL ? confused : "null");
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(expected);
  free(word);
  free(confused);
  duel_free(grade);
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
  if (db_int(0, "SELECT COUNT(*) FROM unit_feedback WHERE unit_id = ? AND user_id = ? AND created_at > ?", "iii", unit_id, uid, now_ms() - DAY_MS) >= 5)
    return reply_error(c, 429, "Thanks! You've sent a lot of suggestions for this unit today. Try again tomorrow.");
  char *text = body_str(hm, "$.text", 1000);
  if (text == NULL) return reply_error(c, 400, "Tell us what should change");
  long long rating = mg_json_get_long(hm->body, "$.rating", 0);
  char *category = body_str(hm, "$.category", 20);
  int known = IN(category, FEEDBACK_CATEGORIES);
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
  if (method_is(hm, "GET") && uri_is(hm, "/api/learn/review")) {
    reply_review(c, uid);
    return 1;
  }
  if (method_is(hm, "GET") && uri_is(hm, "/api/learn/words")) {
    reply_words(c, uid);
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
  if (method_is(hm, "POST") && mg_match(hm->uri, mg_str("/api/learn/words/*/answer"), caps)) {
    if (require_json(c, hm)) answer_word(c, hm, uid, strtoll(caps[0].buf, NULL, 10));
    return 1;
  }
  return 0;
}

/* ---------------------------------------------------------------- CMS (admins only) */

static char *admin_content_json(void) {
  return db_text(
      "SELECT json_object('units', (SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'level', u.level,"
      " 'newFeedback', (SELECT COUNT(*) FROM unit_feedback f WHERE f.unit_id = u.id AND f.status = 'new'),"
      " 'description', u.description, 'lessons', (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title,"
      "   'words', (SELECT json_group_array(json(z)) FROM (SELECT json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender,"
      "     'also', w.also, 'note', w.note) AS z FROM words w WHERE w.lesson_id = l.id ORDER BY w.position, w.id))) AS y"
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
  else if (strcmp(kind, "word") == 0) table = "words", parent = "lesson_id";
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

/* Saves a word from the request body (insert when id < 0). Returns an error message or NULL. */
static const char *save_word(struct mg_http_message *hm, long long id) {
  static char msg[200];
  char *lt = body_str(hm, "$.lt", 100);
  char *en = body_str(hm, "$.en", 100);
  char *pos = body_str(hm, "$.pos", 10);
  char *gender = body_str(hm, "$.gender", 4);
  char *also = body_str(hm, "$.also", 200);
  char *note = body_str(hm, "$.note", 200);
  long long lesson_id = id < 0 ? mg_json_get_long(hm->body, "$.lessonId", -1) : db_int(-1, "SELECT lesson_id FROM words WHERE id = ?", "i", id);
  const char *err = NULL;
  if (lt == NULL) err = "Write the Lithuanian word or phrase";
  else if (en == NULL) err = "Write what it means in English";
  else if (!IN(pos, POS_VALUES)) err = "Pick a part of speech";
  else if (gender != NULL && !IN(gender, GENDER_VALUES)) err = "Pick a gender";
  else if (db_int(0, "SELECT COUNT(*) FROM lessons WHERE id = ?", "i", lesson_id) == 0) err = "That lesson doesn't exist";
  else {
    char *where = db_text("SELECT u.title || ' › ' || l.title FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id"
                          " WHERE lower(w.lt) = lower(?) AND w.id <> ? LIMIT 1",
                          "si", lt, id);
    if (where != NULL) {
      snprintf(msg, sizeof(msg), "“%s” is already in the course (%s). Each word should appear once.", lt, where);
      err = msg;
    }
    free(where);
  }
  if (err == NULL) {
    const char *g = gender != NULL && strcmp(pos, "noun") == 0 ? gender : "";
    if (id < 0) {
      db_exec("INSERT INTO words (lesson_id, lt, en, pos, gender, also, note, position)"
              " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(position), -1) + 1 FROM words WHERE lesson_id = ?1))",
              "issssss", lesson_id, lt, en, pos, g, also != NULL ? also : "", note != NULL ? note : "");
    } else {
      db_exec("UPDATE words SET lt = ?, en = ?, pos = ?, gender = ?, also = ?, note = ? WHERE id = ?", "ssssssi", lt, en, pos, g, also != NULL ? also : "",
              note != NULL ? note : "", id);
    }
  }
  free(lt);
  free(en);
  free(pos);
  free(gender);
  free(also);
  free(note);
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
    char *level = body_str(hm, "$.level", 6);
    if (title == NULL) err = "Give the deck a title";
    else
      db_exec("INSERT INTO units (title, description, level, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM units))", "sss", title,
              desc != NULL ? desc : "", level != NULL ? level : "");
    free(title);
    free(desc);
    free(level);
  } else if ((is_put || is_del) && mg_match(hm->uri, mg_str("/api/admin/units/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (is_del) db_exec("DELETE FROM units WHERE id = ?", "i", id);
    else {
      char *title = body_str(hm, "$.title", 80);
      char *desc = body_str(hm, "$.description", 200);
      char *level = body_str(hm, "$.level", 6);
      if (title == NULL) err = "Give the deck a title";
      else db_exec("UPDATE units SET title = ?, description = ?, level = ? WHERE id = ?", "sssi", title, desc != NULL ? desc : "", level != NULL ? level : "", id);
      free(title);
      free(desc);
      free(level);
    }
  } else if (is_post && uri_is(hm, "/api/admin/lessons")) {
    char *title = body_str(hm, "$.title", 80);
    long long unit_id = mg_json_get_long(hm->body, "$.unitId", -1);
    if (title == NULL) err = "Give the lesson a title";
    else if (db_int(0, "SELECT COUNT(*) FROM units WHERE id = ?", "i", unit_id) == 0) err = "That deck doesn't exist";
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
  } else if (is_post && uri_is(hm, "/api/admin/words")) {
    err = save_word(hm, -1);
  } else if ((is_put || is_del) && mg_match(hm->uri, mg_str("/api/admin/words/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (is_del) db_exec("DELETE FROM words WHERE id = ?", "i", id);
    else if (db_int(0, "SELECT COUNT(*) FROM words WHERE id = ?", "i", id) == 0) err = "That word doesn't exist";
    else err = save_word(hm, id);
  } else if (is_post && uri_is(hm, "/api/admin/move")) {
    char *kind = body_str(hm, "$.kind", 20);
    long long dir = mg_json_get_long(hm->body, "$.dir", 0);
    err = kind == NULL || (dir != 1 && dir != -1) ? "Bad move" : move_item(kind, mg_json_get_long(hm->body, "$.id", -1), dir);
    free(kind);
  } else {
    reply_error(c, 404, "Not found");
    return 1;
  }
  pool_reset(); /* words may have changed: rebuild the option pool on next use */
  if (err != NULL) reply_error(c, 400, err);
  else reply_content(c, 200);
  return 1;
}
