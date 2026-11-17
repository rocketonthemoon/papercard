// End-to-end API check: lessons, grading, hearts, review, word list, the content editor and a word duel.
// Needs a fresh running server with ALLOW_DEV_LOGIN=1 and ADMINS=dev:alice.
// Usage: node tests/test_api.mjs [http://localhost:8080]
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, raw } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": raw ?? "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/api/config`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const run = Date.now() % 100000;
const alice = client();
const bob = client();
const anon = client();
const step = (name) => console.log(`ok  ${name}`);

assert.equal((await anon("/config")).status, 200);
assert.equal((await anon("/learn")).status, 401);
assert.equal((await anon("/duels")).status, 401);
step("signed-out users are turned away");

assert.equal((await alice("/auth/dev", { method: "POST", body: "name=x", raw: "application/x-www-form-urlencoded" })).status, 415);
step("non-JSON posts are rejected (CSRF guard)");

assert.equal((await alice("/auth/dev", { method: "POST", body: { name: "Alice" } })).status, 200);
assert.equal((await bob("/auth/dev", { method: "POST", body: { name: `Bob${run}` } })).status, 200);
const meA = (await alice("/me")).data.user;
assert.equal(meA.name, "Alice");
assert.equal(meA.isAdmin, true, "run the server with ADMINS=dev:alice");
step("dev login sets a session cookie; alice is an admin");

// The whole course, to know the answers.
const content = (await alice("/admin/content")).data;
const words = new Map();
for (const u of content.units) for (const l of u.lessons) for (const w of l.words) words.set(w.id, { ...w, unit: u, lesson: l });
const byLt = (lt) => [...words.values()].find((w) => w.lt === lt);
assert.equal(content.units.length, 12);
assert.ok(words.size > 150, `${words.size} words`);
assert.equal((await bob("/admin/content")).status, 403);
step(`the starter course is loaded: ${content.units.length} decks, ${words.size} words; non-admins can't open the editor`);

// ---------------------------------------------------------------- the path

const path = (await bob("/learn")).data;
assert.deepEqual([...new Set(path.units.map((u) => u.level))], ["A1", "A2", "B1"]);
const firstLesson = path.units[0].lessons[0];
assert.equal(firstLesson.done, 0);
assert.ok(firstLesson.total >= 5);
assert.equal(path.stats.hearts, 5);
assert.equal(path.stats.learned, 0);
assert.equal(path.stats.due, 0);
step("Learn path: decks by level, lessons with word counts, full hearts");

// ---------------------------------------------------------------- a lesson

const lesson = (await bob(`/learn/lessons/${firstLesson.id}`)).data;
const ch = lesson.challenges;
assert.equal(ch.length, firstLesson.total * 2, "each word: recognise, then produce");
assert.ok(ch.slice(0, firstLesson.total).every((c) => c.kind.startsWith("pick")));
assert.ok(ch.slice(firstLesson.total).every((c) => c.kind === "type_lt"));
assert.ok(ch.every((c) => c.answerId === undefined), "answers are never sent with a lesson");
for (const c of ch.filter((c) => c.kind.startsWith("pick"))) {
  assert.equal(c.options.length, 4);
  assert.ok(c.options.some((o) => o.id === c.wordId));
  assert.equal(new Set(c.options.map((o) => o.text)).size, 4);
}
step("a lesson asks you to pick each word, then type it; 4 distinct options with the answer among them");

const answer = (who, c, extra) => who(`/learn/words/${c.wordId}/answer`, { method: "POST", body: { kind: c.kind, ...extra } });
const pick = ch[0];
let r = (await answer(bob, pick, { optionId: pick.options.find((o) => o.id !== pick.wordId).id })).data;
assert.equal(r.correct, false);
assert.equal(r.stats.hearts, 4);
assert.equal(r.correctOptionId, pick.wordId);
assert.equal(r.word.lt, words.get(pick.wordId).lt);
r = (await answer(bob, pick, { optionId: pick.wordId })).data;
assert.equal(r.correct, true);
assert.equal(r.xp, 10);
assert.equal(r.learned, false, "picking isn't enough to learn a word");
step("pick: wrong costs a heart and shows the answer; right earns 10 XP");

const typeCh = ch.find((c) => c.kind === "type_lt" && c.wordId === pick.wordId);
const target = words.get(typeCh.wordId);
r = (await answer(bob, typeCh, { text: `  ${target.lt.toUpperCase()}! ` })).data;
assert.equal(r.correct, true);
assert.equal(r.verdict, "exact");
assert.equal(r.learned, true);
assert.equal(r.stats.learned, 1);
assert.equal(r.stats.due, 0, "first review is tomorrow");
step(`type: "${target.lt.toUpperCase()}!" counts as exact (case and punctuation ignored) and marks the word learned`);

const accented = byLt("tvarkaraštis");
r = (await bob(`/learn/words/${accented.id}/answer`, { method: "POST", body: { kind: "type_lt", text: "tvarkarastis" } })).data;
assert.equal(r.correct, true);
assert.equal(r.verdict, "accents");
assert.equal(r.expected, "tvarkaraštis");
r = (await bob(`/learn/words/${byLt("profesorius").id}/answer`, { method: "POST", body: { kind: "type_lt", text: "profesorus" } })).data;
assert.equal(r.verdict, "typo");
assert.equal(r.correct, true);
r = (await bob(`/learn/words/${byLt("dalytis").id}/answer`, { method: "POST", body: { kind: "type_lt", text: "dalintis" } })).data;
assert.equal(r.verdict, "exact", "alternative answers are accepted");
step("type: missing accents and small typos still count (with the right spelling); alternatives are accepted");

const hearts = r.stats.hearts;
r = (await bob(`/learn/words/${byLt("įlipti").id}/answer`, { method: "POST", body: { kind: "type_lt", text: "islipti" } })).data;
assert.equal(r.correct, false);
assert.deepEqual(r.confused, { lt: "išlipti", en: "to get off" });
assert.equal(r.stats.hearts, hearts - 1);
step("type: another course word (išlipti for įlipti) is a mistake, not a typo, and says what it means");

const phrase = byLt("Kur yra biblioteka?");
const phraseLesson = (await bob(`/learn/lessons/${phrase.lesson.id}`)).data;
const build = phraseLesson.challenges.find((c) => c.kind === "build" && c.wordId === phrase.id);
for (const t of ["Kur", "yra", "biblioteka"]) assert.ok(build.tiles.includes(t), `tile ${t}`);
assert.ok(build.tiles.length > 3, "decoy tiles");
r = (await answer(bob, build, { text: "yra Kur biblioteka" })).data;
assert.equal(r.correct, false);
r = (await answer(bob, build, { text: "Kur yra biblioteka" })).data;
assert.equal(r.correct, true);
assert.equal(r.learned, true);
step("build: phrase tiles include decoys; order matters");

assert.equal((await bob(`/learn/words/${phrase.id}/answer`, { method: "POST", body: { kind: "nope" } })).status, 400);
assert.equal((await bob(`/learn/words/999999/answer`, { method: "POST", body: { kind: "pick_en", optionId: 1 } })).status, 404);
step("unknown exercises and words are refused");

// ---------------------------------------------------------------- hearts run out; practice and review don't need them

let st = (await bob("/learn")).data.stats;
const fresh = [...words.values()].filter((w) => w.unit.level === "B1" && w.pos !== "phrase");
for (let i = 0; i < st.hearts; i++) await bob(`/learn/words/${fresh[i].id}/answer`, { method: "POST", body: { kind: "type_lt", text: "zzz" } });
const out = await bob(`/learn/words/${fresh[10].id}/answer`, { method: "POST", body: { kind: "type_lt", text: "zzz" } });
assert.equal(out.status, 403);
assert.match(out.data.error, /out of hearts/);
r = (await answer(bob, typeCh, { text: target.lt })).data;
assert.equal(r.practice, true, "a learned word is practice");
assert.equal(r.stats.hearts, 1, "practice earns a heart back");
step("out of hearts: new words are refused; practising a learned word earns a heart back");

// ---------------------------------------------------------------- review

const review = (await bob("/learn/review")).data;
assert.equal(review.challenges.length, 0, "nothing is due on the day you learn it");
r = (await bob(`/learn/words/${target.id}/answer`, { method: "POST", body: { kind: "type_lt", text: target.lt, review: true } })).data;
assert.equal(r.correct, true);
assert.equal(r.xp, 0, "no XP for reviewing a word before it's due");
assert.equal((await bob(`/learn/words/${byLt("knyga").id}/answer`, { method: "POST", body: { kind: "type_lt", text: "knyga", review: true } })).status, 400);
step("review: nothing due yet; early reviews earn nothing; unlearned words can't be reviewed");

const list = (await bob("/learn/words")).data;
const listed = list.units.flatMap((u) => u.lessons.flatMap((l) => l.words));
assert.equal(listed.length, words.size);
assert.equal(listed.filter((w) => w.learned).length, list.stats.learned);
assert.ok(listed.find((w) => w.id === target.id).dueAt > list.now);
step(`word list: ${listed.length} words, ${list.stats.learned} learned, each with its next review`);

// ---------------------------------------------------------------- leaderboard and feedback

const board = (await bob("/leaderboard?period=week")).data;
assert.ok(board.rows.some((x) => x.isYou && x.xp > 0));
assert.equal((await bob(`/learn/units/${path.units[0].id}/feedback`, { method: "POST", body: { rating: 5, category: "idea", text: "Add audio!" } })).status, 201);
assert.ok((await alice("/admin/feedback")).data.items.some((f) => f.text === "Add audio!"));
step("leaderboard shows your XP; deck feedback reaches the admins");

// ---------------------------------------------------------------- the content editor

const lessonId = content.units[0].lessons[0].id;
let res = await alice("/admin/words", { method: "POST", body: { lessonId, lt: "Knyga", en: "a book", pos: "noun", gender: "f" } });
assert.equal(res.status, 400);
assert.match(res.data.error, /already in the course/);
res = await alice("/admin/words", { method: "POST", body: { lessonId, lt: `rašiklis${run}`, en: `pen ${run}`, pos: "noun", gender: "m", also: "parkeris", note: "Test word" } });
assert.equal(res.status, 200);
const added = res.data.units[0].lessons[0].words.at(-1);
assert.equal(added.lt, `rašiklis${run}`);
assert.equal((await alice(`/admin/words/${added.id}`, { method: "PUT", body: { lt: `rašiklis${run}`, en: `pen ${run}`, pos: "verb", gender: "m" } })).data.units[0].lessons[0].words.at(-1).gender, "", "only nouns have a gender");
assert.equal((await alice("/admin/words", { method: "POST", body: { lessonId, lt: "x", en: "y", pos: "adverb" } })).status, 400);
assert.equal((await alice("/admin/move", { method: "POST", body: { kind: "word", id: added.id, dir: -1 } })).status, 200);
assert.equal((await alice(`/admin/words/${added.id}`, { method: "DELETE" })).status, 200);
assert.equal((await bob("/admin/words", { method: "POST", body: { lessonId, lt: "a", en: "b", pos: "noun" } })).status, 403);
step("editor: duplicates and bad parts of speech are refused; add, edit, move and delete a word");

// ---------------------------------------------------------------- a word duel

assert.equal((await alice("/duels", { method: "POST", body: { unitIds: [] } })).status, 400);
assert.equal((await alice("/duels", { method: "POST", body: { unitIds: "x" } })).status, 400);
const created = await alice("/duels", { method: "POST", body: { unitIds: [content.units[2].id, content.units[3].id] } });
assert.equal(created.status, 201);
const code = created.data.code;
step(`created duel ${code}`);

const view = (await alice(`/duels/${code}`)).data;
assert.equal(view.count, 10);
assert.equal(view.maxPoints, 100);
assert.match(view.title, /^2 decks · A1$/);
assert.equal(view.key, null);
assert.ok(view.questions.every((q) => q.options.length === 4 && q.answerId === undefined));
const deckIds = new Set([content.units[2].id, content.units[3].id]);
const rightAnswer = (q) =>
  q.options.find((o) => {
    const w = words.get(o.id);
    return deckIds.has(w.unit.id) && (q.kind === "pick_en" ? w.lt === q.prompt : w.en === q.prompt);
  }).id;
step("the duel has 10 four-option questions from the chosen decks, without answers");

const aliceAnswers = view.questions.map(rightAnswer);
const after = (await alice(`/duels/${code}/submit`, { method: "POST", body: { answers: aliceAnswers } })).data;
assert.equal(after.you.points, 100);
assert.equal(after.you.correct, 10);
assert.ok(after.key.every((k) => k.right));
assert.equal(after.winner, null, "no winner until a second player");
assert.equal((await alice(`/duels/${code}/submit`, { method: "POST", body: { answers: aliceAnswers } })).status, 409);
step("alice answers everything right: 100 points; she can't play twice");

const bobView = (await bob(`/duels/${code}`)).data;
assert.equal(bobView.players[0].points, undefined, "scores stay hidden until you play");
const bobAnswers = bobView.questions.map((q, i) => (i < 6 ? rightAnswer(q) : null));
const bobAfter = (await bob(`/duels/${code}/submit`, { method: "POST", body: { answers: bobAnswers } })).data;
assert.equal(bobAfter.you.points, 60);
assert.equal(bobAfter.winner, "Alice");
assert.equal(bobAfter.key[7].yours, null);
assert.equal(bobAfter.key[7].right, false);
step("bob gets 6 right and leaves 4 blank: 60 points; Alice wins; the answer key shows his blanks");

const mine = (await bob("/duels")).data.duels;
assert.ok(mine.some((d) => d.code === code && d.myPoints === 60));
step("bob's rooms list the duel with his score");

console.log("\nall API checks passed");
