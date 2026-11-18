// Clicks through Labas in headless Chrome (DevTools protocol, no dependencies) and saves screenshots.
// Needs a server with ALLOW_DEV_LOGIN=1.  Usage: node tests/test_browser.mjs [url] [outDir] [--mobile] [--light]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flags = new Set(process.argv.filter((a) => a.startsWith("--")));
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const url = pos[0] ?? "http://localhost:8080/";
const outDir = pos[1] ?? os.tmpdir();
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "duel-chrome-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${profile}`, "--window-size=1300,1000", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {
    await sleep(200);
  }
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const waitFor = async (expr, what) => {
  for (let i = 0; i < 60; i++) {
    if (await js(expr)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const shot = async (name) => {
  const png = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = path.join(outDir, `labas-${name}${flags.has("--mobile") ? "-mobile" : ""}${flags.has("--light") ? "-light" : ""}.png`);
  fs.writeFileSync(file, Buffer.from(png.result.data, "base64"));
  console.log("screenshot:", file);
};

await send("Runtime.enable");
await send("Page.enable");
if (flags.has("--mobile")) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
if (flags.has("--light")) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

try {
  await send("Page.navigate", { url });
  await waitFor(`!!document.getElementById("signin")`, "landing page");
  await shot("1-landing");

  await js(`document.getElementById("dev-name").value = "Tester ${Date.now() % 1000}"; document.getElementById("dev-login").requestSubmit()`);
  await waitFor(`!!document.querySelector(".enrolled-card")`, "dashboard after sign-in");
  console.log("dashboard:", JSON.stringify(await js(`({ courses: document.querySelectorAll(".enrolled-card").length, chartDays: document.querySelectorAll(".activity-col").length, chips: document.getElementById("top-chips").textContent })`)));
  await shot("2-learn-path");

  // Open the enrolled course to view decks and lessons
  await js(`document.querySelector(".enrolled-card .btn")?.click()`);
  await waitFor(`!!document.querySelector(".module-card")`, "course path decks");

  // Teach the page the answers (from the word list) so the run can answer correctly.
  await js(`fetch("/api/learn/words").then((r) => r.json()).then((d) => { window.__w = d.units.flatMap((u) => u.lessons.flatMap((l) => l.words)); return true; })`);
  const answerRight = `(() => {
    const prompt = document.querySelector(".prompt-word").textContent;
    const q = document.querySelector(".q").textContent;
    const w = window.__w.find((x) => (q.startsWith("What does") ? x.lt : x.en) === prompt);
    if (document.querySelector(".option")) [...document.querySelectorAll(".option")].find((o) => o.textContent.slice(1) === (q.startsWith("What does") ? w.en : w.lt))?.click();
    const t = document.getElementById("typed");
    if (t) { t.value = w.lt.replace(/[ąčęėįšųūž]/g, (c) => "aceeisuuz"["ąčęėįšųūž".indexOf(c)]); t.oninput(); }
    if (document.getElementById("bank")) for (const word of w.lt.split(" ").map((x) => x.replace(/[?.!,]+$/, ""))) [...document.querySelectorAll("#bank .word-tile:not(.used)")].find((b) => b.textContent === word)?.click();
  })()`;
  // A lesson: answer exercises until we've seen every kind (pick, then type), with one deliberate mistake.
  await js(`document.querySelector(".lesson-row-link.current").click()`);
  await waitFor(`!!document.querySelector(".prompt-card")`, "lesson");
  await shot("3-lesson-pick");
  const seen = new Set();
  for (let i = 0; i < 40 && (await js(`!!document.getElementById("stage")`)); i++) {
    const kind = await js(`document.querySelector(".option") ? "pick" : document.getElementById("typed") ? "type" : document.getElementById("bank") ? "build" : "?"`);
    seen.add(kind);
    if (i === 1) await js(`[...document.querySelectorAll(".option")].at(-1).click()`); // one deliberate mistake
    else await js(answerRight);
    if (kind === "type" && !seen.has("typeShot")) {
      seen.add("typeShot");
      await shot("4-lesson-type");
    }
    await js(`document.getElementById("action").click()`);
    await waitFor(`!document.getElementById("foot") || /right|wrong/.test(document.getElementById("foot")?.className) || !!document.querySelector(".modal-back") || !!document.querySelector(".finish")`, "feedback");
    if (await js(`!document.getElementById("foot") || !!document.querySelector(".modal-back") || !!document.querySelector(".finish")`)) break; // out of hearts or finished
    if (i === 1) await shot("5-lesson-feedback");
    await js(`document.getElementById("action").click()`);
    await sleep(120);
  }
  console.log("lesson finished:", await js(`document.querySelector(".finish h1")?.textContent ?? "no"`));
  console.log("exercise kinds seen:", [...seen].filter((k) => !k.endsWith("Shot")).join(", "));
  if (await js(`!!document.querySelector(".modal-back")`)) await shot("5b-out-of-hearts");

  // A phrase lesson (build from tiles).
  const phraseLesson = await js(`fetch("/api/learn").then((r) => r.json()).then((d) => d.units[0].lessons.at(-1).id)`);
  await js(`location.hash = "#/learn/lesson/${phraseLesson}"`);
  await waitFor(`!!document.querySelector(".prompt-card")`, "phrase lesson");
  for (let i = 0; i < 12 && !(await js(`!!document.getElementById("bank")`)); i++) {
    await js(answerRight);
    await js(`document.getElementById("action").click()`);
    await waitFor(`!document.getElementById("foot") || /right|wrong/.test(document.getElementById("foot")?.className) || !!document.querySelector(".modal-back") || !!document.querySelector(".finish")`, "feedback");
    if (await js(`!document.getElementById("foot") || !!document.querySelector(".modal-back") || !!document.querySelector(".finish")`)) break;
    await js(`document.getElementById("action").click()`);
    await sleep(120);
  }
  if (await js(`!!document.getElementById("bank")`)) {
    await js(answerRight);
    await shot("6-lesson-build");
    await js(`document.getElementById("action").click()`);
    await waitFor(`/right|wrong/.test(document.getElementById("foot").className)`, "build feedback");
    console.log("build feedback:", await js(`document.getElementById("foot").className + " / " + document.querySelector("#feedback b").textContent`));
  }

  await js(`location.hash = "#/learn/review"`);
  await waitFor(`!!document.querySelector(".finish, .prompt-card, .fc-card, .flashcard")`, "review");
  await shot("7-review");
  await js(`location.hash = "#/learn/words"`);
  await waitFor(`!!document.querySelector(".word-list")`, "word list");
  await shot("8-words");

  await js(`location.hash = "#/play"`);
  await waitFor(`!!document.querySelector(".deck-chip")`, "play hub");
  await shot("9-play");
  await js(`document.getElementById("create").click()`);
  await waitFor(`!!document.querySelector("#qcard .option")`, "duel page");
  for (let i = 0; i < 10; i++) {
    await js(`document.querySelectorAll("#qcard .option")[${i % 4}].click()`);
    await sleep(320);
    if (i === 3) await shot("10-duel");
  }
  await js(`window.confirm = () => true; document.getElementById("submit").click()`);
  await waitFor(`!!document.querySelector(".score b")`, "results");
  const result = await js(`({ score: document.querySelector(".score b").textContent, max: document.querySelector(".score .muted").textContent, key: document.querySelectorAll(".rows .answer").length })`);
  console.log("duel results:", JSON.stringify(result));
  await shot("11-results");

  await js(`location.hash = "#/leaderboard"`);
  await waitFor(`!!document.querySelector(".board-page .podium, .board-page .muted")`, "leaderboard");
  await shot("12-leaderboard");

  // Courses and follows.
  await js(`location.hash = "#/discover"`);
  await waitFor(`!!document.querySelector(".pcard")`, "discover");
  await shot("13-discover");
  await js(`(() => { const q = document.getElementById("d-q"); q.value = "Sasiuvinis"; q.dispatchEvent(new Event("input")); })()`);
  await waitFor(`[...document.querySelectorAll(".tag-chip")].some((t) => t.textContent.includes("sąsiuvinis"))`, "search as you type");
  console.log("search “Sasiuvinis”:", await js(`[...document.querySelectorAll(".pcard")].map((c) => c.querySelector(".tag-chip").textContent + " / " + c.querySelector("h3").textContent).join(" | ")`));
  await js(`(() => { const q = document.getElementById("d-q"); q.value = "tester"; q.dispatchEvent(new Event("input")); })()`);
  await waitFor(`!document.getElementById("d-people").hidden`, "people results");
  await shot("13b-search");
  await js(`location.hash = "#/u/vokab"`);
  await waitFor(`!!document.querySelector(".profile-head")`, "profile");
  await js(`document.querySelector("[data-follow]")?.click()`);
  await waitFor(`document.querySelector("[data-follow]")?.textContent === "Following"`, "follow");
  await shot("14-profile");
  await js(`location.hash = "#/studio"`);
  await waitFor(`!!document.getElementById("new-course")`, "studio");
  await js(`document.getElementById("new-course").click(); document.getElementById("c-title").value = "Spanish for travellers"; document.getElementById("c-to").value = "Spanish"; document.getElementById("c-code").value = "es"; document.getElementById("c-letters").value = "ñ á é í ó ú"; document.getElementById("nc").requestSubmit()`);
  await waitFor(`!!document.querySelector(".cms-tree")`, "studio editor");
  await js(`window.prompt = (q) => (q.startsWith("Deck") ? "At the café" : q.startsWith("Level") ? "A1" : q.startsWith("Lesson") ? "Drinks" : ""); document.getElementById("add-unit").click()`);
  await waitFor(`!!document.querySelector("[data-add-lesson]")`, "deck added");
  await js(`document.querySelector("[data-add-lesson]").click()`);
  await waitFor(`!!document.getElementById("add-word")`, "lesson added");
  await js(`document.getElementById("add-word").click()`);
  await waitFor(`!!document.getElementById("f-lt")`, "word form");
  await js(`document.getElementById("f-lt").value = "cafe"; document.querySelector(".lt-key[data-ch='é']").click(); document.getElementById("f-en").value = "coffee"`);
  console.log("typed with a letter key:", await js(`document.getElementById("f-lt").value`));
  await shot("15-studio-word");
  await js(`document.getElementById("word-form").requestSubmit()`);
  await waitFor(`!!document.querySelector(".ch-row")`, "word saved");
  await shot("16-studio");

  // Arrange: add a deck and a lesson in place, then drag a lesson into the other deck with real mouse events.
  await js(`document.querySelector('[data-view="arrange"]').click()`);
  await waitFor(`!!document.getElementById("board")`, "arrange board");
  await js(`(() => { const f = document.getElementById("board-new-deck"); f.querySelector("input").value = "Snacks"; f.requestSubmit(); })()`);
  await waitFor(`document.querySelectorAll(".board-col[data-unit]").length === 2`, "new deck");
  await js(`(() => { const f = document.querySelectorAll("[data-add-lesson-in]")[1]; f.querySelector("input").value = "Chips"; f.requestSubmit(); })()`);
  await waitFor(`document.querySelectorAll(".board-card").length === 2`, "new lesson");
  await sleep(400); // SortableJS loads and attaches
  const rect = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }; })()`);
  const from = await rect(`.board-col:nth-child(1) .board-card`);
  const to = await rect(`.board-col:nth-child(2) .board-card`);
  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  await mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= 12; i++) {
    await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y + to.h / 2 - from.y) * i) / 12);
    await sleep(30);
  }
  await mouse("mouseReleased", to.x, to.y + to.h / 2);
  await waitFor(`document.querySelectorAll(".board-col:nth-child(2) .board-card").length === 2`, "lesson dragged into the other deck");
  console.log("after drag:", await js(`[...document.querySelectorAll(".board-col[data-unit]")].map((c) => c.querySelector(".board-col-head .rename").textContent + ": " + [...c.querySelectorAll(".board-card .rename")].map((x) => x.textContent).join(", ")).join(" | ")`));
  await shot("16b-arrange");

  // Settings: lock the course and create access codes (the batch downloads as a .txt).
  await js(`document.querySelector('[data-view="settings"]').click()`);
  await waitFor(`!!document.getElementById("c-locked") && document.getElementById("t-unused").textContent !== "…"`, "settings");
  await js(`document.getElementById("c-locked").checked = true; document.getElementById("cs").requestSubmit()`);
  await waitFor(`!!document.querySelector("#codes-card .pill") && document.querySelector("#codes-card .pill").textContent.includes("locked")`, "course locked");
  await js(`window.__downloads = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); else orig.call(this); }`);
  await js(`document.getElementById("t-count").value = 5; document.getElementById("t-form").requestSubmit()`);
  await waitFor(`document.getElementById("t-unused").textContent === "5"`, "codes created");
  console.log("codes: unused", await js(`document.getElementById("t-unused").textContent`), "| downloaded:", await js(`window.__downloads.join(", ")`));
  await shot("16c-settings-codes");
  await js(`location.hash = "#/learn"`);
  await waitFor(`!!document.querySelector(".enrolled-card")`, "dashboard with enrolled courses");
  console.log("enrolled courses:", await js(`[...document.querySelectorAll(".enrolled-card h3")].map((o) => o.textContent).join(" | ")`));
  await shot("17-dashboard-after");
} catch (e) {
  console.error("FAILED:", e.message);
  await shot("failure");
  process.exitCode = 1;
}
if (logs.length) console.log("page errors:\n" + logs.join("\n"));
ws.close();
proc.kill();
