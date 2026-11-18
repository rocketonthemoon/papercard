import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "player-chrome-"));
const proc = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-port=9335",
  `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch("http://127.0.0.1:9335/json")).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {
    await sleep(200);
  }
}

if (!ws) {
  console.error("Failed to connect to Chrome CDP");
  process.exit(1);
}

await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});

const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const js = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

const waitFor = async (expr, what) => {
  for (let i = 0; i < 60; i++) {
    if (await js(expr)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const shot = async (filePath) => {
  const png = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(filePath, Buffer.from(png.result.data, "base64"));
  console.log("Saved screenshot:", filePath);
};

await send("Runtime.enable");
await send("Page.enable");

try {
  // Navigate to lesson 1
  await send("Page.navigate", { url: "http://localhost:8080/#/learn/lesson/1" });
  await waitFor(`!!document.querySelector(".option")`, "lesson options");

  // Click the university option to answer correctly (or 1st option)
  await js(`(Array.from(document.querySelectorAll(".option")).find(o => /university/i.test(o.textContent)) || document.querySelectorAll(".option")[0]).click()`);
  await sleep(200);
  await shot("tests/screenshot_player_selected.png");

  // Click check to see feedback
  await js(`document.getElementById("action").click()`);
  await waitFor(`/right|wrong/.test(document.getElementById("foot").className) || !!document.querySelector(".modal-box, .modal")`, "feedback or modal");
  await sleep(300);
  await shot("tests/screenshot_player_feedback.png");

  // Now navigate to flashcards review
  await send("Page.navigate", { url: "http://localhost:8080/#/learn/review" });
  await waitFor(`!!document.querySelector(".flashcard, .finish, .picker")`, "flashcards or finish");
  await sleep(300);
  await shot("tests/screenshot_player_flashcards.png");

  // Now navigate to play / duels
  await send("Page.navigate", { url: "http://localhost:8080/#/play" });
  await waitFor(`!!document.getElementById("create")`, "play hub");
  await sleep(600);
  await js(`document.getElementById("create").click()`);
  await waitFor(`!!document.querySelector(".duel-arena, #qcard, .option")`, "duel arena");
  await sleep(500);
  await shot("tests/screenshot_player_duel.png");

} catch (err) {
  console.error("Error during test run:", err);
} finally {
  try { proc.kill(); } catch {}
  process.exit(0);
}
