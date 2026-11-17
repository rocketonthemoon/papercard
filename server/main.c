// Labas server (learn Lithuanian words): one Mongoose (C) program, no Node.js.
//   - serves the game from WEB_ROOT
//   - the /api/* JSON API: Google sign-in, sessions, Learn (learn.c), word duels
//   - SQLite is the source of truth (users, sessions, course, progress, duels); SQLite builds the JSON
//   - memcached caches sessions and duels (optional: misses fall back to SQLite)
//   - exercises, answer grading, duel scoring and Google token checks live in libduelcore (Rust, duelcore.h)
//
// Environment: LISTEN (http://0.0.0.0:8000), WEB_ROOT (/srv/web), DB_FILE (/data/labas.sqlite),
//              MEMCACHED (memcached:11211, empty to disable), GOOGLE_CLIENT_ID, ALLOW_DEV_LOGIN=1, COOKIE_SECURE=1
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include <sqlite3.h>

#include "duelcore.h"
#include "mongoose.h"

#define SESSION_DAYS 30
#define MAX_BODY (64 * 1024)
#define DUEL_WORDS 10
#define SESSION_COOKIE "labas_session"

static const char *s_listen, *s_web_root, *s_db_file, *s_client_id;
static char s_mc_host[128], s_mc_port[16];
static int s_dev_login, s_cookie_secure, s_stop;
static sqlite3 *s_db;

static void on_signal(int sig) {
  (void) sig;
  s_stop = 1;
}

static const char *env_or(const char *name, const char *fallback) {
  const char *v = getenv(name);
  return v != NULL ? v : fallback;
}

static long long now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return (long long) ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void random_bytes(unsigned char *buf, size_t len) {
  int fd = open("/dev/urandom", O_RDONLY);
  size_t got = 0;
  while (fd >= 0 && got < len) {
    ssize_t n = read(fd, buf + got, len - got);
    if (n <= 0) break;
    got += (size_t) n;
  }
  if (fd >= 0) close(fd);
  if (got < len) abort(); /* never hand out predictable codes */
}

/* ---------------------------------------------------------------- memcached (text protocol) */

static int s_mc_fd = -1;
static long long s_mc_down_until;

static void mc_drop(void) {
  if (s_mc_fd >= 0) close(s_mc_fd);
  s_mc_fd = -1;
  s_mc_down_until = now_ms() + 2000; /* back off briefly */
}

static int mc_connect(void) {
  if (s_mc_fd >= 0) return s_mc_fd;
  if (s_mc_host[0] == '\0' || now_ms() < s_mc_down_until) return -1;
  struct addrinfo hints = {0}, *res = NULL;
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  if (getaddrinfo(s_mc_host, s_mc_port, &hints, &res) != 0 || res == NULL) {
    mc_drop();
    return -1;
  }
  int fd = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
  struct timeval tv = {0, 300 * 1000}; /* 300 ms: a slow cache is worse than none */
  if (fd >= 0) {
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  }
  if (fd < 0 || connect(fd, res->ai_addr, res->ai_addrlen) != 0) {
    if (fd >= 0) close(fd);
    freeaddrinfo(res);
    mc_drop();
    return -1;
  }
  freeaddrinfo(res);
  s_mc_fd = fd;
  return fd;
}

static int mc_send_all(const char *buf, size_t len) {
  while (len > 0) {
    ssize_t n = send(s_mc_fd, buf, len, 0);
    if (n <= 0) return -1;
    buf += n;
    len -= (size_t) n;
  }
  return 0;
}

/* Reads until `buf` holds at least `need` bytes (or a full line when need == 0). */
static int mc_read(char **buf, size_t *len, size_t *cap, size_t need) {
  for (;;) {
    if (need > 0 && *len >= need) return 0;
    if (need == 0 && *len >= 2 && memmem(*buf, *len, "\r\n", 2) != NULL) return 0;
    if (*len + 4096 > *cap) {
      *cap = (*len + 4096) * 2;
      *buf = realloc(*buf, *cap);
    }
    ssize_t n = recv(s_mc_fd, *buf + *len, *cap - *len, 0);
    if (n <= 0) return -1;
    *len += (size_t) n;
  }
}

/* Returns a malloc'd value, or NULL on a miss or any error. */
static char *mc_get(const char *key) {
  if (mc_connect() < 0) return NULL;
  char cmd[300];
  int n = snprintf(cmd, sizeof(cmd), "get %s\r\n", key);
  if (n <= 0 || (size_t) n >= sizeof(cmd) || mc_send_all(cmd, (size_t) n) != 0) {
    mc_drop();
    return NULL;
  }
  char *buf = NULL;
  size_t len = 0, cap = 0;
  if (mc_read(&buf, &len, &cap, 0) != 0) goto fail;
  char *eol = memmem(buf, len, "\r\n", 2);
  size_t head = (size_t) (eol - buf) + 2;
  if (head == 5 && memcmp(buf, "END", 3) == 0) {
    free(buf);
    return NULL;
  }
  unsigned flags;
  size_t bytes;
  char name[260];
  if (sscanf(buf, "VALUE %259s %u %zu", name, &flags, &bytes) != 3) goto fail;
  size_t total = head + bytes + 2 + 5; /* data \r\n END\r\n */
  if (mc_read(&buf, &len, &cap, total) != 0) goto fail;
  char *val = malloc(bytes + 1);
  memcpy(val, buf + head, bytes);
  val[bytes] = '\0';
  free(buf);
  return val;
fail:
  free(buf);
  mc_drop();
  return NULL;
}

static void mc_store(const char *cmd_head, const char *value, size_t vlen) {
  if (mc_connect() < 0) return;
  char *buf = NULL;
  size_t len = 0, cap = 0;
  if (mc_send_all(cmd_head, strlen(cmd_head)) != 0 || (value != NULL && (mc_send_all(value, vlen) != 0 || mc_send_all("\r\n", 2) != 0)) ||
      mc_read(&buf, &len, &cap, 0) != 0) {
    mc_drop();
  }
  free(buf);
}

static void mc_set(const char *key, const char *value, int ttl) {
  char head[320];
  size_t vlen = strlen(value);
  snprintf(head, sizeof(head), "set %s 0 %d %zu\r\n", key, ttl, vlen);
  mc_store(head, value, vlen);
}

static void mc_del(const char *key) {
  char head[300];
  snprintf(head, sizeof(head), "delete %s\r\n", key);
  mc_store(head, NULL, 0);
}

/* ---------------------------------------------------------------- SQLite helpers */

/* Binds arguments described by `types`: 's' = const char *, 'i' = long long. */
static sqlite3_stmt *db_prepare(const char *sql, const char *types, va_list ap) {
  sqlite3_stmt *st = NULL;
  if (sqlite3_prepare_v2(s_db, sql, -1, &st, NULL) != SQLITE_OK) {
    MG_ERROR(("sql: %s", sqlite3_errmsg(s_db)));
    return NULL;
  }
  for (int i = 0; types[i]; i++) {
    if (types[i] == 's') {
      const char *v = va_arg(ap, const char *);
      if (v == NULL) sqlite3_bind_null(st, i + 1);
      else sqlite3_bind_text(st, i + 1, v, -1, SQLITE_TRANSIENT);
    } else {
      sqlite3_bind_int64(st, i + 1, va_arg(ap, long long));
    }
  }
  return st;
}

/* Runs a statement; returns the final sqlite3_step result (SQLITE_DONE, SQLITE_ROW or an error). */
static int db_exec(const char *sql, const char *types, ...) {
  va_list ap;
  va_start(ap, types);
  sqlite3_stmt *st = db_prepare(sql, types, ap);
  va_end(ap);
  if (st == NULL) return SQLITE_ERROR;
  int rc = sqlite3_step(st);
  if (rc != SQLITE_DONE && rc != SQLITE_ROW && sqlite3_errcode(s_db) != SQLITE_CONSTRAINT) MG_ERROR(("sql: %s", sqlite3_errmsg(s_db)));
  int ext = sqlite3_extended_errcode(s_db);
  sqlite3_finalize(st);
  return (rc == SQLITE_CONSTRAINT || (ext & 0xff) == SQLITE_CONSTRAINT) ? SQLITE_CONSTRAINT : rc;
}

/* The first column of the first row as a malloc'd string, or NULL. */
static char *db_text(const char *sql, const char *types, ...) {
  va_list ap;
  va_start(ap, types);
  sqlite3_stmt *st = db_prepare(sql, types, ap);
  va_end(ap);
  if (st == NULL) return NULL;
  char *out = NULL;
  if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL) out = strdup((const char *) sqlite3_column_text(st, 0));
  sqlite3_finalize(st);
  return out;
}

static long long db_int(long long fallback, const char *sql, const char *types, ...) {
  va_list ap;
  va_start(ap, types);
  sqlite3_stmt *st = db_prepare(sql, types, ap);
  va_end(ap);
  if (st == NULL) return fallback;
  long long out = fallback;
  if (sqlite3_step(st) == SQLITE_ROW && sqlite3_column_type(st, 0) != SQLITE_NULL) out = sqlite3_column_int64(st, 0);
  sqlite3_finalize(st);
  return out;
}

static const char *SCHEMA =
    "PRAGMA journal_mode = WAL;"
    "PRAGMA foreign_keys = ON;"
    "CREATE TABLE IF NOT EXISTS users ("
    "  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL,"
    "  email TEXT, picture TEXT, created_at INTEGER NOT NULL, UNIQUE (provider, subject));"
    "CREATE TABLE IF NOT EXISTS sessions ("
    "  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
    "  expires_at INTEGER NOT NULL);"
    /* A word duel: the same questions (with their answers, never sent before you play) for every player. */
    "CREATE TABLE IF NOT EXISTS duels ("
    "  code TEXT PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL,"
    "  questions_json TEXT NOT NULL, created_at INTEGER NOT NULL);"
    "CREATE TABLE IF NOT EXISTS duel_views ("
    "  code TEXT NOT NULL REFERENCES duels(code) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),"
    "  opened_at INTEGER NOT NULL, PRIMARY KEY (code, user_id));"
    "CREATE TABLE IF NOT EXISTS submissions ("
    "  code TEXT NOT NULL REFERENCES duels(code) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),"
    "  answers_json TEXT NOT NULL, points INTEGER NOT NULL, correct INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL,"
    "  created_at INTEGER NOT NULL, PRIMARY KEY (code, user_id));"
    "CREATE INDEX IF NOT EXISTS submissions_user ON submissions(user_id);"
    "CREATE INDEX IF NOT EXISTS duels_creator ON duels(creator_id);";

#define USER_JSON                                                                                                                                    "json_object('id', u.id, 'name', u.name, 'username', u.username, 'picture', u.picture, 'bio', u.bio,"                                         " 'isAdmin', json(CASE WHEN u.is_admin = 1 THEN 'true' ELSE 'false' END), 'official', json(CASE WHEN u.is_official = 1 THEN 'true' ELSE 'false' END))"

/* ---------------------------------------------------------------- HTTP helpers */

static void reply_json(struct mg_connection *c, int status, const char *json, const char *extra_headers) {
  mg_http_reply(c, status, extra_headers != NULL ? extra_headers : "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n", "%s",
                json);
}

static void reply_error(struct mg_connection *c, int status, const char *msg) {
  mg_http_reply(c, status, "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n", "{%m:%m}", MG_ESC("error"), MG_ESC(msg));
}

static int method_is(struct mg_http_message *hm, const char *m) {
  return mg_strcmp(hm->method, mg_str(m)) == 0;
}

static int uri_is(struct mg_http_message *hm, const char *u) {
  return mg_strcmp(hm->uri, mg_str(u)) == 0;
}

/* Requiring JSON means cross-site forms can't post here without a CORS preflight (CSRF guard). */
static int require_json(struct mg_connection *c, struct mg_http_message *hm) {
  struct mg_str *ct = mg_http_get_header(hm, "Content-Type");
  if (ct == NULL || ct->len < 16 || strncasecmp(ct->buf, "application/json", 16) != 0) {
    reply_error(c, 415, "Expected JSON");
    return 0;
  }
  if (hm->body.len > MAX_BODY) {
    reply_error(c, 413, "Request too large");
    return 0;
  }
  return 1;
}

static size_t utf8_len(const char *s) {
  size_t n = 0;
  for (; *s; s++)
    if (((unsigned char) *s & 0xC0) != 0x80) n++;
  return n;
}

/* Normalizes newlines and trims whitespace in place. */
static char *clean_text(char *s) {
  char *w = s;
  for (char *r = s; *r; r++)
    if (!(r[0] == '\r' && r[1] == '\n')) *w++ = *r;
  *w = '\0';
  char *start = s;
  while (*start == ' ' || *start == '\n' || *start == '\t' || *start == '\r') start++;
  memmove(s, start, strlen(start) + 1);
  size_t len = strlen(s);
  while (len > 0 && (s[len - 1] == ' ' || s[len - 1] == '\n' || s[len - 1] == '\t' || s[len - 1] == '\r')) s[--len] = '\0';
  return s;
}

/* Cuts `s` to at most `max_chars` characters without splitting a UTF-8 sequence. */
static void utf8_truncate(char *s, size_t max_chars) {
  size_t n = 0;
  for (char *p = s; *p; p++) {
    if (((unsigned char) *p & 0xC0) != 0x80) {
      if (n == max_chars) {
        *p = '\0';
        return;
      }
      n++;
    }
  }
}

/* ---------------------------------------------------------------- sessions */

/* The signed-in user as JSON {id, name, picture} (malloc'd), or NULL. */
static char *current_user(struct mg_http_message *hm, long long *uid) {
  struct mg_str *cookie = mg_http_get_header(hm, "Cookie");
  if (cookie == NULL) return NULL;
  struct mg_str tok = mg_http_get_header_var(*cookie, mg_str(SESSION_COOKIE));
  if (tok.len == 0 || tok.len > 100) return NULL;
  char token[101];
  memcpy(token, tok.buf, tok.len);
  token[tok.len] = '\0';
  char *hash = duel_sha256_hex(token);
  if (hash == NULL) return NULL;
  char key[80];
  snprintf(key, sizeof(key), "sess:%s", hash);
  char *user = mc_get(key);
  if (user == NULL) {
    user = db_text("SELECT " USER_JSON " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?", "si", hash,
                   now_ms());
    if (user != NULL) mc_set(key, user, 3600);
  }
  duel_free(hash);
  if (user != NULL && uid != NULL) *uid = mg_json_get_long(mg_str(user), "$.id", 0);
  return user;
}

static void start_session(struct mg_connection *c, const char *user_json) {
  long long uid = mg_json_get_long(mg_str(user_json), "$.id", 0);
  char *token = duel_random_token();
  char *hash = token != NULL ? duel_sha256_hex(token) : NULL;
  if (hash == NULL || db_exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", "sii", hash, uid,
                              now_ms() + (long long) SESSION_DAYS * 86400000LL) != SQLITE_DONE) {
    reply_error(c, 500, "Couldn't start a session");
  } else {
    char *headers = mg_mprintf(
        "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n"
        "Set-Cookie: " SESSION_COOKIE "=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d%s\r\n",
        token, SESSION_DAYS * 86400, s_cookie_secure ? "; Secure" : "");
    char *body = mg_mprintf("{\"user\":%s}", user_json);
    reply_json(c, 200, body, headers);
    free(body);
    free(headers);
  }
  duel_free(hash);
  duel_free(token);
}

/* Learn mode and the CMS live in learn.c (shares the helpers above). */
#include "learn.c"
/* Courses, profiles and follows (needs learn.c). */
#include "courses.c"

/* ---------------------------------------------------------------- word duels */

static char *duel_json(const char *code) {
  char key[32];
  snprintf(key, sizeof(key), "duel:%s", code);
  char *json = mc_get(key);
  if (json != NULL) return json;
  json = db_text("SELECT json_object('code', d.code, 'title', d.title, 'questions', json(d.questions_json), 'createdAt', d.created_at,"
                 " 'course', (SELECT json_object('id', id, 'title', title, 'toLang', to_lang, 'toCode', to_code) FROM courses WHERE id = d.course_id),"
                 " 'creator', " USER_JSON ") FROM duels d JOIN users u ON u.id = d.creator_id WHERE d.code = ?",
                 "s", code);
  if (json != NULL) mc_set(key, json, 6 * 3600);
  return json;
}

static char *subs_json(const char *code) {
  char key[32];
  snprintf(key, sizeof(key), "subs:%s", code);
  char *json = mc_get(key);
  if (json != NULL) return json;
  json = db_text(
      "SELECT json_group_array(json(x)) FROM (SELECT json_object('userId', s.user_id, 'name', u.name, 'picture', u.picture,"
      " 'answers', json(s.answers_json), 'points', s.points, 'correct', s.correct, 'elapsedMs', s.elapsed_ms) AS x"
      " FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.code = ?"
      " ORDER BY s.points DESC, s.elapsed_ms ASC, s.created_at ASC)",
      "s", code);
  if (json != NULL) mc_set(key, json, 600);
  return json;
}

static void reply_view(struct mg_connection *c, const char *code, const char *duel, long long uid) {
  char *subs = subs_json(code);
  char *view = duel_view(duel, subs != NULL ? subs : "[]", uid);
  if (view == NULL) reply_error(c, 500, "Something went wrong");
  else reply_json(c, 200, view, NULL);
  duel_free(view);
  free(subs);
}

static const char CODE_ALPHABET[] = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; /* no 0/O, 1/I/L */

static void new_code(char out[7]) {
  unsigned char r[6];
  random_bytes(r, sizeof(r));
  for (int i = 0; i < 6; i++) out[i] = CODE_ALPHABET[r[i] % (sizeof(CODE_ALPHABET) - 1)];
  out[6] = '\0';
}

static int valid_code(struct mg_str s) {
  if (s.len != 6) return 0;
  for (size_t i = 0; i < 6; i++)
    if (!((s.buf[i] >= 'A' && s.buf[i] <= 'Z') || (s.buf[i] >= '0' && s.buf[i] <= '9'))) return 0;
  return 1;
}

/* The JSON array at `path` in the request body as a malloc'd string, or NULL. */
static char *body_array(struct mg_http_message *hm, const char *path) {
  int len = 0;
  int off = mg_json_get(hm->body, path, &len);
  if (off < 0 || hm->body.buf[off] != '[') return NULL;
  return mg_mprintf("%.*s", len, hm->body.buf + off);
}

/* A new duel: DUEL_WORDS random words from the chosen decks of one course, as multiple-choice questions. */
static void create_duel(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  long long cid = mg_json_get_long(hm->body, "$.courseId", 0);
  if (!can_view(uid, cid)) return reply_error(c, 400, "Pick a course");
  if (!has_access(uid, cid)) return reply_error(c, 423, LOCKED_MSG);
  char *units = body_array(hm, "$.unitIds");
  if (units == NULL) return reply_error(c, 400, "Pick at least one deck");
  /* Only decks of that course count. */
#define IN_UNITS " IN (SELECT value FROM json_each(?1) WHERE value IN (SELECT id FROM units WHERE course_id = ?3))"
  long long words = db_int(-1, "SELECT COUNT(*) FROM words w JOIN lessons l ON l.id = w.lesson_id WHERE ?2 = ?2 AND l.unit_id" IN_UNITS, "sii", units, 0LL, cid);
  if (words < 0) {
    free(units);
    return reply_error(c, 400, "Pick at least one deck");
  }
  if (words < 4) {
    free(units);
    return reply_error(c, 400, "Pick decks with at least 4 words between them");
  }
  char *targets = db_text("SELECT json_group_array(json(x)) FROM (SELECT json_object('id', w.id, 'lt', w.lt, 'en', w.en, 'pos', w.pos, 'gender', w.gender,"
                          " 'unitId', l.unit_id) AS x FROM words w JOIN lessons l ON l.id = w.lesson_id WHERE l.unit_id" IN_UNITS
                          " ORDER BY random() LIMIT ?2)",
                          "sii", units, (long long) DUEL_WORDS, cid);
  char *title = db_text("SELECT CASE WHEN COUNT(*) = 1 THEN MAX(CASE WHEN level <> '' THEN level || ' · ' ELSE '' END || title)"
                        " ELSE COUNT(*) || ' decks' || COALESCE(' · ' || (SELECT group_concat(level, ', ') FROM (SELECT DISTINCT level FROM units"
                        "   WHERE id" IN_UNITS " AND level <> '' ORDER BY level)), '') END FROM units WHERE ?2 = ?2 AND id" IN_UNITS,
                        "sii", units, 0LL, cid);
#undef IN_UNITS
  char *questions = challenges_for(targets, "duel", cid);
  char code[7];
  int rc = SQLITE_CONSTRAINT;
  for (int i = 0; i < 5 && rc == SQLITE_CONSTRAINT; i++) {
    new_code(code);
    rc = db_exec("INSERT INTO duels (code, creator_id, title, questions_json, created_at, course_id) VALUES (?, ?, ?, ?, ?, ?)", "sissii", code, uid,
                 title != NULL ? title : "Word duel", questions, now_ms(), cid);
  }
  if (rc != SQLITE_DONE) reply_error(c, 500, "Couldn't create the duel");
  else mg_http_reply(c, 201, "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n", "{%m:%m}", MG_ESC("code"), MG_ESC(code));
  free(questions);
  free(title);
  free(targets);
  free(units);
}

static void submit_answer(struct mg_connection *c, struct mg_http_message *hm, const char *code, const char *duel, long long uid) {
  char *answers = body_array(hm, "$.answers");
  if (answers == NULL) return reply_error(c, 400, "Send your answers");
  int qlen = 0;
  int qoff = mg_json_get(mg_str(duel), "$.questions", &qlen);
  char *questions = qoff < 0 ? NULL : mg_mprintf("%.*s", qlen, duel + qoff);
  char *result = questions != NULL ? duel_score(questions, answers) : NULL;
  int alen = 0;
  int aoff = result != NULL ? mg_json_get(mg_str(result), "$.answers", &alen) : -1;
  if (result == NULL || aoff < 0) {
    reply_error(c, 500, "Couldn't score your answers");
  } else {
    char *clean = mg_mprintf("%.*s", alen, result + aoff);
    long long now = now_ms();
    long long opened = db_int(now, "SELECT opened_at FROM duel_views WHERE code = ? AND user_id = ?", "si", code, uid);
    long long points = mg_json_get_long(mg_str(result), "$.points", 0);
    long long correct = mg_json_get_long(mg_str(result), "$.correct", 0);
    int rc = db_exec("INSERT INTO submissions (code, user_id, answers_json, points, correct, elapsed_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", "sisiiii",
                     code, uid, clean, points, correct, now - opened, now);
    free(clean);
    if (rc == SQLITE_CONSTRAINT) {
      reply_error(c, 409, "You already played this duel");
    } else if (rc != SQLITE_DONE) {
      reply_error(c, 500, "Couldn't save your answers");
    } else {
      char key[32];
      snprintf(key, sizeof(key), "subs:%s", code);
      mc_del(key);
      reply_view(c, code, duel, uid);
    }
  }
  duel_free(result);
  free(questions);
  free(answers);
}

/* After an upsert: mark admins (ADMINS env), then start a session with the full user JSON. */
static void finish_login(struct mg_connection *c, const char *upserted, const char *admin_key) {
  long long uid = upserted != NULL ? mg_json_get_long(mg_str(upserted), "$.id", 0) : 0;
  if (uid == 0) return reply_error(c, 500, "Couldn't save your account");
  db_exec("UPDATE users SET is_admin = ? WHERE id = ?", "ii", (long long) admin_key_listed(admin_key), uid);
  onboard(uid); /* a username, and the official course for new players */
  char *user = db_text("SELECT " USER_JSON " FROM users u WHERE u.id = ?", "i", uid);
  if (user == NULL) reply_error(c, 500, "Couldn't save your account");
  else start_session(c, user);
  free(user);
}

/* ---------------------------------------------------------------- routes */

static void handle_api(struct mg_connection *c, struct mg_http_message *hm) {
  if (method_is(hm, "GET") && uri_is(hm, "/api/config")) {
    if (s_client_id[0]) return (void) mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-store\r\n", "{%m:%m,%m:%s}", MG_ESC("googleClientId"), MG_ESC(s_client_id), MG_ESC("devLogin"), s_dev_login ? "true" : "false");
    return (void) mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-store\r\n", "{\"googleClientId\":null,\"devLogin\":%s}", s_dev_login ? "true" : "false");
  }

  if (method_is(hm, "GET") && uri_is(hm, "/api/me")) {
    long long me_id = 0;
    char *user = current_user(hm, &me_id);
    if (user != NULL) {
      /* Fresh admin flag (ADMINS may have changed since the session started). */
      is_admin(me_id);
      free(user);
      user = db_text("SELECT " USER_JSON " FROM users u WHERE u.id = ?", "i", me_id);
    }
    char *body = mg_mprintf("{\"user\":%s}", user != NULL ? user : "null");
    reply_json(c, 200, body, NULL);
    free(body);
    free(user);
    return;
  }

  if (method_is(hm, "POST") && uri_is(hm, "/api/auth/google")) {
    if (!s_client_id[0]) return reply_error(c, 503, "Google sign-in is not configured on this server");
    if (!require_json(c, hm)) return;
    char *credential = mg_json_get_str(hm->body, "$.credential");
    char *claims = duel_verify_google(credential != NULL ? credential : "", s_client_id);
    free(credential);
    char *err = claims != NULL ? mg_json_get_str(mg_str(claims), "$.error") : strdup("verification failed");
    if (err != NULL) {
      char *msg = mg_mprintf("Google sign-in failed: %s", err);
      reply_error(c, 401, msg);
      free(msg);
      free(err);
      duel_free(claims);
      return;
    }
    char *sub = mg_json_get_str(mg_str(claims), "$.sub");
    char *name = mg_json_get_str(mg_str(claims), "$.name");
    char *email = mg_json_get_str(mg_str(claims), "$.email");
    char *picture = mg_json_get_str(mg_str(claims), "$.picture");
    const char *display = name != NULL ? name : email != NULL ? email : "Player";
    char *user = db_text(
        "INSERT INTO users (provider, subject, name, email, picture, created_at) VALUES ('google', ?, substr(?, 1, 60), ?, ?, ?)"
        " ON CONFLICT (provider, subject) DO UPDATE SET name = excluded.name, email = excluded.email, picture = excluded.picture"
        " RETURNING json_object('id', id, 'name', name, 'picture', picture)",
        "ssssi", sub, display, email, picture, now_ms());
    if (sub == NULL || user == NULL) reply_error(c, 500, "Couldn't save your account");
    else finish_login(c, user, email);
    free(user);
    free(sub);
    free(name);
    free(email);
    free(picture);
    duel_free(claims);
    return;
  }

  if (method_is(hm, "POST") && uri_is(hm, "/api/auth/dev")) {
    if (!s_dev_login) return reply_error(c, 404, "Not found");
    if (!require_json(c, hm)) return;
    char *name = mg_json_get_str(hm->body, "$.name");
    if (name != NULL) {
      clean_text(name);
      utf8_truncate(name, 40);
    }
    if (name == NULL || name[0] == '\0') {
      free(name);
      return reply_error(c, 400, "Enter a name");
    }
    char *user = db_text(
        "INSERT INTO users (provider, subject, name, email, picture, created_at) VALUES ('dev', lower(?1), ?1, NULL, NULL, ?2)"
        " ON CONFLICT (provider, subject) DO UPDATE SET name = excluded.name"
        " RETURNING json_object('id', id, 'name', name, 'picture', picture)",
        "si", name, now_ms());
    char *key = mg_mprintf("dev:%s", name);
    if (user == NULL) reply_error(c, 500, "Couldn't save your account");
    else finish_login(c, user, key);
    free(key);
    free(user);
    free(name);
    return;
  }

  if (method_is(hm, "POST") && uri_is(hm, "/api/auth/logout")) {
    struct mg_str *cookie = mg_http_get_header(hm, "Cookie");
    struct mg_str tok = cookie != NULL ? mg_http_get_header_var(*cookie, mg_str(SESSION_COOKIE)) : mg_str("");
    if (tok.len > 0 && tok.len <= 100) {
      char token[101];
      memcpy(token, tok.buf, tok.len);
      token[tok.len] = '\0';
      char *hash = duel_sha256_hex(token);
      if (hash != NULL) {
        db_exec("DELETE FROM sessions WHERE token_hash = ?", "s", hash);
        char key[80];
        snprintf(key, sizeof(key), "sess:%s", hash);
        mc_del(key);
      }
      duel_free(hash);
    }
    char *headers = mg_mprintf(
        "Content-Type: application/json\r\nCache-Control: no-store\r\n"
        "Set-Cookie: " SESSION_COOKIE "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0%s\r\n",
        s_cookie_secure ? "; Secure" : "");
    reply_json(c, 200, "{\"ok\":true}", headers);
    free(headers);
    return;
  }

  /* Everything below needs a signed-in player. */
  long long uid = 0;
  char *user = current_user(hm, &uid);
  if (user == NULL) return reply_error(c, 401, "Please sign in first");
  free(user);

  if (handle_learn(c, hm, uid) || handle_studio(c, hm, uid) || handle_courses(c, hm, uid)) return;

  if (method_is(hm, "GET") && uri_is(hm, "/api/duels")) {
    char *list = db_text(
        "SELECT json_object('duels', json_group_array(json(x))) FROM (SELECT json_object('code', d.code, 'title', d.title,"
        " 'createdAt', d.created_at, 'creator', u.name,"
        " 'players', (SELECT COUNT(*) FROM submissions s WHERE s.code = d.code),"
        " 'myPoints', (SELECT points FROM submissions s WHERE s.code = d.code AND s.user_id = ?1)) AS x"
        " FROM duels d JOIN users u ON u.id = d.creator_id"
        " WHERE d.creator_id = ?1 OR d.code IN (SELECT code FROM submissions WHERE user_id = ?1)"
        "    OR d.code IN (SELECT code FROM duel_views WHERE user_id = ?1)"
        " ORDER BY d.created_at DESC LIMIT 20)",
        "i", uid);
    reply_json(c, 200, list != NULL ? list : "{\"duels\":[]}", NULL);
    free(list);
    return;
  }

  if (method_is(hm, "POST") && uri_is(hm, "/api/duels")) {
    if (!require_json(c, hm)) return;
    return create_duel(c, hm, uid);
  }

  struct mg_str caps[2];
  int is_submit = mg_match(hm->uri, mg_str("/api/duels/*/submit"), caps);
  if (is_submit || mg_match(hm->uri, mg_str("/api/duels/*"), caps)) {
    if (!valid_code(caps[0])) return reply_error(c, 404, "No duel with that code");
    char code[7];
    memcpy(code, caps[0].buf, 6);
    code[6] = '\0';
    char *duel = duel_json(code);
    if (duel == NULL) return reply_error(c, 404, "No duel with that code");
    if (!is_submit && method_is(hm, "GET")) {
      db_exec("INSERT OR IGNORE INTO duel_views (code, user_id, opened_at) VALUES (?, ?, ?)", "sii", code, uid, now_ms()); /* starts your clock */
      reply_view(c, code, duel, uid);
    } else if (is_submit && method_is(hm, "POST")) {
      if (require_json(c, hm)) submit_answer(c, hm, code, duel, uid);
    } else {
      reply_error(c, 404, "Not found");
    }
    free(duel);
    return;
  }

  reply_error(c, 404, "Not found");
}

static void http_fn(struct mg_connection *c, int ev, void *ev_data) {
  if (ev != MG_EV_HTTP_MSG) return;
  struct mg_http_message *hm = (struct mg_http_message *) ev_data;
  if (mg_match(hm->uri, mg_str("/api/#"), NULL)) {
    handle_api(c, hm);
  } else {
    struct mg_http_serve_opts opts = {
        .root_dir = s_web_root,
        .extra_headers =
            "X-Content-Type-Options: nosniff\r\n"
            "Referrer-Policy: strict-origin-when-cross-origin\r\n"
            /* Google Identity Services needs this so its sign-in popup can talk back to the page. */
            "Cross-Origin-Opener-Policy: same-origin-allow-popups\r\n"
            "Cache-Control: no-cache\r\n",
    };
    mg_http_serve_dir(c, hm, &opts);
  }
}

int main(void) {
  s_listen = env_or("LISTEN", "http://0.0.0.0:8000");
  s_web_root = env_or("WEB_ROOT", "/srv/web");
  s_db_file = env_or("DB_FILE", "/data/labas.sqlite");
  s_client_id = env_or("GOOGLE_CLIENT_ID", "");
  s_dev_login = strcmp(env_or("ALLOW_DEV_LOGIN", "0"), "1") == 0;
  s_cookie_secure = strcmp(env_or("COOKIE_SECURE", "0"), "1") == 0;
  const char *mc = env_or("MEMCACHED", "memcached:11211");
  const char *colon = strrchr(mc, ':');
  if (mc[0] != '\0') {
    snprintf(s_mc_host, sizeof(s_mc_host), "%.*s", colon != NULL ? (int) (colon - mc) : (int) strlen(mc), mc);
    snprintf(s_mc_port, sizeof(s_mc_port), "%s", colon != NULL ? colon + 1 : "11211");
  }
  signal(SIGPIPE, SIG_IGN); /* a dropped memcached connection must not kill us */

  mg_log_set(MG_LL_INFO);
  if (sqlite3_open(s_db_file, &s_db) != SQLITE_OK || sqlite3_exec(s_db, SCHEMA, NULL, NULL, NULL) != SQLITE_OK) {
    MG_ERROR(("database %s: %s", s_db_file, sqlite3_errmsg(s_db)));
    return 1;
  }
  sqlite3_busy_timeout(s_db, 2000);
  db_exec("DELETE FROM sessions WHERE expires_at <= ?", "i", now_ms());
  learn_init(env_or("SEED_FILE", "/srv/seed.json"), env_or("ADMINS", ""));

  struct mg_mgr mgr;
  mg_mgr_init(&mgr);
  if (mg_http_listen(&mgr, s_listen, http_fn, NULL) == NULL) {
    MG_ERROR(("cannot listen on %s", s_listen));
    return 1;
  }
  MG_INFO(("Labas on %s (web %s, db %s, memcached %s%s%s)%s%s", s_listen, s_web_root, s_db_file, s_mc_host[0] ? s_mc_host : "off",
           s_mc_host[0] ? ":" : "", s_mc_port, s_client_id[0] ? "" : " [Google sign-in not configured]", s_dev_login ? " [dev login ON]" : ""));
  signal(SIGINT, on_signal);
  signal(SIGTERM, on_signal);
  while (!s_stop) mg_mgr_poll(&mgr, 500);
  mg_mgr_free(&mgr);
  sqlite3_close(s_db);
  pool_reset();
  return 0;
}
