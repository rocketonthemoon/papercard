/* Labas: courses, profiles and follows. Included from main.c after learn.c.
 *
 *   GET    /api/courses?tab=popular|following|enrolled|mine&q=   course cards (and matching people, when searching)
 *   POST   /api/courses                       create a course (you own it)
 *   GET    /api/courses/<id>                  a course and its decks
 *   PUT    /api/courses/<id>                  edit its details (creator or admin; "hidden" is admin-only)
 *   DELETE /api/courses/<id>                  delete it (creator or admin)
 *   POST   /api/courses/<id>/enroll           take the course (and make it your current one); DELETE to leave
 *   GET    /api/courses/<id>/export           the course as a self-contained SQLite file (creator or admin)
 *   POST   /api/courses/import                a new course from such a file (body: the file)
 *   GET    /api/users/<username>              a profile: counts and courses
 *   POST   /api/users/<username>/follow       follow; DELETE to unfollow
 *   GET    /api/users/<username>/followers    (and /following) the lists
 *   PUT    /api/me                            your username and bio
 *   GET    /api/feed                          new and updated courses from people you follow
 *   POST   /api/redeem                        redeem an access code {code}: opens its (locked) course, once
 *   GET    /api/admin/courses                 every course, for moderation (admins)
 *   PUT    /api/admin/courses/<id>            hide or unhide a course {hidden} (admins; they can't edit others' courses)
 */

#define MAX_COURSES_PER_USER 20
#define MAX_IMPORT_BYTES (2 * 1024 * 1024)
#define EXPORT_FORMAT "labas-course-1"

/* A public profile card. Needs `p` (users); `?1` bound to the viewer. */
#define PROFILE_JSON                                                                                                                               \
  "json_object('id', p.id, 'username', p.username, 'name', p.name, 'picture', p.picture, 'bio', p.bio, 'official', " JBOOL("p.is_official") "," \
  " 'followers', (SELECT COUNT(*) FROM follows f WHERE f.following_id = p.id), 'following', (SELECT COUNT(*) FROM follows f WHERE f.follower_id = p.id)," \
  " 'youFollow', " JBOOL("EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ?1 AND f.following_id = p.id)") ", 'isYou', " JBOOL("p.id = ?1") ")"

static long long user_by_name(struct mg_str name) {
  char buf[40];
  if (name.len == 0 || name.len >= sizeof(buf)) return 0;
  memcpy(buf, name.buf, name.len);
  buf[name.len] = '\0';
  return db_int(0, "SELECT id FROM users WHERE username = ? COLLATE NOCASE", "s", buf);
}

static int valid_username(const char *s) {
  size_t n = strlen(s);
  if (n < 3 || n > 20) return 0;
  for (const char *p = s; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '_')) return 0;
  return 1;
}

/* Lowercase ASCII letters and hyphens only (a language code like "lt" or "pt-br"), or empty. */
static int valid_code_str(const char *s) {
  for (const char *p = s; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || *p == '-')) return 0;
  return strlen(s) <= 8;
}

/* ---------------------------------------------------------------- course lists */

/* ---------------------------------------------------------------- search
 * A query is split into words ("terms"); a course matches when every term is found (folded: no case, no accents,
 * any language) in its title, language, description, creator, a deck's title, or any of its words. Terms of 3 or
 * more characters use the FTS5 trigram index (search_idx, see learn.c); shorter ones scan it. Title matches rank
 * first, then language, creator, description, decks and words. People match on their username or name. */

/* The query's terms as a JSON array of strings. At most 5 terms. */
static char *search_terms(const char *q, int *count) {
  char *out = strdup("[");
  int terms = 0;
  const char *p = q;
  while (*p && terms < 5) {
    while (*p == ' ') p++;
    if (!*p) break;
    const char *start = p;
    while (*p && *p != ' ') p++;
    char term[80];
    snprintf(term, sizeof(term), "%.*s", (int) (p - start) < 79 ? (int) (p - start) : 79, start);
    char *next = mg_mprintf("%s%s%m", out, terms ? "," : "", MG_ESC(term));
    free(out);
    out = next;
    terms++;
  }
  char *done = mg_mprintf("%s]", out);
  free(out);
  *count = terms;
  return done;
}

/* terms: (i, folded term) from ?2. hits: every index entry each term is found in. cm: those hits as
 * (term, course, how, label, weight), with people turned into their courses. */
#define SEARCH_CTE                                                                                                                                   \
  "WITH terms AS MATERIALIZED (SELECT CAST(key AS INTEGER) AS i, fold(value) AS t FROM json_each(?2) WHERE fold(value) <> ''),"                   \
  " hits AS MATERIALIZED ("                                                                                                                          \
  "  SELECT terms.i AS i, search_idx.kind AS kind, search_idx.course_id AS course, search_idx.ref_id AS ref, search_idx.label AS label"           \
  "   FROM terms, search_idx WHERE length(terms.t) >= 3 AND search_idx MATCH ('\"' || replace(terms.t, '\"', '\"\"') || '\"')"                      \
  "  UNION ALL"                                                                                                                                      \
  "  SELECT terms.i, search_idx.kind, search_idx.course_id, search_idx.ref_id, search_idx.label"                                                     \
  "   FROM terms, search_idx WHERE length(terms.t) < 3 AND instr(search_idx.body, terms.t) > 0),"                                                    \
  " cm AS MATERIALIZED (SELECT h.i, COALESCE(h.course, cr.id) AS course, CASE h.kind WHEN 'user' THEN 'creator' ELSE h.kind END AS how, h.label,"   \
  "   CASE h.kind WHEN 'title' THEN 0 WHEN 'language' THEN 1 WHEN 'user' THEN 2 WHEN 'description' THEN 3 WHEN 'deck' THEN 4 ELSE 5 END AS w"         \
  "   FROM hits h LEFT JOIN courses cr ON h.kind = 'user' AND cr.creator_id = h.ref WHERE h.kind <> 'user' OR cr.id IS NOT NULL) "

static void reply_courses(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  char tab[12] = "popular", q[100] = "";
  if (mg_http_get_var(&hm->query, "tab", tab, sizeof(tab)) <= 0) snprintf(tab, sizeof(tab), "popular");
  mg_http_get_var(&hm->query, "q", q, sizeof(q));
  clean_text(q);
  int nterms = 0;
  char *terms = search_terms(q, &nterms);
  const char *where, *order;
  if (strcmp(tab, "mine") == 0) where = "c.creator_id = ?1", order = "c.updated_at DESC";
  else if (strcmp(tab, "enrolled") == 0) where = "c.id IN (SELECT course_id FROM enrollments WHERE user_id = ?1) AND (c.hidden = 0 OR c.creator_id = ?1)", order = "c.updated_at DESC";
  else if (strcmp(tab, "following") == 0) where = "c.creator_id IN (SELECT following_id FROM follows WHERE follower_id = ?1) AND c.hidden = 0", order = "c.updated_at DESC";
  else
    /* Every visible course; ones still being built (no decks yet) come after the rest. */
    where = "c.hidden = 0", order = "cu.is_official DESC, EXISTS (SELECT 1 FROM units u WHERE u.course_id = c.id) DESC, learners DESC, c.updated_at DESC";
  char sql[8000];
  snprintf(sql, sizeof(sql),
           SEARCH_CTE
           "SELECT json_group_array(json(x)) FROM (SELECT json_set(" COURSE_JSON ", '$.match', CASE WHEN c.m IS NULL THEN NULL ELSE json_remove(c.m, '$.w') END) AS x,"
           " (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS learners, c.rank"
           " FROM (SELECT c1.*, COALESCE(json_extract(c1.m, '$.w'), 6) AS rank FROM (SELECT c0.*,"
           "   (SELECT json_object('in', how, 'text', label, 'w', w) FROM cm WHERE cm.course = c0.id AND cm.i = (SELECT MIN(i) FROM terms) ORDER BY w, label LIMIT 1) AS m"
           "   FROM courses c0) c1) c JOIN users cu ON cu.id = c.creator_id"
           " WHERE %s AND NOT EXISTS (SELECT 1 FROM terms t WHERE NOT EXISTS (SELECT 1 FROM cm WHERE cm.i = t.i AND cm.course = c.id))"
           " ORDER BY c.rank, %s LIMIT 60)",
           where, order);
  char *list = db_text(sql, "is", uid, terms);
  char *people = nterms == 0 ? NULL
                             : db_text(SEARCH_CTE "SELECT json_group_array(json(x)) FROM (SELECT " PROFILE_JSON " AS x FROM users p"
                                                  " WHERE EXISTS (SELECT 1 FROM terms) AND NOT EXISTS (SELECT 1 FROM terms t WHERE NOT EXISTS"
                                                  "   (SELECT 1 FROM hits h WHERE h.i = t.i AND h.kind = 'user' AND h.ref = p.id))"
                                                  " ORDER BY p.is_official DESC, (SELECT COUNT(*) FROM follows f WHERE f.following_id = p.id) DESC, p.name LIMIT 6)",
                                       "is", uid, terms);
  char *body = mg_mprintf("{\"tab\":%m,\"q\":%m,\"courses\":%s,\"people\":%s}", MG_ESC(tab), MG_ESC(q), list != NULL ? list : "[]", people != NULL ? people : "[]");
  reply_json(c, 200, body, NULL);
  free(body);
  free(people);
  free(list);
  free(terms);
}

static void reply_course(struct mg_connection *c, long long uid, long long cid) {
  if (!can_view(uid, cid)) return reply_error(c, 404, "No such course");
  char *course = course_json(cid, uid);
  char *units = db_text("SELECT json_group_array(json(x)) FROM (SELECT json_object('id', u.id, 'title', u.title, 'description', u.description, 'level', u.level,"
                        " 'lessons', (SELECT COUNT(*) FROM lessons l WHERE l.unit_id = u.id),"
                        " 'words', (SELECT COUNT(*) FROM words w JOIN lessons l ON l.id = w.lesson_id WHERE l.unit_id = u.id),"
                        " 'learned', (SELECT COUNT(*) FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN word_progress p ON p.word_id = w.id AND p.user_id = ?1"
                        "   WHERE l.unit_id = u.id)) AS x FROM units u WHERE u.course_id = ?2 ORDER BY u.position, u.id)",
                        "ii", uid, cid);
  char *creator = db_text("SELECT " PROFILE_JSON " FROM users p WHERE p.id = (SELECT creator_id FROM courses WHERE id = ?2)", "ii", uid, cid);
  char *body = mg_mprintf("{\"course\":%s,\"units\":%s,\"creator\":%s,\"canEdit\":%s}", course, units != NULL ? units : "[]", creator != NULL ? creator : "null",
                          can_edit(uid, cid) ? "true" : "false");
  reply_json(c, 200, body, NULL);
  free(body);
  free(creator);
  free(units);
  free(course);
}

/* Reads the course fields from the body into the course (insert when cid == 0). Returns an error message or NULL. */
static const char *save_course(struct mg_http_message *hm, long long uid, long long *cid) {
  char *title = body_str(hm, "$.title", 80);
  char *desc = body_str(hm, "$.description", 300);
  char *from = body_str(hm, "$.fromLang", 30);
  char *to = body_str(hm, "$.toLang", 30);
  char *code = body_str(hm, "$.toCode", 8);
  char *letters = body_str(hm, "$.letters", 80);
  const char *err = NULL;
  if (code != NULL)
    for (char *p = code; *p; p++) *p = (char) ((*p >= 'A' && *p <= 'Z') ? *p + 32 : *p);
  if (title == NULL) err = "Give the course a title";
  else if (to == NULL) err = "Which language does it teach?";
  else if (code != NULL && !valid_code_str(code)) err = "The language code is letters only, like lt or pt-br";
  else if (*cid == 0 && db_int(0, "SELECT COUNT(*) FROM courses WHERE creator_id = ?", "i", uid) >= MAX_COURSES_PER_USER) err = "You can have at most 20 courses";
  else if (*cid == 0) {
    long long now = now_ms();
    db_exec("INSERT INTO courses (creator_id, title, description, from_lang, to_lang, to_code, letters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            "issssssii", uid, title, desc != NULL ? desc : "", from != NULL ? from : "English", to, code != NULL ? code : "", letters != NULL ? letters : "", now, now);
    *cid = sqlite3_last_insert_rowid(s_db);
    enroll(uid, *cid, 0);
  } else {
    db_exec("UPDATE courses SET title = ?, description = ?, from_lang = ?, to_lang = ?, to_code = ?, letters = ?, updated_at = ? WHERE id = ?", "ssssssii", title,
            desc != NULL ? desc : "", from != NULL ? from : "English", to, code != NULL ? code : "", letters != NULL ? letters : "", now_ms(), *cid);
  }
  bool locked = false;
  if (err == NULL && mg_json_get_bool(hm->body, "$.locked", &locked)) db_exec("UPDATE courses SET locked = ? WHERE id = ?", "ii", (long long) locked, *cid);
  free(title);
  free(desc);
  free(from);
  free(to);
  free(code);
  free(letters);
  return err;
}

/* ---------------------------------------------------------------- export and import (a course as one SQLite file) */

static const char *EXPORT_SCHEMA[] = {
    "CREATE TABLE ex.course_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE ex.units (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, level TEXT NOT NULL, position INTEGER NOT NULL)",
    "CREATE TABLE ex.lessons (id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES units(id), title TEXT NOT NULL, position INTEGER NOT NULL)",
    "CREATE TABLE ex.words (id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id), lt TEXT NOT NULL, en TEXT NOT NULL,"
    " pos TEXT NOT NULL, gender TEXT NOT NULL, also TEXT NOT NULL, note TEXT NOT NULL, position INTEGER NOT NULL)",
};

static void export_course(struct mg_connection *c, long long cid) {
  char path[96];
  snprintf(path, sizeof(path), "/tmp/labas-export-%lld-%lld.db", cid, now_ms());
  unlink(path);
  int ok = db_exec("ATTACH DATABASE ? AS ex", "s", path) == SQLITE_DONE;
  for (size_t i = 0; ok && i < sizeof(EXPORT_SCHEMA) / sizeof(EXPORT_SCHEMA[0]); i++) ok = db_exec(EXPORT_SCHEMA[i], "") == SQLITE_DONE;
  if (ok) {
    db_exec("INSERT INTO ex.course_metadata (key, value) SELECT 'format', ?2 UNION ALL SELECT 'title', title FROM courses WHERE id = ?1"
            " UNION ALL SELECT 'description', description FROM courses WHERE id = ?1 UNION ALL SELECT 'fromLang', from_lang FROM courses WHERE id = ?1"
            " UNION ALL SELECT 'toLang', to_lang FROM courses WHERE id = ?1 UNION ALL SELECT 'toCode', to_code FROM courses WHERE id = ?1"
            " UNION ALL SELECT 'letters', letters FROM courses WHERE id = ?1"
            " UNION ALL SELECT 'creator', u.username FROM courses c JOIN users u ON u.id = c.creator_id WHERE c.id = ?1",
            "is", cid, EXPORT_FORMAT);
    db_exec("INSERT INTO ex.units SELECT id, title, description, level, position FROM units WHERE course_id = ?", "i", cid);
    db_exec("INSERT INTO ex.lessons SELECT l.id, l.unit_id, l.title, l.position FROM lessons l JOIN units u ON u.id = l.unit_id WHERE u.course_id = ?", "i", cid);
    db_exec("INSERT INTO ex.words SELECT w.id, w.lesson_id, w.lt, w.en, w.pos, w.gender, w.also, w.note, w.position FROM words w"
            " JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE u.course_id = ?",
            "i", cid);
  }
  db_exec("DETACH DATABASE ex", "");
  FILE *fp = ok ? fopen(path, "rb") : NULL;
  char *buf = NULL;
  long n = 0;
  if (fp != NULL) {
    fseek(fp, 0, SEEK_END);
    n = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    buf = n > 0 ? malloc((size_t) n) : NULL;
    if (buf == NULL || fread(buf, 1, (size_t) n, fp) != (size_t) n) n = 0;
    fclose(fp);
  }
  unlink(path);
  if (n <= 0) reply_error(c, 500, "Couldn't export the course");
  else {
    mg_printf(c,
              "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.sqlite3\r\nContent-Disposition: attachment; filename=\"labas-course-%lld.db\"\r\n"
              "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: %ld\r\n\r\n",
              cid, n);
    mg_send(c, buf, (size_t) n);
    c->is_resp = 0; /* response complete: let Mongoose read the next request on this keep-alive connection (mg_http_reply does this itself) */
  }
  free(buf);
}

/* A text column of the import file, cleaned and capped (malloc'd, never NULL). */
static char *im_text(sqlite3_stmt *st, int col, size_t max_chars) {
  const unsigned char *t = sqlite3_column_type(st, col) == SQLITE_TEXT ? sqlite3_column_text(st, col) : NULL;
  char *s = strdup(t != NULL ? (const char *) t : "");
  clean_text(s);
  utf8_truncate(s, max_chars);
  return s;
}

static char *im_meta(sqlite3 *im, const char *key, size_t max_chars) {
  sqlite3_stmt *st = NULL;
  char *out = NULL;
  if (sqlite3_prepare_v2(im, "SELECT value FROM course_metadata WHERE key = ?", -1, &st, NULL) == SQLITE_OK) {
    sqlite3_bind_text(st, 1, key, -1, SQLITE_STATIC);
    if (sqlite3_step(st) == SQLITE_ROW) out = im_text(st, 0, max_chars);
  }
  sqlite3_finalize(st);
  return out != NULL ? out : strdup("");
}

/* Creates a course owned by `uid` from an uploaded export file. The file is opened read-only in a separate,
 * defensive connection and only read with plain SELECTs; every value is checked before it is copied in. */
static void import_course(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  if (hm->body.len < 512 || hm->body.len > MAX_IMPORT_BYTES || memcmp(hm->body.buf, "SQLite format 3", 16) != 0)
    return reply_error(c, 400, "That isn't a Labas course file (or it's over 2 MB)");
  if (db_int(0, "SELECT COUNT(*) FROM courses WHERE creator_id = ?", "i", uid) >= MAX_COURSES_PER_USER) return reply_error(c, 400, "You can have at most 20 courses");
  char path[96];
  snprintf(path, sizeof(path), "/tmp/labas-import-%lld-%lld.db", uid, now_ms());
  FILE *fp = fopen(path, "wb");
  int written = fp != NULL && fwrite(hm->body.buf, 1, hm->body.len, fp) == hm->body.len;
  if (fp != NULL) fclose(fp);
  sqlite3 *im = NULL;
  const char *err = NULL;
  if (!written || sqlite3_open_v2(path, &im, SQLITE_OPEN_READONLY, NULL) != SQLITE_OK) err = "Couldn't read that file";
  if (err == NULL) {
    sqlite3_db_config(im, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
    sqlite3_db_config(im, SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0, NULL);
    sqlite3_exec(im, "PRAGMA cell_size_check = ON", NULL, NULL, NULL);
    char *check = NULL;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(im, "PRAGMA quick_check", -1, &st, NULL) == SQLITE_OK && sqlite3_step(st) == SQLITE_ROW) check = im_text(st, 0, 20);
    sqlite3_finalize(st);
    if (check == NULL || strcmp(check, "ok") != 0) err = "That file is damaged";
    free(check);
  }
  char *format = err == NULL ? im_meta(im, "format", 40) : NULL;
  if (err == NULL && strcmp(format, EXPORT_FORMAT) != 0) err = "That isn't a Labas course file";
  free(format);

  long long cid = 0;
  if (err == NULL) {
    char *title = im_meta(im, "title", 80), *desc = im_meta(im, "description", 300), *from = im_meta(im, "fromLang", 30);
    char *to = im_meta(im, "toLang", 30), *code = im_meta(im, "toCode", 8), *letters = im_meta(im, "letters", 80);
    if (!valid_code_str(code)) code[0] = '\0';
    long long now = now_ms();
    sqlite3_exec(s_db, "BEGIN", NULL, NULL, NULL);
    db_exec("INSERT INTO courses (creator_id, title, description, from_lang, to_lang, to_code, letters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            "issssssii", uid, title[0] ? title : "Imported course", desc, from[0] ? from : "English", to[0] ? to : "?", code, letters, now, now);
    cid = sqlite3_last_insert_rowid(s_db);
    free(title);
    free(desc);
    free(from);
    free(to);
    free(code);
    free(letters);

    /* Old ids -> new ids, so lessons find their decks and words their lessons. */
    enum { MAX_UNITS = 200, MAX_LESSONS = 2000, MAX_WORDS = 5000 };
    static long long umap[MAX_UNITS][2], lmap[MAX_LESSONS][2];
    int nu = 0, nl = 0, nw = 0;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(im, "SELECT id, title, description, level FROM units ORDER BY position, id LIMIT 200", -1, &st, NULL) == SQLITE_OK) {
      while (sqlite3_step(st) == SQLITE_ROW && nu < MAX_UNITS) {
        char *t = im_text(st, 1, 80), *d = im_text(st, 2, 200), *lv = im_text(st, 3, 6);
        if (t[0]) {
          db_exec("INSERT INTO units (course_id, title, description, level, position) VALUES (?, ?, ?, ?, ?)", "isssi", cid, t, d, lv, (long long) nu);
          umap[nu][0] = sqlite3_column_int64(st, 0);
          umap[nu][1] = sqlite3_last_insert_rowid(s_db);
          nu++;
        }
        free(t);
        free(d);
        free(lv);
      }
    }
    sqlite3_finalize(st);
    if (sqlite3_prepare_v2(im, "SELECT id, unit_id, title FROM lessons ORDER BY unit_id, position, id LIMIT 2000", -1, &st, NULL) == SQLITE_OK) {
      while (sqlite3_step(st) == SQLITE_ROW && nl < MAX_LESSONS) {
        long long old_unit = sqlite3_column_int64(st, 1), unit = 0;
        for (int i = 0; i < nu && unit == 0; i++)
          if (umap[i][0] == old_unit) unit = umap[i][1];
        char *t = im_text(st, 2, 80);
        if (unit && t[0]) {
          db_exec("INSERT INTO lessons (unit_id, title, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE unit_id = ?1))", "is",
                  unit, t);
          lmap[nl][0] = sqlite3_column_int64(st, 0);
          lmap[nl][1] = sqlite3_last_insert_rowid(s_db);
          nl++;
        }
        free(t);
      }
    }
    sqlite3_finalize(st);
    if (sqlite3_prepare_v2(im, "SELECT lesson_id, lt, en, pos, gender, also, note FROM words ORDER BY lesson_id, position, id LIMIT 5000", -1, &st, NULL) == SQLITE_OK) {
      while (sqlite3_step(st) == SQLITE_ROW && nw < MAX_WORDS) {
        long long old_lesson = sqlite3_column_int64(st, 0), lesson = 0;
        for (int i = 0; i < nl && lesson == 0; i++)
          if (lmap[i][0] == old_lesson) lesson = lmap[i][1];
        char *lt = im_text(st, 1, 100), *en = im_text(st, 2, 100), *pos = im_text(st, 3, 10), *gender = im_text(st, 4, 4);
        char *also = im_text(st, 5, 200), *note = im_text(st, 6, 200);
        const char *p = IN(pos, POS_VALUES) ? pos : "other";
        const char *g = strcmp(p, "noun") == 0 && IN(gender, GENDER_VALUES) ? gender : "";
        if (lesson && lt[0] && en[0] &&
            db_int(0, "SELECT COUNT(*) FROM words w JOIN lessons l ON l.id = w.lesson_id JOIN units u ON u.id = l.unit_id WHERE u.course_id = ? AND lower(w.lt) = lower(?)",
                   "is", cid, lt) == 0) {
          db_exec("INSERT INTO words (lesson_id, lt, en, pos, gender, also, note, position)"
                  " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(position), -1) + 1 FROM words WHERE lesson_id = ?1))",
                  "issssss", lesson, lt, en, p, g, also, note);
          nw++;
        }
        free(lt);
        free(en);
        free(pos);
        free(gender);
        free(also);
        free(note);
      }
    }
    sqlite3_finalize(st);
    sqlite3_exec(s_db, "COMMIT", NULL, NULL, NULL);
    enroll(uid, cid, 0);
    MG_INFO(("user %lld imported course %lld: %d decks, %d lessons, %d words", uid, cid, nu, nl, nw));
  }
  if (im != NULL) sqlite3_close(im);
  unlink(path);
  if (err != NULL) return reply_error(c, 400, err);
  char *body = mg_mprintf("{\"id\":%lld}", cid);
  reply_json(c, 201, body, NULL);
  free(body);
}

/* ---------------------------------------------------------------- access codes */

/* Redeems an access code: marks it used (atomically, so it works exactly once) and enrolls you in its course.
 * Wrong codes are limited to 10 per 10 minutes per person. */
static void redeem(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  long long now = now_ms();
  if (db_int(0, "SELECT COUNT(*) FROM redeem_failures WHERE user_id = ? AND at > ?", "ii", uid, now - 10 * 60 * 1000LL) >= 10)
    return reply_error(c, 429, "Too many wrong codes. Wait a few minutes and try again.");
  char *typed = mg_json_get_str(hm->body, "$.code");
  char code[TOKEN_GROUPS * (TOKEN_GROUP_LEN + 1)] = "";
  if (typed != NULL && strlen(typed) < 80) canonical_token(typed, code);
  free(typed);
  long long cid = code[0] ? db_int(0, "SELECT course_id FROM course_tokens WHERE code = ?", "s", code) : 0;
  if (cid == 0 || !can_view(uid, cid)) {
    db_exec("INSERT INTO redeem_failures (user_id, at) VALUES (?, ?)", "ii", uid, now);
    db_exec("DELETE FROM redeem_failures WHERE at < ?", "i", now - 24 * 3600 * 1000LL);
    return reply_error(c, 400, "That code isn't valid. Check it and try again.");
  }
  if (db_int(0, "SELECT used_at IS NOT NULL FROM course_tokens WHERE code = ?", "s", code) == 1)
    return reply_error(c, 400, "That code has already been used.");
  if (has_access(uid, cid))
    return reply_error(c, 409, "You already have this course, so the code wasn't used. Keep it for someone else.");
  db_exec("UPDATE course_tokens SET used_by = ?, used_at = ? WHERE code = ? AND used_at IS NULL", "iis", uid, now, code);
  if (sqlite3_changes(s_db) != 1) return reply_error(c, 400, "That code has already been used.");
  enroll(uid, cid, 1);
  reply_course(c, uid, cid);
}

/* ---------------------------------------------------------------- routes */

/* Returns 1 if it handled the request. */
static int handle_courses(struct mg_connection *c, struct mg_http_message *hm, long long uid) {
  struct mg_str caps[3];
  int is_get = method_is(hm, "GET"), is_post = method_is(hm, "POST"), is_put = method_is(hm, "PUT"), is_del = method_is(hm, "DELETE");

  if (is_get && uri_is(hm, "/api/courses")) {
    reply_courses(c, hm, uid);
    return 1;
  }
  if (is_post && uri_is(hm, "/api/courses")) {
    if (!require_json(c, hm)) return 1;
    long long cid = 0;
    const char *err = save_course(hm, uid, &cid);
    if (err != NULL) reply_error(c, 400, err);
    else reply_course(c, uid, cid);
    return 1;
  }
  if (is_post && uri_is(hm, "/api/courses/import")) {
    /* Not JSON, so guard against cross-site uploads with a header a form can't set (it forces a CORS preflight). */
    struct mg_str *xr = mg_http_get_header(hm, "X-Requested-With");
    if (xr == NULL || mg_strcmp(*xr, mg_str("labas")) != 0) reply_error(c, 415, "Upload the file from the Studio page");
    else import_course(c, hm, uid);
    return 1;
  }
  if (mg_match(hm->uri, mg_str("/api/courses/*/enroll"), caps) && (is_post || is_del)) {
    long long cid = strtoll(caps[0].buf, NULL, 10);
    if (!can_view(uid, cid)) reply_error(c, 404, "No such course");
    else if (is_post && !has_access(uid, cid)) reply_error(c, 423, LOCKED_MSG);
    else {
      if (is_post) enroll(uid, cid, 1);
      else {
        db_exec("DELETE FROM enrollments WHERE user_id = ? AND course_id = ?", "ii", uid, cid);
        current_course(uid); /* moves you to another course if that was the current one */
      }
      reply_course(c, uid, cid);
    }
    return 1;
  }
  if (is_get && mg_match(hm->uri, mg_str("/api/courses/*/export"), caps)) {
    long long cid = strtoll(caps[0].buf, NULL, 10);
    if (!can_edit(uid, cid)) reply_error(c, 403, "Only the course's creator can export it");
    else export_course(c, cid);
    return 1;
  }
  if (mg_match(hm->uri, mg_str("/api/courses/*"), caps)) {
    long long cid = strtoll(caps[0].buf, NULL, 10);
    if (is_get) reply_course(c, uid, cid);
    else if ((is_put || is_del) && !can_edit(uid, cid)) reply_error(c, course_exists(cid) ? 403 : 404, "Only the course's creator can change it");
    else if (is_put) {
      if (!require_json(c, hm)) return 1;
      const char *err = save_course(hm, uid, &cid);
      pool_reset();
      if (err != NULL) reply_error(c, 400, err);
      else reply_course(c, uid, cid);
    } else if (is_del) {
      db_exec("DELETE FROM courses WHERE id = ?", "i", cid);
      pool_reset();
      reply_json(c, 200, "{\"ok\":true}", NULL);
    } else reply_error(c, 404, "Not found");
    return 1;
  }

  if (is_post && uri_is(hm, "/api/redeem")) {
    if (!require_json(c, hm)) return 1;
    redeem(c, hm, uid);
    return 1;
  }
  if (is_put && mg_match(hm->uri, mg_str("/api/admin/courses/*"), caps)) {
    long long cid = strtoll(caps[0].buf, NULL, 10);
    bool hidden = false;
    if (!is_admin(uid)) reply_error(c, 403, "Admins only");
    else if (!course_exists(cid)) reply_error(c, 404, "No such course");
    else if (!require_json(c, hm)) return 1;
    else if (!mg_json_get_bool(hm->body, "$.hidden", &hidden)) reply_error(c, 400, "Say whether the course is hidden");
    else {
      db_exec("UPDATE courses SET hidden = ? WHERE id = ?", "ii", (long long) hidden, cid);
      pool_reset();
      reply_course(c, uid, cid);
    }
    return 1;
  }

  if (is_put && uri_is(hm, "/api/me")) {
    if (!require_json(c, hm)) return 1;
    char *username = body_str(hm, "$.username", 20);
    char *bio = mg_json_get_str(hm->body, "$.bio");
    if (bio != NULL) {
      clean_text(bio);
      utf8_truncate(bio, 200);
    }
    if (username != NULL)
      for (char *p = username; *p; p++) *p = (char) ((*p >= 'A' && *p <= 'Z') ? *p + 32 : *p);
    const char *err = NULL;
    if (username != NULL && !valid_username(username)) err = "Usernames are 3–20 letters, digits or _";
    else if (username != NULL && !username_free(username, uid)) err = "That username is taken";
    else {
      if (username != NULL) db_exec("UPDATE users SET username = ? WHERE id = ?", "si", username, uid);
      if (bio != NULL) db_exec("UPDATE users SET bio = ? WHERE id = ?", "si", bio, uid);
    }
    free(username);
    free(bio);
    if (err != NULL) reply_error(c, 400, err);
    else {
      char *p = db_text("SELECT " PROFILE_JSON " FROM users p WHERE p.id = ?1", "i", uid);
      reply_json(c, 200, p != NULL ? p : "{}", NULL);
      free(p);
    }
    return 1;
  }

  if (is_get && uri_is(hm, "/api/feed")) {
    char *list = db_text("SELECT json_group_array(json(x)) FROM (SELECT " COURSE_JSON " AS x" COURSE_FROM
                         " WHERE c.hidden = 0 AND c.creator_id IN (SELECT following_id FROM follows WHERE follower_id = ?1)"
                         " ORDER BY c.updated_at DESC LIMIT 8)",
                         "i", uid);
    char *body = mg_mprintf("{\"courses\":%s}", list != NULL ? list : "[]");
    reply_json(c, 200, body, NULL);
    free(body);
    free(list);
    return 1;
  }

  if (mg_match(hm->uri, mg_str("/api/users/*/follow"), caps) && (is_post || is_del)) {
    long long id = user_by_name(caps[0]);
    if (id == 0) reply_error(c, 404, "No such account");
    else if (id == uid) reply_error(c, 400, "You can't follow yourself");
    else {
      if (is_post) db_exec("INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)", "iii", uid, id, now_ms());
      else db_exec("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", "ii", uid, id);
      char *p = db_text("SELECT " PROFILE_JSON " FROM users p WHERE p.id = ?2", "ii", uid, id);
      reply_json(c, 200, p != NULL ? p : "{}", NULL);
      free(p);
    }
    return 1;
  }
  if (is_get && (mg_match(hm->uri, mg_str("/api/users/*/followers"), caps) || mg_match(hm->uri, mg_str("/api/users/*/following"), caps))) {
    long long id = user_by_name(caps[0]);
    int followers = mg_match(hm->uri, mg_str("/api/users/*/followers"), NULL);
    if (id == 0) return reply_error(c, 404, "No such account"), 1;
    char *list = db_text(followers ? "SELECT json_group_array(json(x)) FROM (SELECT " PROFILE_JSON " AS x FROM follows f0 JOIN users p ON p.id = f0.follower_id"
                                     " WHERE f0.following_id = ?2 ORDER BY f0.created_at DESC LIMIT 200)"
                                   : "SELECT json_group_array(json(x)) FROM (SELECT " PROFILE_JSON " AS x FROM follows f0 JOIN users p ON p.id = f0.following_id"
                                     " WHERE f0.follower_id = ?2 ORDER BY f0.created_at DESC LIMIT 200)",
                         "ii", uid, id);
    char *body = mg_mprintf("{\"users\":%s}", list != NULL ? list : "[]");
    reply_json(c, 200, body, NULL);
    free(body);
    free(list);
    return 1;
  }
  if (is_get && mg_match(hm->uri, mg_str("/api/users/*"), caps)) {
    long long id = user_by_name(caps[0]);
    if (id == 0) return reply_error(c, 404, "No such account"), 1;
    char *profile = db_text("SELECT " PROFILE_JSON " FROM users p WHERE p.id = ?2", "ii", uid, id);
    char *courses = db_text("SELECT json_group_array(json(x)) FROM (SELECT " COURSE_JSON " AS x" COURSE_FROM
                            " WHERE c.creator_id = ?2 AND (c.hidden = 0 OR c.creator_id = ?1) ORDER BY c.updated_at DESC)",
                            "ii", uid, id);
    char *body = mg_mprintf("{\"user\":%s,\"courses\":%s}", profile, courses != NULL ? courses : "[]");
    reply_json(c, 200, body, NULL);
    free(body);
    free(courses);
    free(profile);
    return 1;
  }

  if (is_get && uri_is(hm, "/api/admin/courses")) {
    if (!is_admin(uid)) return reply_error(c, 403, "Admins only"), 1;
    char *list = db_text("SELECT json_object('courses', (SELECT json_group_array(json(x)) FROM (SELECT " COURSE_JSON " AS x" COURSE_FROM
                         " ORDER BY c.hidden DESC, c.updated_at DESC LIMIT 500)),"
                         " 'players', (SELECT COUNT(*) FROM users WHERE provider <> 'system'),"
                         " 'xpToday', (SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE at >= CAST(strftime('%s', date('now')) AS INTEGER) * 1000))",
                         "i", uid);
    reply_json(c, 200, list != NULL ? list : "{\"courses\":[]}", NULL);
    free(list);
    return 1;
  }
  return 0;
}
