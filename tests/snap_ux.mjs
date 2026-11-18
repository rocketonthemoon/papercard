import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ux-chrome-"));
const proc = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-port=9338",
  `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch("http://127.0.0.1:9338/json")).json()).find((t) => t.type === "page");
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

// 1. Learn page
await send("Page.navigate", { url: "http://localhost:8080/#/learn" });
await waitFor(`!!document.querySelector(".enrolled-card")`, "enrolled cards");
await sleep(600);
await shot("tests/ux_learn.png");

// 2. Course 1
await send("Page.navigate", { url: "http://localhost:8080/#/course/1" });
await waitFor(`!!document.querySelector(".course-hero")`, "course hero");
await sleep(600);
await shot("tests/ux_course_1.png");

// 3. Learn Course 1
await send("Page.navigate", { url: "http://localhost:8080/#/learn/course/1" });
await waitFor(`!!document.querySelector(".module-card")`, "course path decks");
await sleep(600);
await shot("tests/ux_learn_course_1.png");

// Scroll down to see the lesson rows in full
await js(`window.scrollTo(0, 450)`);
await sleep(300);
await shot("tests/ux_learn_course_1_lessons.png");

// 4. Lesson 1 prompt
await send("Page.navigate", { url: "http://localhost:8080/#/learn/lesson/1" });
await waitFor(`!!document.querySelector(".option")`, "lesson options");
await sleep(600);
await shot("tests/ux_lesson_prompt.png");

// 5. Select an option
await js(`document.querySelectorAll(".option")[0].click()`);
await sleep(300);
await shot("tests/ux_lesson_selected.png");

// 6. Click check for feedback
await js(`document.getElementById("action").click()`);
await waitFor(`/right|wrong/.test(document.getElementById("foot").className)`, "feedback footer");
await sleep(400);
await shot("tests/ux_lesson_feedback.png");

proc.kill();
process.exit(0);
