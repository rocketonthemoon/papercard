// End-to-end API check: lessons, grading, hearts, review, word list, the content editor and a word duel.
// Needs a running server with ALLOW_DEV_LOGIN=1 and ADMINS=dev:alice.
// Covers the official course, user-made courses, follows, export/import and moderation too.
// Usage: node tests/test_api.mjs [http://localhost:8080]
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8080";

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, raw, headers = {}, binary = false } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": raw ?? "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? (typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (binary) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
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
const official = (await alice("/learn")).data.course;
assert.equal(official.creator.username, "labas");
assert.equal(official.creator.official, true);
const cid = official.id;
const content = (await alice(`/studio/${cid}/content`)).data;
const words = new Map();
for (const u of content.units) for (const l of u.lessons) for (const w of l.words) words.set(w.id, { ...w, unit: u, lesson: l });
const byLt = (lt) => [...words.values()].find((w) => w.lt === lt);
assert.equal(content.units.length, 12);
assert.ok(words.size > 150, `${words.size} words`);
assert.equal((await bob(`/studio/${cid}/content`)).status, 403);
step(`new players start on the official course (@labas): ${content.units.length} decks, ${words.size} words; only admins can edit it`);

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
assert.ok((await alice(`/studio/${cid}/feedback`)).data.items.some((f) => f.text === "Add audio!"));
step("leaderboard shows your XP; deck feedback reaches the admins");

// ---------------------------------------------------------------- the content editor

const lessonId = content.units[0].lessons[0].id;
let res = await alice(`/studio/${cid}/words`, { method: "POST", body: { lessonId, lt: "Knyga", en: "a book", pos: "noun", gender: "f" } });
assert.equal(res.status, 400);
assert.match(res.data.error, /already in this course/);
res = await alice(`/studio/${cid}/words`, { method: "POST", body: { lessonId, lt: `rašiklis${run}`, en: `pen ${run}`, pos: "noun", gender: "m", also: "parkeris", note: "Test word" } });
assert.equal(res.status, 200);
const added = res.data.units[0].lessons[0].words.at(-1);
assert.equal(added.lt, `rašiklis${run}`);
assert.equal((await alice(`/studio/${cid}/words/${added.id}`, { method: "PUT", body: { lt: `rašiklis${run}`, en: `pen ${run}`, pos: "verb", gender: "m" } })).data.units[0].lessons[0].words.at(-1).gender, "", "only nouns have a gender");
assert.equal((await alice(`/studio/${cid}/words`, { method: "POST", body: { lessonId, lt: "x", en: "y", pos: "adverb" } })).status, 400);
assert.equal((await alice(`/studio/${cid}/move`, { method: "POST", body: { kind: "word", id: added.id, dir: -1 } })).status, 200);
assert.equal((await alice(`/studio/${cid}/words/${added.id}`, { method: "DELETE" })).status, 200);
assert.equal((await bob(`/studio/${cid}/words`, { method: "POST", body: { lessonId, lt: "a", en: "b", pos: "noun" } })).status, 403);
step("editor: duplicates and bad parts of speech are refused; add, edit, move and delete a word");

// ---------------------------------------------------------------- a word duel

assert.equal((await alice("/duels", { method: "POST", body: { courseId: cid, unitIds: [] } })).status, 400);
assert.equal((await alice("/duels", { method: "POST", body: { courseId: cid, unitIds: "x" } })).status, 400);
const created = await alice("/duels", { method: "POST", body: { courseId: cid, unitIds: [content.units[2].id, content.units[3].id] } });
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

// ---------------------------------------------------------------- accounts, follows and user-made courses

const cara = client();
assert.equal((await cara("/auth/dev", { method: "POST", body: { name: `Cara ${run}` } })).status, 200);
const bobMe = (await bob("/me")).data.user;
const caraMe = (await cara("/me")).data.user;
assert.match(bobMe.username, /^bob\d+$/);
assert.match(caraMe.username, /^cara\d+/);
step(`everyone gets a username from their name: @${bobMe.username}, @${caraMe.username}`);

const labas = (await cara("/users/labas")).data;
assert.equal(labas.user.official, true);
assert.ok(labas.courses.some((c) => c.id === cid));
const followed = (await cara("/users/labas/follow", { method: "POST", body: {} })).data;
assert.equal(followed.youFollow, true);
assert.equal(followed.followers, labas.user.followers + 1);
assert.equal((await cara(`/users/${caraMe.username}/follow`, { method: "POST", body: {} })).status, 400);
assert.ok((await cara("/users/labas/followers")).data.users.some((u) => u.username === caraMe.username));
step("the official account @labas has a profile with its course; following it works (but not following yourself)");

assert.equal((await bob("/me", { method: "PUT", body: { username: "labas" } })).status, 400);
assert.equal((await bob("/me", { method: "PUT", body: { username: "No Spaces!" } })).status, 400);
const renamed = `bob_${run}`;
assert.equal((await bob("/me", { method: "PUT", body: { username: renamed, bio: "I teach Spanish" } })).data.username, renamed);
step(`usernames: taken and invalid ones are refused; bob is now @${renamed}`);

// Bob makes a Spanish course.
let r2 = await bob("/courses", { method: "POST", body: { title: `Spanish basics ${run}`, toLang: "Spanish", toCode: "ES", letters: "ñ á é", description: "First words" } });
assert.equal(r2.status, 200);
const spanish = r2.data.course;
assert.equal(spanish.toCode, "es");
assert.equal(spanish.creator.username, renamed);
let studio = (await bob(`/studio/${spanish.id}/units`, { method: "POST", body: { title: "Café", level: "A1" } })).data;
const unitId = studio.units[0].id;
studio = (await bob(`/studio/${spanish.id}/lessons`, { method: "POST", body: { unitId, title: "Drinks" } })).data;
const sLesson = studio.units[0].lessons[0].id;
for (const [lt, en] of [["café", "coffee"], ["té", "tea"], ["agua", "water"], ["leche", "milk"], ["¿Cuánto cuesta?", "How much is it?"]])
  studio = (await bob(`/studio/${spanish.id}/words`, { method: "POST", body: { lessonId: sLesson, lt, en, pos: lt.startsWith("¿") ? "phrase" : "noun" } })).data;
assert.equal(studio.units[0].lessons[0].words.length, 5);
assert.equal((await cara(`/studio/${spanish.id}/content`)).status, 403);
assert.equal((await cara(`/studio/${spanish.id}/words`, { method: "POST", body: { lessonId: sLesson, lt: "x", en: "y", pos: "noun" } })).status, 403);
assert.equal((await bob(`/studio/${spanish.id}/words`, { method: "POST", body: { lessonId: content.units[0].lessons[0].id, lt: "x", en: "y", pos: "noun" } })).status, 400, "can't add to another course's lesson");
assert.equal((await bob(`/studio/${spanish.id}/words/${words.keys().next().value}`, { method: "DELETE" })).status, 400, "can't delete another course's word");
assert.equal((await alice(`/studio/${spanish.id}/content`)).status, 403, "admins can't edit other people's courses");
assert.equal((await alice(`/courses/${spanish.id}`, { method: "PUT", body: { title: "Hacked", toLang: "Spanish" } })).status, 403);
assert.equal((await alice(`/courses/${spanish.id}/export`, { binary: true })).status, 403);
step("bob creates a Spanish course with a deck, a lesson and 5 words; only he can edit it (not even admins), and only inside it");

// Cara follows bob, sees the course, takes it.
await cara(`/users/${renamed}/follow`, { method: "POST", body: {} });
assert.ok((await cara("/feed")).data.courses.some((c) => c.id === spanish.id));
assert.ok((await cara("/courses?tab=following")).data.courses.some((c) => c.id === spanish.id));
assert.ok((await cara("/courses?tab=popular&q=spanish")).data.courses.some((c) => c.id === spanish.id));
const enrolled = (await cara(`/courses/${spanish.id}/enroll`, { method: "POST", body: {} })).data;
assert.equal(enrolled.course.enrolled, true);
assert.equal(enrolled.course.learners, 2, "bob (its creator) and cara");
const caraPath = (await cara("/learn")).data;
assert.equal(caraPath.course.id, spanish.id, "enrolling makes it your current course");
assert.equal(caraPath.myCourses.length, 2);
const sl = (await cara(`/learn/lessons/${sLesson}`)).data;
const spanishIds = new Set(studio.units[0].lessons[0].words.map((w) => w.id));
assert.ok(sl.challenges.every((c) => (c.options ?? []).every((o) => spanishIds.has(o.id))), "wrong options only come from the same course");
const sType = sl.challenges.find((c) => c.kind === "type_lt" && c.prompt === "water");
r2 = (await cara(`/learn/words/${sType.wordId}/answer`, { method: "POST", body: { kind: "type_lt", text: "Agua" } })).data;
assert.equal(r2.correct, true);
assert.equal(r2.stats.learned, 1, "stats are per course");
step("cara follows bob, finds his course in her feed, Following tab and search, takes it, and learns from it");

const switched = (await cara("/learn/current", { method: "POST", body: { courseId: cid } })).data;
assert.equal(switched.course.id, cid);
assert.equal(switched.stats.learned, 0);
step("switching courses switches the path and the per-course stats");

const sDuel = await cara("/duels", { method: "POST", body: { courseId: spanish.id, unitIds: [unitId, content.units[0].id] } });
assert.equal(sDuel.status, 201);
const sView = (await cara(`/duels/${sDuel.data.code}`)).data;
assert.equal(sView.count, 5, "only the Spanish deck's words (the other course's deck is ignored)");
assert.equal(sView.course.toLang, "Spanish");
step("duels can use any course's decks, but only one course at a time");

// Search: accents and capitals don't matter; it looks inside decks and words; every term must match; people too.
const search = async (q, tab = "popular") => (await cara(`/courses?tab=${tab}&q=${encodeURIComponent(q)}`)).data;
let found = await search("CAFE");
const hit = found.courses.find((c) => c.id === spanish.id);
assert.ok(hit, "“CAFE” finds the course with the deck (and word) “Café”");
assert.deepEqual(hit.match, { in: "deck", text: "Café" }, "decks rank above words");
found = await search("sasiuvinis");
assert.deepEqual(found.courses.find((c) => c.id === cid)?.match, { in: "word", text: "sąsiuvinis" }, "no accents needed for Lithuanian words");
assert.equal((await search("lithuanian")).courses.find((c) => c.id === cid)?.match.in, "title");
assert.ok((await search("spanish cuanto")).courses.some((c) => c.id === spanish.id), "every term can match a different place");
assert.ok(!(await search("spanish zzzz")).courses.some((c) => c.id === spanish.id), "but every term must match");
assert.deepEqual((await search("LECHE")).courses.find((c) => c.id === spanish.id)?.match, { in: "word", text: "leche" }, "words inside the course count too");
found = await search(renamed.toUpperCase());
assert.ok(found.people.some((u) => u.username === renamed), "people are found by username");
assert.ok(found.courses.some((c) => c.id === spanish.id && c.match.in === "creator"));
assert.equal((await cara("/courses?q=" + encodeURIComponent("100% _x\\"))).status, 200);
assert.ok(!(await search("b_b")).people.some((u) => u.username === renamed), "_ is a literal character, not a wildcard");
assert.deepEqual((await search("")).people, [], "no people list without a query");
step("search ignores accents and capitals, looks in titles, languages, creators, decks and words, needs every term, and finds people");

// Any language: Cyrillic case, Romanian and Vietnamese accents, an accent typed as a separate mark.
for (const [lt, en] of [["Привет", "hello in Russian"], ["sărbătoare", "holiday in Romanian"], ["Tiếng Việt", "Vietnamese"]])
  studio = (await bob(`/studio/${spanish.id}/words`, { method: "POST", body: { lessonId: sLesson, lt, en, pos: "other" } })).data;
for (const [q, word] of [["ПРИВЕТ", "Привет"], ["привет", "Привет"], ["sarbatoare", "sărbătoare"], ["SĂRBĂTOARE", "sărbătoare"], ["tieng viet", "Tiếng Việt"], ["vie\u0302\u0323t", "Tiếng Việt"], ["пр", "Привет"]]) {
  const m = (await search(q)).courses.find((c) => c.id === spanish.id)?.match;
  assert.deepEqual(m, { in: "word", text: word }, `“${q}” finds ${word}`);
}
const rWord = studio.units[0].lessons[0].words.find((w) => w.lt === "sărbătoare");
const graded = (await cara(`/learn/words/${rWord.id}/answer`, { method: "POST", body: { kind: "type_lt", text: "sarbatoare" } })).data;
assert.equal(graded.verdict, "accents", "grading forgives missing Romanian accents too");
step("search and grading work in any language: Cyrillic case, Romanian and Vietnamese accents, decomposed accents, short terms");

// Export and import.
const exp = await bob(`/courses/${spanish.id}/export`, { binary: true });
assert.equal(exp.status, 200);
assert.equal(new TextDecoder().decode(exp.bytes.slice(0, 15)), "SQLite format 3");
assert.equal((await cara(`/courses/${spanish.id}/export`, { binary: true })).status, 403);
assert.equal((await cara("/courses/import", { method: "POST", body: exp.bytes, raw: "application/vnd.sqlite3" })).status, 415, "uploads need the X-Requested-With header");
assert.equal((await cara("/courses/import", { method: "POST", body: new TextEncoder().encode("not a database at all, not at all, ".repeat(30)), raw: "application/vnd.sqlite3", headers: { "X-Requested-With": "labas" } })).status, 400);
const imp = await cara("/courses/import", { method: "POST", body: exp.bytes, raw: "application/vnd.sqlite3", headers: { "X-Requested-With": "labas" } });
assert.equal(imp.status, 201);
const copy = (await cara(`/studio/${imp.data.id}/content`)).data;
assert.equal(copy.course.creator.username, caraMe.username);
assert.equal(copy.course.letters, "ñ á é");
assert.deepEqual(copy.units[0].lessons[0].words.map((w) => w.lt), studio.units[0].lessons[0].words.map((w) => w.lt));
step("bob exports his course as a SQLite file; cara imports it as her own copy (5 words, same letters); bad uploads are refused");

// Moderation.
assert.equal((await alice(`/admin/courses/${spanish.id}`, { method: "PUT", body: { hidden: true } })).data.course.hidden, true);
assert.ok(!(await cara("/courses?tab=popular")).data.courses.some((c) => c.id === spanish.id));
assert.equal((await cara(`/learn/lessons/${sLesson}`)).status, 404);
assert.equal((await bob(`/learn/lessons/${sLesson}`)).status, 200, "its creator still sees it");
assert.ok((await alice("/admin/courses")).data.courses.some((c) => c.id === spanish.id && c.hidden));
assert.equal((await bob("/admin/courses")).status, 403);
assert.equal((await bob(`/admin/courses/${spanish.id}`, { method: "PUT", body: { hidden: false } })).status, 403);
await bob(`/courses/${spanish.id}`, { method: "PUT", body: { title: spanish.title, toLang: "Spanish", hidden: false } }); // ignored: not a course field
assert.equal((await cara(`/learn/lessons/${sLesson}`)).status, 404, "only admins can unhide");
await alice(`/admin/courses/${spanish.id}`, { method: "PUT", body: { hidden: false } });
assert.equal((await cara(`/learn/lessons/${sLesson}`)).status, 200);
assert.equal((await alice(`/studio/${cid}/content`)).status, 200, "admins still edit the official course");
step("admins can hide a course (gone from Discover and lessons for others) but not edit it; only admins can unhide; admins edit official courses");

assert.equal((await cara(`/courses/${spanish.id}`, { method: "DELETE" })).status, 403);
assert.equal((await cara(`/courses/${imp.data.id}`, { method: "DELETE" })).status, 200);
assert.equal((await cara(`/courses/${imp.data.id}`)).status, 404);
assert.equal((await cara(`/courses/${spanish.id}/enroll`, { method: "DELETE" })).data.course.enrolled, false);
step("only creators delete their courses; leaving a course works");

// Arrange (the Studio's drag-and-drop board).
let arranged = (await bob(`/studio/${spanish.id}/units`, { method: "POST", body: { title: "Food", level: "A1" } })).data;
const food = arranged.units.find((u) => u.title === "Food");
arranged = (await bob(`/studio/${spanish.id}/lessons`, { method: "POST", body: { unitId: food.id, title: "Fruit" } })).data;
const arrange = (who, body) => who(`/studio/${spanish.id}/arrange`, { method: "POST", body });
arranged = (await arrange(bob, { kind: "lesson", id: sLesson, unitId: food.id, index: 0 })).data;
assert.deepEqual(arranged.units.find((u) => u.id === food.id).lessons.map((l) => l.title), ["Drinks", "Fruit"], "a lesson moves to another deck, at the drop position");
assert.equal(arranged.units.find((u) => u.id === unitId).lessons.length, 0);
assert.equal(arranged.units.find((u) => u.id === food.id).lessons[0].words.length, studio.units[0].lessons[0].words.length, "its words move with it");
arranged = (await arrange(bob, { kind: "lesson", id: sLesson, unitId: food.id, index: 99 })).data;
assert.deepEqual(arranged.units.find((u) => u.id === food.id).lessons.map((l) => l.title), ["Fruit", "Drinks"], "an index past the end puts it last");
arranged = (await arrange(bob, { kind: "unit", id: food.id, index: 0 })).data;
assert.deepEqual(arranged.units.map((u) => u.title), ["Food", "Café"], "decks reorder");
assert.equal((await arrange(cara, { kind: "unit", id: food.id, index: 1 })).status, 403);
assert.equal((await arrange(bob, { kind: "lesson", id: sLesson, unitId: content.units[0].id, index: 0 })).status, 400, "can't move a lesson into another course");
assert.equal((await arrange(bob, { kind: "lesson", id: content.units[0].lessons[0].id, unitId: food.id, index: 0 })).status, 400, "or take one from another course");
step("arrange: lessons move between decks and reorder, decks reorder; only within your own course");

// Locked courses and one-time access codes.
const dan = client();
assert.equal((await dan("/auth/dev", { method: "POST", body: { name: `Dan ${run}` } })).status, 200);
const lockedCourse = (await bob(`/courses/${spanish.id}`, { method: "PUT", body: { title: spanish.title, toLang: "Spanish", toCode: "es", letters: "ñ á é", locked: true } })).data.course;
assert.equal(lockedCourse.locked, true);
assert.equal(lockedCourse.hasAccess, true, "the creator always has access");
let seen = (await dan(`/courses/${spanish.id}`)).data.course;
assert.deepEqual([seen.locked, seen.hasAccess], [true, false], "a locked course is still visible");
assert.equal((await dan(`/courses/${spanish.id}/enroll`, { method: "POST", body: {} })).status, 423);
assert.equal((await dan(`/learn/lessons/${sLesson}`)).status, 423);
assert.equal((await dan(`/learn/words/${rWord.id}/answer`, { method: "POST", body: { kind: "type_lt", text: "x" } })).status, 423);
assert.equal((await dan("/learn/current", { method: "POST", body: { courseId: spanish.id } })).status, 423);
assert.equal((await dan("/duels", { method: "POST", body: { courseId: spanish.id, unitIds: [unitId] } })).status, 423);
assert.notEqual((await dan(`/learn/words?course=${spanish.id}`)).data.course?.id, spanish.id, "the word list doesn't open it either");
step("a locked course shows on Discover, but enrolling, lessons, answers, the word list and duels need a code");

assert.equal((await dan(`/studio/${spanish.id}/tokens`, { method: "POST", body: { count: 3 } })).status, 403);
assert.equal((await alice(`/studio/${spanish.id}/tokens`, { method: "POST", body: { count: 3 } })).status, 403, "not even admins");
assert.equal((await bob(`/studio/${spanish.id}/tokens`, { method: "POST", body: { count: 501 } })).status, 400);
const made = (await bob(`/studio/${spanish.id}/tokens`, { method: "POST", body: { count: 3 } })).data;
assert.equal(made.codes.length, 3);
assert.ok(made.codes.every((k) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(k)), made.codes.join(" "));
assert.equal(new Set(made.codes).size, 3);
assert.deepEqual(made.stats, { unused: 3, used: 0 });
const txtRes = await bob(`/studio/${spanish.id}/tokens.txt`, { binary: true });
assert.deepEqual(new TextDecoder().decode(txtRes.bytes).trim().split("\n").sort(), [...made.codes].sort(), "the .txt has every unused code, one per line");
step("bob (only bob) creates codes in batches of up to 500 and downloads the unused ones as a .txt file");

assert.equal((await dan("/redeem", { method: "POST", body: { code: "AAAAA-BBBBB-CCCCC" } })).status, 400);
const opened = await dan("/redeem", { method: "POST", body: { code: `  ${made.codes[0].toLowerCase().replace(/-/g, " ")} ` } });
assert.equal(opened.status, 200, "codes are forgiving about case, spaces and dashes");
assert.deepEqual([opened.data.course.id, opened.data.course.enrolled, opened.data.course.hasAccess], [spanish.id, true, true]);
assert.equal((await dan(`/learn/lessons/${sLesson}`)).status, 200);
assert.equal((await dan("/learn")).data.course.id, spanish.id, "redeeming makes it your current course");
assert.equal((await cara("/redeem", { method: "POST", body: { code: made.codes[0] } })).status, 400, "a code works only once");
const again = await dan("/redeem", { method: "POST", body: { code: made.codes[1] } });
assert.equal(again.status, 409, "someone who already has the course doesn't use up a code");
await dan(`/courses/${spanish.id}/enroll`, { method: "DELETE" });
assert.equal((await dan(`/courses/${spanish.id}/enroll`, { method: "POST", body: {} })).status, 200, "leaving and coming back doesn't need a new code");
let tokens = (await bob(`/studio/${spanish.id}/tokens`)).data;
assert.deepEqual([tokens.unused, tokens.used], [2, 1]);
assert.equal(tokens.recent[0].user.username, (await dan("/me")).data.user.username);
step("redeeming a code opens the course once, for one person; it isn't spent on someone who already has access");

tokens = (await bob(`/studio/${spanish.id}/tokens`, { method: "DELETE" })).data;
assert.deepEqual([tokens.unused, tokens.used], [0, 1], "revoking removes unused codes only");
assert.equal((await cara("/redeem", { method: "POST", body: { code: made.codes[2] } })).status, 400);
for (let k = 0; k < 10; k++) await cara("/redeem", { method: "POST", body: { code: `ZZZZZ-ZZZZZ-ZZZ${k % 10}Z`.replace(/[01]/g, "2") } });
assert.equal((await cara("/redeem", { method: "POST", body: { code: "ZZZZZ-ZZZZZ-ZZZZZ" } })).status, 429, "too many wrong codes pause redeeming");
await bob(`/courses/${spanish.id}`, { method: "PUT", body: { title: spanish.title, toLang: "Spanish", toCode: "es", letters: "ñ á é", locked: false } });
assert.equal((await cara(`/learn/lessons/${sLesson}`)).status, 200, "unlocking opens it to everyone again");
step("revoked codes stop working; wrong guesses are rate-limited; unlocking opens the course to everyone");

// A course that's still being built (no decks yet) is visible to everyone too.
const draft = (await bob("/courses", { method: "POST", body: { title: `Draft ${run}`, toLang: "French" } })).data.course;
const onDiscover = (await cara("/courses?tab=popular")).data.courses;
assert.ok(onDiscover.some((c) => c.id === draft.id && c.words === 0), "an empty course shows on Discover");
assert.ok(onDiscover.findIndex((c) => c.id === draft.id) > onDiscover.findIndex((c) => c.id === spanish.id), "after courses that have lessons");
assert.ok((await cara("/feed")).data.courses.some((c) => c.id === draft.id), "and in followers' feeds");
await bob(`/courses/${draft.id}`, { method: "DELETE" });
step("courses without lessons yet are listed for everyone, after the ones with content");

console.log("\nall API checks passed");
