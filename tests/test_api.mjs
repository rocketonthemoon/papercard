// End-to-end API check: two players duel over a random text.
// Needs a running server with ALLOW_DEV_LOGIN=1.  Usage: node tests/test_api.mjs [http://localhost:8080]
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

const alice = client();
const bob = client();
const anon = client();
const step = (name) => console.log(`ok  ${name}`);

assert.equal((await anon("/config")).status, 200);
assert.equal((await anon("/duels")).status, 401);
step("signed-out users are turned away");

assert.equal((await alice("/auth/dev", { method: "POST", body: "name=x", raw: "application/x-www-form-urlencoded" })).status, 415);
step("non-JSON posts are rejected (CSRF guard)");

assert.equal((await alice("/auth/dev", { method: "POST", body: { name: "Alice" } })).status, 200);
assert.equal((await bob("/auth/dev", { method: "POST", body: { name: "Bob" } })).status, 200);
assert.equal((await alice("/me")).data.user.name, "Alice");
step("dev login sets a session cookie");

assert.equal((await anon("/check", { method: "POST", body: { text: "We was late." } })).status, 401);
const checked = (await alice("/check", { method: "POST", body: { text: "We was late and it rained alot." } })).data;
assert.ok(checked.lints.some((l) => l.text === "was") && checked.lints.some((l) => l.text === "alot"));
assert.equal((await alice("/check", { method: "POST", body: { text: "This sentence is fine." } })).data.lints.length, 0);
step("Learn: /api/check finds mistakes (and none in a correct sentence)");

const passage = (await alice("/random")).data;
const created = await alice("/duels", { method: "POST", body: { source: "random", passageId: passage.id } });
assert.equal(created.status, 201);
const code = created.data.code;
step(`created duel ${code} (${passage.title})`);

assert.equal((await alice("/duels", { method: "POST", body: { source: "custom", text: "This sentence is perfectly fine and has no errors." } })).status, 400);
step("a custom text with no mistakes is refused");

const view = (await alice(`/duels/${code}`)).data;
assert.equal(view.you.submitted, false);
assert.equal(view.answers, null, "answers stay hidden before playing");
assert.equal(view.marks.length, view.issueCount, "every mistake is underlined");
assert.ok(view.marks.every((m) => Object.keys(m).sort().join() === "end16,start16"), "marks carry positions only");
assert.ok(view.issueCount >= 4);
step(`duel has ${view.issueCount} issues, answers hidden`);

// Alice applies Harper's own first suggestion for each issue (back to front so offsets stay valid).
const key = (await bob(`/duels/${code}`)).data; // Bob opens it too (starts his clock)
assert.equal(key.answers, null);
const lints = JSON.parse(JSON.stringify((await (async () => {
  // Peek at the answer key through a throwaway player who submits the text unchanged.
  const peek = client();
  await peek("/auth/dev", { method: "POST", body: { name: "Peeker" } });
  await peek(`/duels/${code}`);
  return (await peek(`/duels/${code}/submit`, { method: "POST", body: { text: view.text } })).data.answers;
})())));
let fixed = view.text;
for (const l of [...lints].sort((a, b) => b.start16 - a.start16)) {
  const s = l.suggestions[0];
  if (!s) continue;
  fixed = s.kind === "InsertAfter" ? fixed.slice(0, l.end16) + s.text + fixed.slice(l.end16) : fixed.slice(0, l.start16) + (s.kind === "Remove" ? "" : s.text) + fixed.slice(l.end16);
}
const a = await alice(`/duels/${code}/submit`, { method: "POST", body: { text: fixed } });
assert.equal(a.status, 200);
assert.ok(a.data.you.points > 0);
assert.ok(Array.isArray(a.data.answers));
step(`Alice scored ${a.data.you.points}/${a.data.maxPoints} (fixed ${a.data.you.result.fixed}/${a.data.you.result.total})`);

assert.equal((await alice(`/duels/${code}/submit`, { method: "POST", body: { text: fixed } })).status, 409);
step("a second submission is refused");

const b = await bob(`/duels/${code}/submit`, { method: "POST", body: { text: "Short." } });
assert.equal(b.data.you.points, 0, "deleting the text scores nothing");
step(`Bob deleted everything and scored ${b.data.you.points}`);

const final = (await alice(`/duels/${code}`)).data;
assert.equal(final.winner, "Alice");
assert.equal(final.players.length, 3);
step(`winner: ${final.winner}; board: ${final.players.map((p) => `${p.name} ${p.points}`).join(", ")}`);

const mine = (await alice("/duels")).data.duels;
assert.ok(mine.some((d) => d.code === code));
step("the duel is in Alice's list");

// ---------------------------------------------------------------- Learn (needs the starter content)
// A brand-new player, so earlier runs' progress doesn't matter.
const learner = client();
const learnerName = `Learner ${Date.now() % 1e6}`;
assert.equal((await learner("/auth/dev", { method: "POST", body: { name: learnerName } })).status, 200);
const learnPath = (await learner("/learn")).data;
assert.ok(learnPath.units.length > 0 && learnPath.units[0].lessons.length > 0, "starter content is loaded");
const startStats = learnPath.stats;
const lessonId = learnPath.units[0].lessons[0].id;
const lesson = (await learner(`/learn/lessons/${lessonId}`)).data.lesson;
const fixCh = lesson.challenges.find((c) => c.type === "fix");
const chooseCh = lesson.challenges.find((c) => c.type === "choose");
assert.ok(chooseCh.options.every((o) => !("correct" in o)), "lessons don't reveal the answers");
assert.ok(fixCh.marks.length > 0, "fix challenges come with underlines");
step(`lesson "${lesson.title}" has ${lesson.challenges.length} challenges, answers hidden`);

let r = (await learner(`/learn/challenges/${fixCh.id}/answer`, { method: "POST", body: { text: fixCh.text } })).data;
assert.equal(r.correct, false);
assert.equal(r.stats.hearts, startStats.hearts - 1, "a wrong answer costs a heart");
assert.ok(r.remaining.length > 0 && r.solution && r.solution !== fixCh.text);
r = (await learner(`/learn/challenges/${fixCh.id}/answer`, { method: "POST", body: { text: r.solution } })).data;
assert.equal(r.correct, true);
assert.equal(r.xp, 10);
assert.equal(r.stats.xp, startStats.xp + 10);
step(`fix challenge: wrong costs a heart, Harper's answer earns 10 XP (hearts ${r.stats.hearts})`);

r = (await learner(`/learn/challenges/${chooseCh.id}/answer`, { method: "POST", body: { optionId: chooseCh.options[0].id } })).data;
const rightOption = r.correctOptionId;
r = (await learner(`/learn/challenges/${chooseCh.id}/answer`, { method: "POST", body: { optionId: rightOption } })).data;
assert.equal(r.correct, true);
const heartsBefore = r.stats.hearts;
r = (await learner(`/learn/challenges/${chooseCh.id}/answer`, { method: "POST", body: { optionId: rightOption } })).data;
assert.equal(r.practice, true);
assert.equal(r.stats.hearts, Math.min(5, heartsBefore + 1), "practising a finished challenge earns a heart");
assert.ok(r.stats.streak >= 1, "earning XP starts a streak");
step(`choose challenge works; practice gives a heart back; streak ${r.stats.streak}`);

// A second new player runs out of hearts.
const drained = client();
await drained("/auth/dev", { method: "POST", body: { name: `Drained ${Date.now() % 1e6}` } });
const bobLesson = (await drained(`/learn/lessons/${lessonId}`)).data.lesson;
const bobFix = bobLesson.challenges.find((c) => c.type === "fix");
let last;
for (let i = 0; i < 6; i++) last = await drained(`/learn/challenges/${bobFix.id}/answer`, { method: "POST", body: { text: bobFix.text } });
assert.equal(last.status, 403, "no answers without hearts");
assert.equal((await drained("/learn")).data.stats.hearts, 0);
step("out of hearts: answers are refused until a heart comes back");

const board = (await learner("/leaderboard?period=week")).data;
assert.ok(board.rows.some((row) => row.isYou && row.xp >= 20), "the learner is on the weekly leaderboard");
assert.ok((await learner("/leaderboard?period=all")).data.rows.length >= 1);
step(`leaderboard: ${board.rows.map((row) => `#${row.rank} ${row.name} ${row.xp} XP`).join(", ")}`);

// ---------------------------------------------------------------- unit feedback
const fbUnit = learnPath.units[0];
assert.equal((await learner(`/learn/units/${fbUnit.id}/feedback`, { method: "POST", body: { text: "   " } })).status, 400, "an empty suggestion is refused");
assert.equal((await learner(`/learn/units/${fbUnit.id}/feedback`, { method: "POST", body: { rating: 4, category: "too-easy", text: "More examples with than/then, please." } })).status, 201);
assert.equal((await learner("/learn")).data.units[0].feedbackSent, true, "the path remembers the suggestion");
for (let i = 0; i < 4; i++) await learner(`/learn/units/${fbUnit.id}/feedback`, { method: "POST", body: { text: `More ideas ${i}` } });
assert.equal((await learner(`/learn/units/${fbUnit.id}/feedback`, { method: "POST", body: { text: "One too many" } })).status, 429, "at most 5 per unit per day");
assert.equal((await bob("/admin/feedback")).status, 403, "only admins can read suggestions");
let fb = (await alice("/admin/feedback?status=new")).data;
const sent = fb.items.find((f) => f.text === "More examples with than/then, please.");
assert.ok(sent && sent.rating === 4 && sent.category === "too-easy" && sent.unitTitle === fbUnit.title && sent.user === learnerName);
assert.ok((await alice("/admin/content")).data.units.find((u) => u.id === fbUnit.id).newFeedback >= 5, "the editor shows new suggestions per unit");
assert.equal((await alice(`/admin/feedback/${sent.id}`, { method: "PUT", body: { status: "done" } })).status, 200);
assert.ok(!(await alice("/admin/feedback?status=new")).data.items.some((f) => f.id === sent.id), "done suggestions leave the New list");
assert.ok((await alice("/admin/feedback?status=done")).data.items.some((f) => f.id === sent.id));
assert.equal((await alice(`/admin/feedback/${sent.id}`, { method: "DELETE" })).status, 200);
assert.ok(!(await alice("/admin/feedback?status=all")).data.items.some((f) => f.id === sent.id), "deleting works");
step(`unit feedback: players suggest changes (rating, category, text, spam limit); admins review, mark done and delete`);

// ---------------------------------------------------------------- CMS
assert.equal((await bob("/admin/content")).status, 403, "only admins can open the CMS");
const adminUser = (await alice("/me")).data.user;
assert.equal(adminUser.isAdmin, true, "ADMINS=dev:alice makes alice an admin");
let content = (await alice("/admin/units", { method: "POST", body: { title: "Test unit", description: "Made by the API test" } })).data;
const unit = content.units.find((u) => u.title === "Test unit");
content = (await alice("/admin/lessons", { method: "POST", body: { unitId: unit.id, title: "Test lesson" } })).data;
const tLesson = content.units.find((u) => u.id === unit.id).lessons[0];
assert.equal((await alice("/admin/challenges", { method: "POST", body: { lessonId: tLesson.id, type: "fix", question: "Fix it.", text: "This sentence is fine." } })).status, 400, "a fix text without mistakes is refused");
assert.equal((await alice("/admin/challenges", { method: "POST", body: { lessonId: tLesson.id, type: "choose", question: "Pick", options: [{ text: "a", correct: true }, { text: "b", correct: true }] } })).status, 400, "exactly one correct option");
content = (await alice("/admin/challenges", { method: "POST", body: { lessonId: tLesson.id, type: "fix", question: "Fix it.", text: "We was late." } })).data;
content = (await alice("/admin/challenges", { method: "POST", body: { lessonId: tLesson.id, type: "choose", question: "We ___ late.", options: [{ text: "was", correct: false }, { text: "were", correct: true }] } })).data;
let chs = content.units.find((u) => u.id === unit.id).lessons[0].challenges;
assert.deepEqual(chs.map((c) => c.type), ["fix", "choose"]);
assert.equal(chs[0].lints.length, 1, "Harper's issues are stored with the challenge");
content = (await alice("/admin/move", { method: "POST", body: { kind: "challenge", id: chs[1].id, dir: -1 } })).data;
chs = content.units.find((u) => u.id === unit.id).lessons[0].challenges;
assert.deepEqual(chs.map((c) => c.type), ["choose", "fix"], "reordering works");
content = (await alice(`/admin/challenges/${chs[0].id}`, { method: "PUT", body: { type: "choose", question: "We ___ late yesterday.", options: [{ text: "were", correct: true }, { text: "was", correct: false }, { text: "be", correct: false }] } })).data;
assert.equal(content.units.find((u) => u.id === unit.id).lessons[0].challenges[0].options.length, 3, "editing works");
content = (await alice(`/admin/units/${unit.id}`, { method: "DELETE" })).data;
assert.ok(!content.units.some((u) => u.id === unit.id), "deleting a unit removes it");
step("CMS: admins only; units, lessons and challenges can be created, validated, reordered, edited and deleted");

assert.equal((await alice("/auth/logout", { method: "POST", body: {} })).status, 200);
assert.equal((await alice("/me")).data.user, null);
step("logout ends the session");
console.log("All API checks passed.");
