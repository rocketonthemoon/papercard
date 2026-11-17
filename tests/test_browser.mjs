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
  await waitFor(`!!document.querySelector(".unit-banner")`, "learn path after sign-in");
  console.log("path:", JSON.stringify(await js(`({ levels: [...document.querySelectorAll(".level-head h2")].map((h) => h.textContent), decks: document.querySelectorAll(".unit-banner").length, review: document.querySelector(".review-card")?.innerText.length })`)));
  await shot("2-learn-path");

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
  await js(`document.querySelector(".node.current").click()`);
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
    await waitFor(`/right|wrong/.test(document.getElementById("foot").className) || !!document.querySelector(".modal-back")`, "feedback");
    if (await js(`!!document.querySelector(".modal-back")`)) break; // out of hearts
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
    await waitFor(`/right|wrong/.test(document.getElementById("foot").className) || !!document.querySelector(".modal-back")`, "feedback");
    if (await js(`!!document.querySelector(".modal-back")`)) break;
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
  await waitFor(`!!document.querySelector(".finish, .prompt-card")`, "review");
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
  await waitFor(`!!document.querySelector(".board")`, "leaderboard");
  await shot("12-leaderboard");
} catch (e) {
  console.error("FAILED:", e.message);
  await shot("failure");
  process.exitCode = 1;
}
if (logs.length) console.log("page errors:\n" + logs.join("\n"));
ws.close();
proc.kill();
