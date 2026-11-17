// C API of the Grammar Duel engine (Rust: Harper + Harper.px extras, scoring, Google sign-in).
// Every function returning char* gives a heap string the caller must free with duel_free(),
// or NULL on failure. Strings are UTF-8. Call everything from one thread.
#ifndef DUELCORE_H
#define DUELCORE_H

#ifdef __cplusplus
extern "C" {
#endif

// Builds Harper's dictionary and rules. Returns 0 on success.
int duel_init(void);

// Harper's issues in `text`: JSON array of {rule, kind, text, message, start16, end16, suggestions}.
char *duel_lint(const char *text);

// Lints `submission` and scores it against `original` (whose issues are `orig_lints_json`).
// JSON: {points, max, total, fixed, remaining, introduced, edits, editBudget, overEdits}.
char *duel_score(const char *original, const char *orig_lints_json, const char *submission);

// What `viewer_id` sees of a duel. `duel_json`: {code, title, source, text, lints, createdAt,
// creator}; `subs_json`: submissions best first [{userId, name, picture, text, points, elapsedMs, result}].
char *duel_view(const char *duel_json, const char *subs_json, long long viewer_id);

// Verifies a Google ID token: {"sub","name","email","picture"} or {"error": "..."}.
char *duel_verify_google(const char *token, const char *client_id);

// The random duel texts: [{"id","title","text"}].
char *duel_passages(void);

// Plain strings (not JSON): a 43-char random session token, and hex digests.
char *duel_random_token(void);
char *duel_sha256_hex(const char *s);
char *duel_sha1_hex(const char *s);

// `text` with the first suggestion of every lint in `lints_json` applied. Plain string.
char *duel_solution(const char *text, const char *lints_json);

void duel_free(char *s);

#ifdef __cplusplus
}
#endif
#endif
