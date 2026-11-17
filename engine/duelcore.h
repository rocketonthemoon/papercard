// C API of the Labas engine (Rust: vocabulary exercises, grading, duel scoring, Google sign-in).
// Every function returning char* gives a heap string the caller must free with duel_free(),
// or NULL on failure. Strings are UTF-8. Call everything from one thread.
#ifndef DUELCORE_H
#define DUELCORE_H

#ifdef __cplusplus
extern "C" {
#endif

// Exercises for `targets_json` ([{id, lt, en, pos, gender, unitId, completed}]), with wrong options and
// decoy tiles drawn from `pool_json` (every word, same shape). `mode`: "lesson" (pick, then type/build),
// "review" (one production exercise per word) or "duel" (multiple choice, with "answerId").
// JSON array of {kind, wordId, prompt, pos, gender, completed, options?: [{id, text}], tiles?: [..], answerId?}.
char *duel_challenges(const char *targets_json, const char *pool_json, const char *mode);

// Grades a typed answer. `accepted_json`: ["main", "alternative", ...]; `others_json`: the course's other
// Lithuanian words (an answer that is one of them is never a typo). JSON:
// {verdict: "exact"|"accents"|"typo"|"wrong", correct, expected, confused}.
char *duel_grade(const char *accepted_json, const char *others_json, const char *answer, int allow_typos);

// The accepted answers for a word: JSON array of `lt` plus the ';'-separated `also`.
char *duel_accepted(const char *lt, const char *also);

// Scores a duel answer sheet (`answers_json`: option id or null per question). JSON: {points, correct, total, results}.
char *duel_score(const char *questions_json, const char *answers_json);

// What `viewer_id` sees of a duel. `duel_json`: {code, title, createdAt, creator, questions};
// `subs_json`: submissions best first [{userId, name, picture, answers, points, correct, elapsedMs}].
char *duel_view(const char *duel_json, const char *subs_json, long long viewer_id);

// Verifies a Google ID token: {"sub","name","email","picture"} or {"error": "..."}.
char *duel_verify_google(const char *token, const char *client_id);

// Plain strings (not JSON): a 43-char random session token, and hex digests.
char *duel_random_token(void);
char *duel_sha256_hex(const char *s);
char *duel_sha1_hex(const char *s);

void duel_free(char *s);

#ifdef __cplusplus
}
#endif
#endif
