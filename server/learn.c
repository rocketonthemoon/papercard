/* Labas: Learn mode (Duolingo-style path, hearts, XP, streaks, spaced-repetition review, leaderboard) and the course
 * editor ("studio"). Included from main.c, so it shares its helpers (db_*, reply_*, ...).
 *
 * Content: courses (each owned by an account; the official account owns the starter course) -> units (decks, each
 * with a CEFR level) -> lessons -> words. Exercises are generated from the words by the engine (duel_challenges):
 *   pick_en  a target-language word; pick its meaning   pick_lt  an English word; pick the target-language one
 *   type_lt  an English word; type it                  build    an English phrase; put word tiles in order
 * A lesson first asks you to recognise each word (pick), then to produce it (type or build). A word counts as
 * learned once you've produced it, and from then on it is scheduled for review (SM-2).
 * Wrong options and decoy tiles always come from the same course.
 */

#define MAX_HEARTS 5
#define HEART_REGEN_MS (30LL * 60 * 1000) /* one heart back every 30 minutes */
#define XP_PER_CHALLENGE 10
#define DAY_MS 86400000LL
#define REVIEW_BATCH "15" /* words per review session */

static const char *LEARN_SCHEMA =
    "CREATE TABLE IF NOT EXISTS courses ("
    "  id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,"
    "  description TEXT NOT NULL DEFAULT '', from_lang TEXT NOT NULL DEFAULT 'English', to_lang TEXT NOT NULL,"
    "  to_code TEXT NOT NULL DEFAULT '', letters TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0,"
    "  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);"
    "CREATE TABLE IF NOT EXISTS units ("
    "  id INTEGER PRIMARY KEY, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL,"
    "  description TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);"
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
    "CREATE TABLE IF NOT EXISTS enrollments ("
    "  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
    "  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,"
    "  enrolled_at INTEGER NOT NULL, PRIMARY KEY (user_id, course_id));"
    "CREATE TABLE IF NOT EXISTS follows ("
    "  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
    "  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
    "  created_at INTEGER NOT NULL, PRIMARY KEY (follower_id, following_id), CHECK (follower_id <> following_id));"
    "CREATE TABLE IF NOT EXISTS xp_events ("
    "  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, xp INTEGER NOT NULL,"
    "  at INTEGER NOT NULL);"
    "CREATE TABLE IF NOT EXISTS unit_feedback ("
    "  id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,"
    "  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, rating INTEGER, category TEXT, text TEXT NOT NULL,"
    "  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')), created_at INTEGER NOT NULL);"
    /* Access codes for locked courses: each opens its course for one person, once. */
    "CREATE TABLE IF NOT EXISTS course_tokens ("
    "  id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, code TEXT NOT NULL UNIQUE,"
    "  created_at INTEGER NOT NULL, used_by INTEGER REFERENCES users(id) ON DELETE SET NULL, used_at INTEGER);"
    "CREATE TABLE IF NOT EXISTS redeem_failures (user_id INTEGER NOT NULL, at INTEGER NOT NULL);";

/* Columns added after the first release (each ignored if it already exists). */
static const char *ADDED_COLUMNS[] = {
    "ALTER TABLE users ADD COLUMN hearts INTEGER NOT NULL DEFAULT 5",
    "ALTER TABLE users ADD COLUMN hearts_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN username TEXT",
    "ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN current_course_id INTEGER",
    "ALTER TABLE units ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE",
    "ALTER TABLE duels ADD COLUMN course_id INTEGER",
    "ALTER TABLE courses ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
};

/* Indexes on those columns, so created after them. */
static const char *LEARN_INDEXES =
    "CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username COLLATE NOCASE);"
    "CREATE INDEX IF NOT EXISTS courses_creator ON courses(creator_id);"
    "CREATE INDEX IF NOT EXISTS units_course ON units(course_id);"
    "CREATE INDEX IF NOT EXISTS lessons_unit ON lessons(unit_id);"
    "CREATE INDEX IF NOT EXISTS words_lesson ON words(lesson_id);"
    "CREATE INDEX IF NOT EXISTS word_progress_due ON word_progress(user_id, due_at);"
    "CREATE INDEX IF NOT EXISTS enrollments_course ON enrollments(course_id);"
    "CREATE INDEX IF NOT EXISTS follows_following ON follows(following_id);"
    "CREATE INDEX IF NOT EXISTS xp_events_user_at ON xp_events(user_id, at);"
    "CREATE INDEX IF NOT EXISTS xp_events_at ON xp_events(at);"
    "CREATE INDEX IF NOT EXISTS unit_feedback_unit ON unit_feedback(unit_id, status);"
    "CREATE INDEX IF NOT EXISTS course_tokens_course ON course_tokens(course_id, used_at);"
    "CREATE INDEX IF NOT EXISTS course_tokens_user ON course_tokens(used_by, course_id);"
    "CREATE INDEX IF NOT EXISTS redeem_failures_user ON redeem_failures(user_id, at);";

static const char *POS_VALUES[] = {"noun", "verb", "phrase", "other"};
static const char *GENDER_VALUES[] = {"", "m", "f", "mpl", "fpl"};
static const char *RESERVED_USERNAMES[] = {"admin", "admins", "official", "vokab", "labas", "me", "api", "settings", "studio", "discover", "support", "help"};

static char s_admins[1024]; /* comma-separated, lowercase: emails, or dev:<name> for guest logins */

#define JBOOL(x) "json(CASE WHEN " x " THEN 'true' ELSE 'false' END)"

/* The words of course `?1`... as the engine wants them. `?2` must be bound to the user id (for "completed"). */
#define WORD_JSON                                                                                                                                  \
  "json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender, 'unitId', l.unit_id, 'completed',"                       \
  " " JBOOL("EXISTS (SELECT 1 FROM word_progress p WHERE p.word_id = w.id AND p.user_id = ?2)") ")"

/* Whether user ?1 may learn from course `id` (row alias `r`): it isn't locked, they made it, they were enrolled
 * (before it was locked, or with a code), or they redeemed one of its codes. */
#define HAS_ACCESS_SQL(id, r)                                                                                                                      \
  "(" r ".locked = 0 OR " r ".creator_id = ?1 OR EXISTS (SELECT 1 FROM enrollments ea WHERE ea.course_id = " id " AND ea.user_id = ?1)"           \
  " OR EXISTS (SELECT 1 FROM course_tokens ta WHERE ta.course_id = " id " AND ta.used_by = ?1))"

/* A course card. Needs `c` (courses) joined with `cu` (its creator), and `?1` bound to the viewer's user id. */
#define COURSE_JSON                                                                                                                                \
  "json_object('id', c.id, 'title', c.title, 'description', c.description, 'fromLang', c.from_lang, 'toLang', c.to_lang,"                     \
  " 'toCode', c.to_code, 'letters', c.letters, 'hidden', " JBOOL("c.hidden") ", 'updatedAt', c.updated_at,"                                    \
  " 'creator', json_object('id', cu.id, 'username', cu.username, 'name', cu.name, 'picture', cu.picture, 'official', " JBOOL("cu.is_official") "),"   \
  " 'learners', (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id),"                                                              \
  " 'units', (SELECT COUNT(*) FROM units u WHERE u.course_id = c.id),"                                                                       \
  " 'words', (SELECT COUNT(*) FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE u.course_id = c.id),"  \
  " 'learned', (SELECT COUNT(*) FROM word_progress p JOIN words w ON w.id = p.word_id JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id"   "   WHERE p.user_id = ?1 AND u.course_id = c.id),"                                                                                           \
  " 'enrolled', " JBOOL("EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?1)") ","                                \
  " 'isCurrent', " JBOOL("c.id = (SELECT current_course_id FROM users WHERE id = ?1)") ","                                                     \
  " 'mine', " JBOOL("c.creator_id = ?1") ", 'locked', " JBOOL("c.locked") ","                                                                 \
  " 'hasAccess', " JBOOL(HAS_ACCESS_SQL("c.id", "c")) ")"

#define COURSE_FROM " FROM courses c JOIN users cu ON cu.id = c.creator_id"

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

/* ---- per-course word pools (wrong options, decoy tiles, "is it another word?"), rebuilt after content edits */

#define POOL_SLOTS 64
static struct {
  long long course;
  char *json;
} s_pools[POOL_SLOTS];

static void pool_reset(void) {
  for (int i = 0; i < POOL_SLOTS; i++) {
    free(s_pools[i].json);
    s_pools[i].json = NULL;
    s_pools[i].course = 0;
  }
}

static const char *pool_json(long long cid) {
  int slot = (int) (cid % POOL_SLOTS);
  if (s_pools[slot].json == NULL || s_pools[slot].course != cid) {
    free(s_pools[slot].json);
    s_pools[slot].json = db_text("SELECT json_group_array(json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender, 'unitId', l.unit_id))"
                                 " FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE u.course_id = ?",
                                 "i", cid);
    s_pools[slot].course = cid;
  }
  return s_pools[slot].json != NULL ? s_pools[slot].json : "[]";
}

/* Exercises for the words in `targets` (engine JSON), as a malloc'd JSON array. */
static char *challenges_for(const char *targets, const char *mode, long long cid) {
  char *list = duel_challenges(targets != NULL ? targets : "[]", pool_json(cid), mode);
  char *out = strdup(list != NULL ? list : "[]");
  duel_free(list);
  return out;
}

static void touch_course(long long cid) {
  db_exec("UPDATE courses SET updated_at = ? WHERE id = ?", "ii", now_ms(), cid);
  pool_reset();
}

/* ---- the official account (owns the starter course; the site's admins edit its courses) */

static long long official_user(void) {
  long long id = db_int(0, "SELECT id FROM users WHERE provider = 'system' AND subject = 'official'", "");
  if (id == 0) {
    db_exec("INSERT INTO users (provider, subject, name, created_at, username, is_official, bio) VALUES ('system', 'official', ?, ?, 'vokab', 1, ?)", "sis",
            getenv("OFFICIAL_NAME") != NULL ? getenv("OFFICIAL_NAME") : "Vokab", now_ms(),
            "The official Vokab account. Follow us for new decks and courses.");
    id = sqlite3_last_insert_rowid(s_db);
  }
  return id;
}

/* Creates a course from the "course" object of a seed file (or defaults). Returns its id. */
static long long create_course_from_meta(long long creator, struct mg_str meta) {
  char *title = mg_json_get_str(meta, "$.course.title");
  char *desc = mg_json_get_str(meta, "$.course.description");
  char *from = mg_json_get_str(meta, "$.course.fromLang");
  char *to = mg_json_get_str(meta, "$.course.toLang");
  char *code = mg_json_get_str(meta, "$.course.toCode");
  char *letters = mg_json_get_str(meta, "$.course.letters");
  long long now = now_ms();
  db_exec("INSERT INTO courses (creator_id, title, description, from_lang, to_lang, to_code, letters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          "issssssii", creator, title != NULL ? title : "Lithuanian for students", desc != NULL ? desc : "", from != NULL ? from : "English",
          to != NULL ? to : "Lithuanian", code != NULL ? code : "lt", letters != NULL ? letters : "ą č ę ė į š ų ū ž", now, now);
  long long id = sqlite3_last_insert_rowid(s_db);
  free(title);
  free(desc);
  free(from);
  free(to);
  free(code);
  free(letters);
  return id;
}

/* Loads the starter course into course `cid`. */
static void learn_seed(struct mg_str s, long long cid) {
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
    db_exec("INSERT INTO units (course_id, title, description, level, position) VALUES (?, ?, ?, ?, ?)", "isssi", cid, title, desc != NULL ? desc : "",
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
  MG_INFO(("loaded starter course: %d units, %d words", units, words));
}

/* ---- search: fold() and the full-text index
 * fold(text) is the engine's duel_fold: lowercase, accents removed, in any language (ą→a, Ж→ж, ố→o, ά→α...).
 * search_idx is an FTS5 trigram index over folded text: course titles, languages and descriptions, deck titles,
 * words (with their meaning and alternatives) and people. Triggers keep it in step with every change; it is
 * rebuilt from scratch when SEARCH_VERSION changes (for example after changing how text is folded).
 * Row ids are kind * 2^40 + the thing's id, so a trigger can replace one entry without a scan. */

#define SEARCH_VERSION "1"
#define K1 "1099511627776" /* 2^40 */

static void sql_fold(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
  (void) argc;
  const unsigned char *s = sqlite3_value_text(argv[0]);
  if (s == NULL) return sqlite3_result_null(ctx);
  char *f = duel_fold((const char *) s);
  sqlite3_result_text(ctx, f != NULL ? f : (const char *) s, -1, SQLITE_TRANSIENT);
  duel_free(f);
}

/* One index entry: VALUES row for search_idx (rowid, body, kind, course_id, ref_id, label). */
#define S_TITLE(r) "(" K1 " * 1 + " r ".id, fold(" r ".title), 'title', " r ".id, " r ".id, " r ".title)"
#define S_LANG(r) "(" K1 " * 2 + " r ".id, fold(" r ".to_lang), 'language', " r ".id, " r ".id, " r ".to_lang)"
#define S_DESC(r) "(" K1 " * 3 + " r ".id, fold(" r ".description), 'description', " r ".id, " r ".id, '')"
#define S_DECK(r) "(" K1 " * 4 + " r ".id, fold(" r ".title), 'deck', " r ".course_id, " r ".id, " r ".title)"
#define S_WORD(r)                                                                                                                                    \
  "(" K1 " * 5 + " r ".id, fold(" r ".lt || ' ' || " r ".en || ' ' || " r ".also), 'word',"                                                       \
  " (SELECT u.course_id FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.id = " r ".lesson_id), " r ".id, " r ".lt)"
#define S_USER(r) "(" K1 " * 6 + " r ".id, fold(COALESCE(" r ".username, '') || ' ' || " r ".name), 'user', NULL, " r ".id, " r ".username)"
#define S_INSERT "INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) VALUES "
#define S_DROP(k, r) "DELETE FROM search_idx WHERE rowid = " K1 " * " #k " + " r ".id;"

static const char *SEARCH_SCHEMA =
    "CREATE VIRTUAL TABLE IF NOT EXISTS search_idx USING fts5(body, kind UNINDEXED, course_id UNINDEXED, ref_id UNINDEXED, label UNINDEXED,"
    "  tokenize = 'trigram');"
    "CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
    "CREATE TRIGGER IF NOT EXISTS search_course_ai AFTER INSERT ON courses BEGIN " S_INSERT S_TITLE("new") "," S_LANG("new") "," S_DESC("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_course_au AFTER UPDATE OF title, to_lang, description ON courses BEGIN "
    S_DROP(1, "old") S_DROP(2, "old") S_DROP(3, "old") S_INSERT S_TITLE("new") "," S_LANG("new") "," S_DESC("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_course_ad AFTER DELETE ON courses BEGIN " S_DROP(1, "old") S_DROP(2, "old") S_DROP(3, "old") " END;"
    "CREATE TRIGGER IF NOT EXISTS search_unit_ai AFTER INSERT ON units BEGIN " S_INSERT S_DECK("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_unit_au AFTER UPDATE OF title, course_id ON units BEGIN " S_DROP(4, "old") S_INSERT S_DECK("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_unit_ad AFTER DELETE ON units BEGIN " S_DROP(4, "old") " END;"
    "CREATE TRIGGER IF NOT EXISTS search_word_ai AFTER INSERT ON words BEGIN " S_INSERT S_WORD("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_word_au AFTER UPDATE OF lt, en, also, lesson_id ON words BEGIN " S_DROP(5, "old") S_INSERT S_WORD("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_word_ad AFTER DELETE ON words BEGIN " S_DROP(5, "old") " END;"
    "CREATE TRIGGER IF NOT EXISTS search_user_ai AFTER INSERT ON users BEGIN " S_INSERT S_USER("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_user_au AFTER UPDATE OF username, name ON users BEGIN " S_DROP(6, "old") S_INSERT S_USER("new") "; END;"
    "CREATE TRIGGER IF NOT EXISTS search_user_ad AFTER DELETE ON users BEGIN " S_DROP(6, "old") " END;";

/* Rebuilds the whole index (first start, upgrades, or a new SEARCH_VERSION). */
static void search_rebuild(void) {
  long long t0 = now_ms();
  sqlite3_exec(s_db, "BEGIN", NULL, NULL, NULL);
  db_exec("DELETE FROM search_idx", "");
  db_exec("INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) SELECT " K1 " * 1 + c.id, fold(c.title), 'title', c.id, c.id, c.title FROM courses c", "");
  db_exec("INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) SELECT " K1 " * 2 + c.id, fold(c.to_lang), 'language', c.id, c.id, c.to_lang FROM courses c", "");
  db_exec("INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) SELECT " K1 " * 3 + c.id, fold(c.description), 'description', c.id, c.id, '' FROM courses c", "");
  db_exec("INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) SELECT " K1 " * 4 + u.id, fold(u.title), 'deck', u.course_id, u.id, u.title FROM units u", "");
  db_exec("INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) SELECT " K1 " * 5 + w.id, fold(w.lt || ' ' || w.en || ' ' || w.also), 'word',"
          " u.course_id, w.id, w.lt FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id",
          "");
  db_exec("INSERT INTO search_idx (rowid, body, kind, course_id, ref_id, label) SELECT " K1 " * 6 + p.id, fold(COALESCE(p.username, '') || ' ' || p.name), 'user',"
          " NULL, p.id, p.username FROM users p",
          "");
  db_exec("INSERT OR REPLACE INTO search_meta (key, value) VALUES ('version', ?)", "s", SEARCH_VERSION);
  sqlite3_exec(s_db, "COMMIT", NULL, NULL, NULL);
  MG_INFO(("search index built: %lld entries in %lld ms", db_int(0, "SELECT COUNT(*) FROM search_idx", ""), now_ms() - t0));
}

/* ---- usernames */

static int username_free(const char *name, long long except_uid) {
  return !IN(name, RESERVED_USERNAMES) && db_int(0, "SELECT COUNT(*) FROM users WHERE username = ? COLLATE NOCASE AND id <> ?", "si", name, except_uid) == 0;
}

/* Gives a user without one a username made from their name (letters and digits), e.g. "Rūta K." -> "rtak", "ruta2". */
static void ensure_username(long long uid) {
  if (db_int(1, "SELECT username IS NOT NULL FROM users WHERE id = ?", "i", uid)) return;
  char *name = db_text("SELECT name FROM users WHERE id = ?", "i", uid);
  char base[16] = "";
  size_t n = 0;
  for (const char *p = name != NULL ? name : ""; *p && n < 12; p++) {
    char ch = *p;
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) base[n++] = ch;
    else if (ch >= 'A' && ch <= 'Z') base[n++] = (char) (ch + 32);
  }
  base[n] = '\0';
  free(name);
  if (n < 3) snprintf(base, sizeof(base), "learner");
  char cand[24];
  for (int i = 1; i < 100000; i++) {
    if (i == 1) snprintf(cand, sizeof(cand), "%s", base);
    else snprintf(cand, sizeof(cand), "%s%d", base, i);
    if (username_free(cand, uid)) {
      db_exec("UPDATE users SET username = ? WHERE id = ?", "si", cand, uid);
      return;
    }
  }
}

/* ---- courses: who may see and edit them, which one you're on */

static int is_admin(long long uid);

static int course_exists(long long cid) {
  return db_int(0, "SELECT COUNT(*) FROM courses WHERE id = ?", "i", cid) == 1;
}

/* The creator edits their course. Admins edit only the official account's courses; other people's courses they
 * can hide or unhide (see /api/admin/courses), never change. */
static int can_edit(long long uid, long long cid) {
  if (!course_exists(cid)) return 0;
  if (db_int(0, "SELECT creator_id = ? FROM courses WHERE id = ?", "ii", uid, cid) == 1) return 1;
  return db_int(0, "SELECT u.is_official FROM courses c JOIN users u ON u.id = c.creator_id WHERE c.id = ?", "i", cid) == 1 && is_admin(uid);
}

/* Hidden courses (hidden by an admin) are only visible to their creator and admins. */
static int can_view(long long uid, long long cid) {
  if (!course_exists(cid)) return 0;
  return db_int(0, "SELECT hidden = 0 OR creator_id = ? FROM courses WHERE id = ?", "ii", uid, cid) == 1 || is_admin(uid);
}

/* Whether you may learn from the course: you can see it, and it's open to you (see HAS_ACCESS_SQL). Admins can
 * open any course, to moderate it. */
static int has_access(long long uid, long long cid) {
  if (!can_view(uid, cid)) return 0;
  return db_int(0, "SELECT " HAS_ACCESS_SQL("?2", "r") " FROM courses r WHERE r.id = ?2", "ii", uid, cid) == 1 || is_admin(uid);
}

#define LOCKED_MSG "This course is locked. Enter an access code from its creator to open it."

static long long course_of_unit(long long id) {
  return db_int(0, "SELECT course_id FROM units WHERE id = ?", "i", id);
}
static long long course_of_lesson(long long id) {
  return db_int(0, "SELECT u.course_id FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.id = ?", "i", id);
}
static long long course_of_word(long long id) {
  return db_int(0, "SELECT u.course_id FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE w.id = ?", "i", id);
}

static void enroll(long long uid, long long cid, int make_current) {
  db_exec("INSERT OR IGNORE INTO enrollments (user_id, course_id, enrolled_at) VALUES (?, ?, ?)", "iii", uid, cid, now_ms());
  if (make_current) db_exec("UPDATE users SET current_course_id = ? WHERE id = ?", "ii", cid, uid);
}

/* The course to show: your current one if you can still see it, else your newest enrollment, else none (0). */
static long long current_course(long long uid) {
  long long cid = db_int(0, "SELECT current_course_id FROM users WHERE id = ?", "i", uid);
  if (cid > 0 && can_view(uid, cid) && db_int(0, "SELECT COUNT(*) FROM enrollments WHERE user_id = ? AND course_id = ?", "ii", uid, cid)) return cid;
  cid = db_int(0, "SELECT e.course_id FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ? AND (c.hidden = 0 OR c.creator_id = ?)"
                  " ORDER BY e.enrolled_at DESC LIMIT 1",
               "ii", uid, uid);
  db_exec("UPDATE users SET current_course_id = NULLIF(?, 0) WHERE id = ?", "ii", cid, uid);
  return cid;
}

/* `?course=` from the query if it's a course you may see, else your current course. */
static long long requested_course(struct mg_http_message *hm, long long uid) {
  char buf[24] = "";
  mg_http_get_var(&hm->query, "course", buf, sizeof(buf));
  long long cid = buf[0] ? strtoll(buf, NULL, 10) : 0;
  return cid > 0 && has_access(uid, cid) ? cid : current_course(uid);
}

/* After signing in: a username, and new players start on the official course. */
static void onboard(long long uid) {
  ensure_username(uid);
  if (db_int(0, "SELECT COUNT(*) FROM enrollments WHERE user_id = ?", "i", uid) == 0) {
    long long cid = db_int(0, "SELECT c.id FROM courses c JOIN users cu ON cu.id = c.creator_id WHERE cu.is_official = 1 AND c.hidden = 0 ORDER BY c.id LIMIT 1", "");
    if (cid > 0) enroll(uid, cid, 1);
  }
}

static void learn_init(const char *seed_path, const char *admins) {
  sqlite3_create_function(s_db, "fold", 1, SQLITE_UTF8 | SQLITE_DETERMINISTIC | SQLITE_INNOCUOUS, NULL, sql_fold, NULL, NULL);
  if (sqlite3_exec(s_db, LEARN_SCHEMA, NULL, NULL, NULL) != SQLITE_OK) MG_ERROR(("learn schema: %s", sqlite3_errmsg(s_db)));
  for (size_t i = 0; i < sizeof(ADDED_COLUMNS) / sizeof(ADDED_COLUMNS[0]); i++) sqlite3_exec(s_db, ADDED_COLUMNS[i], NULL, NULL, NULL);
  if (sqlite3_exec(s_db, LEARN_INDEXES, NULL, NULL, NULL) != SQLITE_OK) MG_ERROR(("learn indexes: %s", sqlite3_errmsg(s_db)));
  if (sqlite3_exec(s_db, SEARCH_SCHEMA, NULL, NULL, NULL) != SQLITE_OK) MG_ERROR(("search index: %s", sqlite3_errmsg(s_db)));
  size_t n = 0;
  for (const char *a = admins; *a && n + 1 < sizeof(s_admins); a++)
    if (*a != ' ') s_admins[n++] = (char) ((*a >= 'A' && *a <= 'Z') ? *a + 32 : *a);
  s_admins[n] = '\0';

  long long official = official_user();
  char *json = read_file(seed_path);
  struct mg_str seed = mg_str(json != NULL ? json : "{}");
  if (db_int(0, "SELECT COUNT(*) FROM courses", "") == 0) {
    long long cid = create_course_from_meta(official, seed);
    if (db_int(0, "SELECT COUNT(*) FROM units", "") == 0) {
      if (json != NULL) learn_seed(seed, cid);
      else MG_INFO(("no starter content at %s", seed_path));
    }
    /* Upgrading from the single-course version: the existing decks become the official course, and everyone who
     * played is enrolled in it. */
    if (db_exec("UPDATE units SET course_id = ? WHERE course_id IS NULL", "i", cid) == SQLITE_DONE && sqlite3_changes(s_db) > 0)
      MG_INFO(("moved the existing decks into the official course"));
    db_exec("INSERT OR IGNORE INTO enrollments (user_id, course_id, enrolled_at) SELECT id, ?, ? FROM users WHERE provider <> 'system'", "ii", cid, now_ms());
    db_exec("UPDATE users SET current_course_id = ? WHERE current_course_id IS NULL AND provider <> 'system'", "i", cid);
  }
  free(json);
  /* Everyone gets a username. */
  sqlite3_stmt *st = NULL;
  if (sqlite3_prepare_v2(s_db, "SELECT id FROM users WHERE username IS NULL", -1, &st, NULL) == SQLITE_OK) {
    long long ids[4096];
    int k = 0;
    while (k < 4096 && sqlite3_step(st) == SQLITE_ROW) ids[k++] = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    for (int i = 0; i < k; i++) ensure_username(ids[i]);
  }
  char *version = db_text("SELECT value FROM search_meta WHERE key = 'version'", "");
  if (version == NULL || strcmp(version, SEARCH_VERSION) != 0) search_rebuild();
  free(version);
  pool_reset();
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
#define IN_COURSE " AND p.word_id IN (SELECT w.id FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE u.course_id = ?)"

/* Hearts, XP and streak are yours across all courses; learned and due words are for course `cid`. */
static char *stats_json(long long uid, long long cid) {
  long long next = 0, now = now_ms();
  int hearts = hearts_now(uid, &next);
  long long xp = db_int(0, "SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE user_id = ?", "i", uid);
  long long week = db_int(0, "SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE user_id = ? AND at >= " WEEK_START_MS, "i", uid);
  long long learned = db_int(0, "SELECT COUNT(*) FROM word_progress p WHERE p.user_id = ?" IN_COURSE, "ii", uid, cid);
  long long due = db_int(0, "SELECT COUNT(*) FROM word_progress p WHERE p.user_id = ? AND p.due_at <= ?" IN_COURSE, "iii", uid, now, cid);
  long long next_due = db_int(0, "SELECT MIN(p.due_at) FROM word_progress p WHERE p.user_id = ? AND p.due_at > ?" IN_COURSE, "iii", uid, now, cid);
  /* XP per day for the last 14 days (oldest first), for the activity chart. */
  char *days = db_text("WITH RECURSIVE d(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM d WHERE n < 13)"
                       " SELECT json_group_array(json_object('day', day, 'xp', (SELECT COALESCE(SUM(xp), 0) FROM xp_events"
                       "   WHERE user_id = ?1 AND at >= CAST(strftime('%s', day) AS INTEGER) * 1000 AND at < CAST(strftime('%s', day, '+1 day') AS INTEGER) * 1000)))"
                       " FROM (SELECT date('now', '-' || n || ' days') AS day FROM d ORDER BY n DESC)",
                       "i", uid);
  char *out = mg_mprintf("{\"xp\":%lld,\"weekXp\":%lld,\"hearts\":%d,\"maxHearts\":%d,\"nextHeartMs\":%lld,\"streak\":%d,\"learned\":%lld,\"due\":%lld,"
                         "\"nextDueAt\":%lld,\"days\":%s}",
                         xp, week, hearts, MAX_HEARTS, next, streak_days(uid), learned, due, next_due, days != NULL ? days : "[]");
  free(days);
  return out;
}

/* The course as a card (see COURSE_JSON) for viewer `uid`, malloc'd, or NULL. */
static char *course_json(long long cid, long long uid) {
  return db_text("SELECT " COURSE_JSON COURSE_FROM " WHERE c.id = ?2", "ii", uid, cid);
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

/* {"course": ..., "units": [...], "stats": ..., "myCourses": [...]} for course `cid` (0: no course yet). */
static void reply_learn_path(struct mg_connection *c, long long uid, long long cid) {
  char *course = cid > 0 ? course_json(cid, uid) : NULL;
  char *units = db_text(
      "SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'description', u.description, 'level', u.level,"
      "  'feedbackSent', " JBOOL("EXISTS (SELECT 1 FROM unit_feedback f WHERE f.unit_id = u.id AND f.user_id = ?1)") ","
      "  'lessons',"
      "  (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title,"
      "     'total', (SELECT COUNT(*) FROM words w WHERE w.lesson_id = l.id),"
      "     'done', (SELECT COUNT(*) FROM words w JOIN word_progress p ON p.word_id = w.id AND p.user_id = ?1 WHERE w.lesson_id = l.id)) AS y"
      "   FROM lessons l WHERE l.unit_id = u.id ORDER BY l.position, l.id))) AS x"
      " FROM units u WHERE u.course_id = ?2 ORDER BY u.position, u.id)",
      "ii", uid, cid);
  char *mine = db_text("SELECT json_group_array(json(x)) FROM (SELECT " COURSE_JSON " AS x" COURSE_FROM " JOIN enrollments en ON en.course_id = c.id AND en.user_id = ?1"
                       " WHERE c.hidden = 0 OR c.creator_id = ?1 ORDER BY en.enrolled_at)",
                       "i", uid);
  char *stats = stats_json(uid, cid);
  char *body = mg_mprintf("{\"course\":%s,\"units\":%s,\"stats\":%s,\"myCourses\":%s}", course != NULL ? course : "null", units != NULL ? units : "[]", stats,
                          mine != NULL ? mine : "[]");
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(mine);
  free(units);
  free(course);
}

static void reply_lesson(struct mg_connection *c, long long uid, long long lesson_id) {
  long long cid = course_of_lesson(lesson_id);
  if (cid == 0 || !can_view(uid, cid)) return reply_error(c, 404, "No such lesson");
  if (!has_access(uid, cid)) return reply_error(c, 423, LOCKED_MSG);
  enroll(uid, cid, db_int(0, "SELECT COUNT(*) FROM enrollments WHERE user_id = ? AND course_id = ?", "ii", uid, cid) == 0); /* starting a lesson joins the course */
  char *lesson = db_text("SELECT json_object('id', l.id, 'title', l.title, 'unitId', u.id, 'unitTitle', u.title, 'level', u.level)"
                         " FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.id = ?",
                         "i", lesson_id);
  char *course = course_json(cid, uid);
  char *targets = db_text("SELECT json_group_array(json(x)) FROM (SELECT " WORD_JSON " AS x FROM words w JOIN lessons l ON l.id = w.lesson_id"
                          " WHERE w.lesson_id = ?1 ORDER BY w.position, w.id)",
                          "ii", lesson_id, uid);
  char *challenges = challenges_for(targets, "lesson", cid);
  char *stats = stats_json(uid, cid);
  char *body = mg_mprintf("{\"lesson\":%s,\"course\":%s,\"challenges\":%s,\"stats\":%s}", lesson, course != NULL ? course : "null", challenges, stats);
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(challenges);
  free(targets);
  free(course);
  free(lesson);
}

/* A review session in your current course: the words that are due, most overdue first. */
static void reply_review(struct mg_connection *c, long long uid, long long cid) {
  char *targets = db_text("SELECT json_group_array(json(x)) FROM (SELECT " WORD_JSON " AS x FROM word_progress p0"
                          " JOIN words w ON w.id = p0.word_id JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id"
                          " WHERE p0.user_id = ?2 AND p0.due_at <= ?1 AND u.course_id = ?3 ORDER BY p0.due_at, w.id LIMIT " REVIEW_BATCH ")",
                          "iii", now_ms(), uid, cid);
  char *challenges = challenges_for(targets, "review", cid);
  char *course = cid > 0 ? course_json(cid, uid) : NULL;
  char *stats = stats_json(uid, cid);
  char *body = mg_mprintf("{\"course\":%s,\"challenges\":%s,\"stats\":%s}", course != NULL ? course : "null", challenges, stats);
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(course);
  free(challenges);
  free(targets);
}

/* Every word in course `cid`, with your progress on it. */
static void reply_words(struct mg_connection *c, long long uid, long long cid) {
  char *units = db_text(
      "SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'level', u.level, 'lessons',"
      "  (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title, 'words',"
      "     (SELECT json_group_array(json(z)) FROM (SELECT json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender,"
      "        'note', w.note, 'learned', " JBOOL("p.word_id IS NOT NULL") ", 'dueAt', p.due_at, 'reps', p.reps) AS z"
      "      FROM words w LEFT JOIN word_progress p ON p.word_id = w.id AND p.user_id = ?1 WHERE w.lesson_id = l.id ORDER BY w.position, w.id))) AS y"
      "   FROM lessons l WHERE l.unit_id = u.id ORDER BY l.position, l.id))) AS x"
      " FROM units u WHERE u.course_id = ?2 ORDER BY u.position, u.id)",
      "ii", uid, cid);
  char *course = cid > 0 ? course_json(cid, uid) : NULL;
  char *stats = stats_json(uid, cid);
  char *body = mg_mprintf("{\"course\":%s,\"units\":%s,\"stats\":%s,\"now\":%lld}", course != NULL ? course : "null", units != NULL ? units : "[]", stats, now_ms());
  reply_json(c, 200, body, NULL);
  free(body);
  free(stats);
  free(course);
  free(units);
}

/* Checks one answer. Lessons: correct = +XP (and +1 heart when practising a learned word); wrong = -1 heart.
 * Producing a word correctly (type or build) for the first time marks it learned. Reviews cost no hearts:
 * they reschedule the word, and earn XP only when it was due. */
static void answer_word(struct mg_connection *c, struct mg_http_message *hm, long long uid, long long wid) {
  long long cid = course_of_word(wid);
  if (cid == 0 || !can_view(uid, cid)) return reply_error(c, 404, "No such word");
  if (!has_access(uid, cid)) return reply_error(c, 423, LOCKED_MSG);
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
                         MG_ESC("You're out of hearts. Practise a finished lesson or wait for a heart to come back."), MG_ESC("hearts"));

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
    char *others = db_text("SELECT json_group_array(w.lt) FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id"
                           " WHERE u.course_id = ? AND w.id <> ?",
                           "ii", cid, wid);
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
    if (conf != NULL)
      confused = db_text("SELECT json_object('lt', w.lt, 'en', w.en) FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id"
                         " WHERE u.course_id = ? AND w.lt = ? LIMIT 1",
                         "is", cid, conf);
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
    if (!practice && is_text) srs_learn(uid, wid);
  }
  if (xp > 0) db_exec("INSERT INTO xp_events (user_id, xp, at) VALUES (?, ?, ?)", "iii", uid, (long long) xp, now_ms());

  char *word = db_text("SELECT json_object('id', id, 'lt', lt, 'en', en, 'pos', pos, 'gender', gender, 'note', note) FROM words WHERE id = ?", "i", wid);
  char *expected = grade != NULL ? mg_json_get_str(mg_str(grade), "$.expected") : NULL;
  char *stats = stats_json(uid, cid);
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
      "WITH s AS (SELECT u.id, u.name, u.username, u.picture, SUM(x.xp) AS xp FROM users u JOIN xp_events x ON x.user_id = u.id AND x.at >= ?1 GROUP BY u.id),"
      " r AS (SELECT *, RANK() OVER (ORDER BY xp DESC) AS rank FROM s)"
      " SELECT json_object('period', ?3, 'rows',"
      "  (SELECT json_group_array(json_object('rank', rank, 'name', name, 'username', username, 'picture', picture, 'xp', xp,"
      "     'isYou', " JBOOL("id = ?2") ")) FROM (SELECT * FROM r ORDER BY rank, name LIMIT 20)),"
      "  'me', (SELECT json_object('rank', rank, 'xp', xp) FROM r WHERE id = ?2))",
      "iis", since, uid, all ? "all" : "week");
  reply_json(c, 200, board != NULL ? board : "{\"rows\":[],\"me\":null}", NULL);
  free(board);
}

static char *body_str(struct mg_http_message *hm, const char *path, size_t max_chars);

static const char *FEEDBACK_CATEGORIES[] = {"too-easy", "too-hard", "mistake", "idea"};

static void send_feedback(struct mg_connection *c, struct mg_http_message *hm, long long uid, long long unit_id) {
  long long cid = course_of_unit(unit_id);
  if (cid == 0 || !can_view(uid, cid)) return reply_error(c, 404, "No such deck");
  /* A light limit against spam: 5 suggestions per unit per player per day. */
  if (db_int(0, "SELECT COUNT(*) FROM unit_feedback WHERE unit_id = ? AND user_id = ? AND created_at > ?", "iii", unit_id, uid, now_ms() - DAY_MS) >= 5)
    return reply_error(c, 429, "Thanks! You've sent a lot of suggestions for this deck today. Try again tomorrow.");
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
    reply_learn_path(c, uid, requested_course(hm, uid));
    return 1;
  }
  if (method_is(hm, "POST") && uri_is(hm, "/api/learn/current")) {
    if (!require_json(c, hm)) return 1;
    long long cid = mg_json_get_long(hm->body, "$.courseId", 0);
    if (!can_view(uid, cid)) reply_error(c, 404, "No such course");
    else if (!has_access(uid, cid)) reply_error(c, 423, LOCKED_MSG);
    else {
      enroll(uid, cid, 1);
      reply_learn_path(c, uid, cid);
    }
    return 1;
  }
  if (method_is(hm, "GET") && uri_is(hm, "/api/learn/review")) {
    reply_review(c, uid, requested_course(hm, uid));
    return 1;
  }
  if (method_is(hm, "GET") && uri_is(hm, "/api/learn/words")) {
    reply_words(c, uid, requested_course(hm, uid));
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

/* ---------------------------------------------------------------- the studio: editing a course (its creator, or admins) */

static char *studio_content_json(long long cid, long long uid) {
  return db_text(
      "SELECT json_object('course', (SELECT " COURSE_JSON COURSE_FROM " WHERE c.id = ?2),"
      " 'units', (SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'level', u.level,"
      " 'newFeedback', (SELECT COUNT(*) FROM unit_feedback f WHERE f.unit_id = u.id AND f.status = 'new'),"
      " 'description', u.description, 'lessons', (SELECT json_group_array(json(y)) FROM (SELECT json_object('id', l.id, 'title', l.title,"
      "   'words', (SELECT json_group_array(json(z)) FROM (SELECT json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender,"
      "     'also', w.also, 'note', w.note) AS z FROM words w WHERE w.lesson_id = l.id ORDER BY w.position, w.id))) AS y"
      "   FROM lessons l WHERE l.unit_id = u.id ORDER BY l.position, l.id))) AS x FROM units u WHERE u.course_id = ?2 ORDER BY u.position, u.id)),"
      " 'newFeedback', (SELECT COUNT(*) FROM unit_feedback f JOIN units u ON u.id = f.unit_id WHERE u.course_id = ?2 AND f.status = 'new'))",
      "ii", uid, cid);
}

static void reply_studio(struct mg_connection *c, long long cid, long long uid, int status) {
  char *content = studio_content_json(cid, uid);
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
  if (strcmp(kind, "unit") == 0) table = "units", parent = "course_id";
  else if (strcmp(kind, "lesson") == 0) table = "lessons", parent = "unit_id";
  else if (strcmp(kind, "word") == 0) table = "words", parent = "lesson_id";
  else return "Unknown kind";
  char sql[600];
  snprintf(sql, sizeof(sql), "SELECT %s FROM %s WHERE id = ?", parent, table);
  long long pid = db_int(-1, sql, "i", id);
  if (pid < 0) return "Not found";
  snprintf(sql, sizeof(sql),
           "UPDATE %s SET position = (SELECT COUNT(*) FROM %s t2 WHERE t2.%s = %s.%s AND (t2.position < %s.position OR"
           " (t2.position = %s.position AND t2.id < %s.id))) WHERE %s = ?",
           table, table, parent, table, parent, table, table, table, parent);
  db_exec(sql, "i", pid);
  snprintf(sql, sizeof(sql), "SELECT position FROM %s WHERE id = ?", table);
  long long pos = db_int(-1, sql, "i", id);
  snprintf(sql, sizeof(sql), "SELECT id FROM %s WHERE %s = ? AND position = ?", table, parent);
  long long other = db_int(-1, sql, "ii", pid, pos + dir);
  if (other < 0) return NULL; /* already first/last */
  snprintf(sql, sizeof(sql), "UPDATE %s SET position = ? WHERE id = ?", table);
  db_exec(sql, "ii", pos + dir, id);
  db_exec(sql, "ii", pos, other);
  return NULL;
}

/* Saves a word from the request body (insert when id < 0) in course `cid`. Returns an error message or NULL. */
static const char *save_word(struct mg_http_message *hm, long long id, long long cid) {
  static char msg[240];
  char *lt = body_str(hm, "$.lt", 100);
  char *en = body_str(hm, "$.en", 100);
  char *pos = body_str(hm, "$.pos", 10);
  char *gender = body_str(hm, "$.gender", 4);
  char *also = body_str(hm, "$.also", 200);
  char *note = body_str(hm, "$.note", 200);
  long long lesson_id = id < 0 ? mg_json_get_long(hm->body, "$.lessonId", -1) : db_int(-1, "SELECT lesson_id FROM words WHERE id = ?", "i", id);
  const char *err = NULL;
  if (lt == NULL) err = "Write the word or phrase you're teaching";
  else if (en == NULL) err = "Write what it means in English";
  else if (!IN(pos, POS_VALUES)) err = "Pick a part of speech";
  else if (gender != NULL && !IN(gender, GENDER_VALUES)) err = "Pick a gender";
  else if (course_of_lesson(lesson_id) != cid) err = "That lesson isn't in this course";
  else if (db_int(0, "SELECT COUNT(*) FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE u.course_id = ?", "i", cid) >= 5000)
    err = "A course can have at most 5000 words";
  else {
    char *where = db_text("SELECT u.title || ' › ' || l.title FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id"
                          " WHERE u.course_id = ? AND lower(w.lt) = lower(?) AND w.id <> ? LIMIT 1",
                          "isi", cid, lt, id);
    if (where != NULL) {
      snprintf(msg, sizeof(msg), "“%s” is already in this course (%s). Each word should appear once.", lt, where);
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

/* ---- access codes */

static const char TOKEN_ALPHABET[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* 32 letters: no I, O, 0, 1 */
#define TOKEN_GROUPS 3
#define TOKEN_GROUP_LEN 5 /* 15 letters x 5 bits = 75 random bits, e.g. K7QX4-M2PRT-9HZBN */

static void new_token(char out[TOKEN_GROUPS * (TOKEN_GROUP_LEN + 1)]) {
  unsigned char r[TOKEN_GROUPS * TOKEN_GROUP_LEN];
  random_bytes(r, sizeof(r));
  size_t o = 0;
  for (int i = 0; i < TOKEN_GROUPS * TOKEN_GROUP_LEN; i++) {
    if (i > 0 && i % TOKEN_GROUP_LEN == 0) out[o++] = '-';
    out[o++] = TOKEN_ALPHABET[r[i] & 31];
  }
  out[o] = '\0';
}

/* A code as typed (any case, spaces or dashes anywhere) in its stored form, or "" if it can't be one. */
static void canonical_token(const char *in, char out[TOKEN_GROUPS * (TOKEN_GROUP_LEN + 1)]) {
  char raw[TOKEN_GROUPS * TOKEN_GROUP_LEN + 1];
  size_t n = 0;
  for (const char *p = in; *p; p++) {
    char ch = (char) (*p >= 'a' && *p <= 'z' ? *p - 32 : *p);
    if (ch == ' ' || ch == '-') continue;
    if (n == sizeof(raw) - 1 || strchr(TOKEN_ALPHABET, ch) == NULL || ch == '\0') {
      out[0] = '\0';
      return;
    }
    raw[n++] = ch;
  }
  if (n != TOKEN_GROUPS * TOKEN_GROUP_LEN) {
    out[0] = '\0';
    return;
  }
  size_t o = 0;
  for (size_t i = 0; i < n; i++) {
    if (i > 0 && i % TOKEN_GROUP_LEN == 0) out[o++] = '-';
    out[o++] = raw[i];
  }
  out[o] = '\0';
}

#define TOKEN_STATS                                                                                                                                \
  "'unused', (SELECT COUNT(*) FROM course_tokens WHERE course_id = ?1 AND used_at IS NULL),"                                                     \
  " 'used', (SELECT COUNT(*) FROM course_tokens WHERE course_id = ?1 AND used_at IS NOT NULL)"

/* GET /tokens: counts and recent redemptions. POST /tokens {count}: new codes (1-500). DELETE /tokens: revoke all
 * unused codes. GET /tokens.txt: every unused code, one per line, as a download. */
static void studio_tokens(struct mg_connection *c, struct mg_http_message *hm, long long uid, long long cid, int txt) {
  (void) uid;
  if (txt) {
    if (!method_is(hm, "GET")) return reply_error(c, 405, "Use GET");
    char *codes = db_text("SELECT group_concat(code, char(10)) FROM (SELECT code FROM course_tokens WHERE course_id = ? AND used_at IS NULL ORDER BY id)", "i", cid);
    char *headers = mg_mprintf("Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
                               "Content-Disposition: attachment; filename=\"course-%lld-unused-codes.txt\"\r\n",
                               cid);
    mg_http_reply(c, 200, headers, "%s%s", codes != NULL ? codes : "", codes != NULL ? "\n" : "");
    free(headers);
    free(codes);
    return;
  }
  if (method_is(hm, "POST")) {
    if (!require_json(c, hm)) return;
    long long count = mg_json_get_long(hm->body, "$.count", 0);
    if (count < 1 || count > 500) return reply_error(c, 400, "Create between 1 and 500 codes at a time");
    if (db_int(0, "SELECT COUNT(*) FROM course_tokens WHERE course_id = ? AND used_at IS NULL", "i", cid) + count > 50000)
      return reply_error(c, 400, "A course can have at most 50,000 unused codes. Revoke some first.");
    char *list = strdup("[");
    long long now = now_ms();
    sqlite3_exec(s_db, "BEGIN", NULL, NULL, NULL);
    for (long long i = 0; i < count; i++) {
      char code[TOKEN_GROUPS * (TOKEN_GROUP_LEN + 1)];
      int rc = SQLITE_CONSTRAINT;
      for (int tries = 0; tries < 5 && rc == SQLITE_CONSTRAINT; tries++) {
        new_token(code);
        rc = db_exec("INSERT INTO course_tokens (course_id, code, created_at) VALUES (?, ?, ?)", "isi", cid, code, now);
      }
      if (rc != SQLITE_DONE) continue;
      char *next = mg_mprintf("%s%s%m", list, i ? "," : "", MG_ESC(code));
      free(list);
      list = next;
    }
    sqlite3_exec(s_db, "COMMIT", NULL, NULL, NULL);
    char *stats = db_text("SELECT json_object(" TOKEN_STATS ")", "i", cid);
    char *body = mg_mprintf("{\"codes\":%s],\"stats\":%s}", list, stats != NULL ? stats : "{}");
    reply_json(c, 201, body, NULL);
    free(body);
    free(stats);
    free(list);
    return;
  }
  if (method_is(hm, "DELETE")) db_exec("DELETE FROM course_tokens WHERE course_id = ? AND used_at IS NULL", "i", cid);
  else if (!method_is(hm, "GET")) return reply_error(c, 405, "Method not allowed");
  char *body = db_text("SELECT json_object(" TOKEN_STATS ", 'recent', (SELECT json_group_array(json(x)) FROM (SELECT json_object('code', t.code, 'usedAt', t.used_at,"
                       "  'user', CASE WHEN u.id IS NULL THEN NULL ELSE json_object('username', u.username, 'name', u.name, 'picture', u.picture) END) AS x"
                       "  FROM course_tokens t LEFT JOIN users u ON u.id = t.used_by WHERE t.course_id = ?1 AND t.used_at IS NOT NULL ORDER BY t.used_at DESC LIMIT 50)))",
                       "i", cid);
  reply_json(c, 200, body != NULL ? body : "{}", NULL);
  free(body);
}

/* /api/studio/<course>/...: editing course content. Returns 1 if it handled the request. */
static int handle_studio(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  struct mg_str caps[3];
  if (!mg_match(hm->uri, mg_str("/api/studio/*/#"), caps) && !mg_match(hm->uri, mg_str("/api/studio/*"), caps)) return 0;
  long long cid = strtoll(caps[0].buf, NULL, 10);
  if (!can_edit(uid, cid)) {
    reply_error(c, course_exists(cid) ? 403 : 404, course_exists(cid) ? "Only the course's creator can edit it" : "No such course");
    return 1;
  }
  int is_get = method_is(hm, "GET"), is_post = method_is(hm, "POST"), is_put = method_is(hm, "PUT"), is_del = method_is(hm, "DELETE");
  if ((is_post || is_put) && !require_json(c, hm)) return 1;
  char prefix[48];
  int plen = snprintf(prefix, sizeof(prefix), "/api/studio/%lld", cid);
  struct mg_str rest = mg_str_n(hm->uri.buf + plen, hm->uri.len > (size_t) plen ? hm->uri.len - (size_t) plen : 0);
  if (hm->uri.len < (size_t) plen || strncmp(hm->uri.buf, prefix, (size_t) plen) != 0) {
    reply_error(c, 404, "Not found");
    return 1;
  }
#define REST_IS(s) (mg_strcmp(rest, mg_str(s)) == 0)
  const char *err = NULL;

  if (REST_IS("/tokens") || REST_IS("/tokens.txt")) {
    studio_tokens(c, hm, uid, cid, REST_IS("/tokens.txt"));
    return 1;
  }

  if (is_get && (REST_IS("") || REST_IS("/content"))) {
    reply_studio(c, cid, uid, 200);
    return 1;
  }

  if (is_get && REST_IS("/feedback")) {
    char status[8] = "new";
    mg_http_get_var(&hm->query, "status", status, sizeof(status));
    char *list = db_text(
        "SELECT json_object('items', (SELECT json_group_array(json(x)) FROM (SELECT json_object('id', f.id, 'unitId', f.unit_id, 'unitTitle', un.title,"
        " 'user', u.name, 'username', u.username, 'picture', u.picture, 'rating', f.rating, 'category', f.category, 'text', f.text, 'status', f.status,"
        " 'createdAt', f.created_at) AS x FROM unit_feedback f JOIN units un ON un.id = f.unit_id JOIN users u ON u.id = f.user_id"
        " WHERE un.course_id = ?2 AND (?1 = 'all' OR f.status = ?1) ORDER BY f.status = 'done', f.created_at DESC LIMIT 200)),"
        " 'newCount', (SELECT COUNT(*) FROM unit_feedback f JOIN units un ON un.id = f.unit_id WHERE un.course_id = ?2 AND f.status = 'new'))",
        "si", strcmp(status, "all") == 0 ? "all" : strcmp(status, "done") == 0 ? "done" : "new", cid);
    reply_json(c, 200, list != NULL ? list : "{\"items\":[],\"newCount\":0}", NULL);
    free(list);
    return 1;
  }
  if ((is_put || is_del) && mg_match(rest, mg_str("/feedback/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (db_int(0, "SELECT un.course_id FROM unit_feedback f JOIN units un ON un.id = f.unit_id WHERE f.id = ?", "i", id) != cid) {
      reply_error(c, 404, "No such suggestion");
      return 1;
    }
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

  if (is_post && REST_IS("/units")) {
    char *title = body_str(hm, "$.title", 80);
    char *desc = body_str(hm, "$.description", 200);
    char *level = body_str(hm, "$.level", 6);
    if (title == NULL) err = "Give the deck a title";
    else if (db_int(0, "SELECT COUNT(*) FROM units WHERE course_id = ?", "i", cid) >= 200) err = "A course can have at most 200 decks";
    else
      db_exec("INSERT INTO units (course_id, title, description, level, position) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position), -1) + 1 FROM units WHERE course_id = ?1))",
              "isss", cid, title, desc != NULL ? desc : "", level != NULL ? level : "");
    free(title);
    free(desc);
    free(level);
  } else if ((is_put || is_del) && mg_match(rest, mg_str("/units/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (course_of_unit(id) != cid) err = "That deck isn't in this course";
    else if (is_del) db_exec("DELETE FROM units WHERE id = ?", "i", id);
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
  } else if (is_post && REST_IS("/lessons")) {
    char *title = body_str(hm, "$.title", 80);
    long long unit_id = mg_json_get_long(hm->body, "$.unitId", -1);
    if (title == NULL) err = "Give the lesson a title";
    else if (course_of_unit(unit_id) != cid) err = "That deck isn't in this course";
    else
      db_exec("INSERT INTO lessons (unit_id, title, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE unit_id = ?1))", "is",
              unit_id, title);
    free(title);
  } else if ((is_put || is_del) && mg_match(rest, mg_str("/lessons/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (course_of_lesson(id) != cid) err = "That lesson isn't in this course";
    else if (is_del) db_exec("DELETE FROM lessons WHERE id = ?", "i", id);
    else {
      char *title = body_str(hm, "$.title", 80);
      if (title == NULL) err = "Give the lesson a title";
      else db_exec("UPDATE lessons SET title = ? WHERE id = ?", "si", title, id);
      free(title);
    }
  } else if (is_post && REST_IS("/words")) {
    err = save_word(hm, -1, cid);
  } else if ((is_put || is_del) && mg_match(rest, mg_str("/words/*"), caps)) {
    long long id = strtoll(caps[0].buf, NULL, 10);
    if (course_of_word(id) != cid) err = "That word isn't in this course";
    else if (is_del) db_exec("DELETE FROM words WHERE id = ?", "i", id);
    else err = save_word(hm, id, cid);
  } else if (is_post && REST_IS("/arrange")) {
    /* Drag and drop: put a deck at `index` in the course, or a lesson at `index` in deck `unitId` (any deck of
     * this course, so lessons can move between decks). The other items keep their order. */
    char *kind = body_str(hm, "$.kind", 10);
    long long id = mg_json_get_long(hm->body, "$.id", -1), index = mg_json_get_long(hm->body, "$.index", -1);
    if (kind == NULL || index < 0) err = "Bad arrangement";
    else if (strcmp(kind, "unit") == 0) {
      if (course_of_unit(id) != cid) err = "That deck isn't in this course";
      else {
        db_exec("WITH o AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rn FROM units WHERE course_id = ?1 AND id <> ?2)"
                " UPDATE units SET position = (SELECT CASE WHEN rn < ?3 THEN rn ELSE rn + 1 END FROM o WHERE o.id = units.id)"
                " WHERE course_id = ?1 AND id <> ?2",
                "iii", cid, id, index);
        db_exec("UPDATE units SET position = MIN(?2, (SELECT COUNT(*) - 1 FROM units WHERE course_id = ?3)) WHERE id = ?1", "iii", id, index, cid);
      }
    } else if (strcmp(kind, "lesson") == 0) {
      long long unit = mg_json_get_long(hm->body, "$.unitId", -1);
      if (course_of_lesson(id) != cid) err = "That lesson isn't in this course";
      else if (course_of_unit(unit) != cid) err = "That deck isn't in this course";
      else {
        db_exec("UPDATE lessons SET unit_id = ? WHERE id = ?", "ii", unit, id);
        db_exec("WITH o AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rn FROM lessons WHERE unit_id = ?1 AND id <> ?2)"
                " UPDATE lessons SET position = (SELECT CASE WHEN rn < ?3 THEN rn ELSE rn + 1 END FROM o WHERE o.id = lessons.id)"
                " WHERE unit_id = ?1 AND id <> ?2",
                "iii", unit, id, index);
        db_exec("UPDATE lessons SET position = MIN(?2, (SELECT COUNT(*) - 1 FROM lessons WHERE unit_id = ?3)) WHERE id = ?1", "iii", id, index, unit);
      }
    } else err = "Unknown kind";
    free(kind);
  } else if (is_post && REST_IS("/move")) {
    char *kind = body_str(hm, "$.kind", 20);
    long long dir = mg_json_get_long(hm->body, "$.dir", 0), id = mg_json_get_long(hm->body, "$.id", -1);
    long long owner = kind == NULL ? 0 : strcmp(kind, "unit") == 0 ? course_of_unit(id) : strcmp(kind, "lesson") == 0 ? course_of_lesson(id) : course_of_word(id);
    err = kind == NULL || (dir != 1 && dir != -1) ? "Bad move" : owner != cid ? "Not in this course" : move_item(kind, id, dir);
    free(kind);
  } else {
    reply_error(c, 404, "Not found");
    return 1;
  }
#undef REST_IS
  touch_course(cid); /* words may have changed: rebuild the option pools on next use */
  if (err != NULL) reply_error(c, 400, err);
  else reply_studio(c, cid, uid, 200);
  return 1;
}
