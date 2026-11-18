import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "core-test-"));
const port = 9345;
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => { try { proc.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { await sleep(200); }
}

await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");

await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);
await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(1500);

// Test 1: Course page top bar title & deck rows
await js(`location.hash = '#/course/1'`);
await sleep(1500);
const courseCheck = await js(`(() => {
  const title = document.getElementById("page-title")?.textContent;
  const deckRow = document.querySelector(".deck-row");
  const deckStyle = deckRow ? window.getComputedStyle(deckRow) : null;
  const chip = document.querySelector(".deck-row .level-chip-badge");
  const chipStyle = chip ? window.getComputedStyle(chip) : null;
  return {
    title,
    deckRowPaddingTop: deckStyle?.paddingTop,
    deckRowPaddingBottom: deckStyle?.paddingBottom,
    chipWidth: chip?.offsetWidth,
    chipText: chip?.textContent
  };
})()`);
console.log("Course page check:", JSON.stringify(courseCheck, null, 2));

// Test 2: Words list columns & filter tabs
await js(`location.hash = '#/learn/words'`);
await sleep(1500);
const wordsCheck = await js(`(() => {
  const title = document.getElementById("page-title")?.textContent;
  const seg = document.querySelector(".segmented");
  const segStyle = seg ? window.getComputedStyle(seg) : null;
  const firstBtn = seg?.querySelector("button");
  const firstBtnStyle = firstBtn ? window.getComputedStyle(firstBtn) : null;
  const checkedBtn = seg?.querySelector("button[aria-checked='true']");
  const checkedStyle = checkedBtn ? window.getComputedStyle(checkedBtn) : null;
  const row = document.querySelector(".word-list li");
  const rowStyle = row ? window.getComputedStyle(row) : null;
  return {
    title,
    segBg: segStyle?.backgroundColor,
    firstBtnColor: firstBtnStyle?.color,
    firstBtnBg: firstBtnStyle?.backgroundColor,
    checkedColor: checkedStyle?.color,
    checkedBg: checkedStyle?.backgroundColor,
    rowGridCols: rowStyle?.gridTemplateColumns
  };
})()`);
console.log("Words list check:", JSON.stringify(wordsCheck, null, 2));

// Test 3: Lesson mobile 390px footer & disabled button
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await js(`location.hash = '#/learn/lesson/1'`);
await sleep(1500);
const lessonCheck = await js(`(() => {
  const foot = document.getElementById("foot");
  const footHint = document.getElementById("foot-hint");
  const action = document.getElementById("action");
  const footRect = foot?.getBoundingClientRect();
  const actionRect = action?.getBoundingClientRect();
  const hintStyle = footHint ? window.getComputedStyle(footHint) : null;
  const actionStyle = action ? window.getComputedStyle(action) : null;
  return {
    viewportW: window.innerWidth,
    footW: footRect?.width,
    footRight: footRect?.right,
    actionW: actionRect?.width,
    actionText: action?.textContent,
    actionDisabled: action?.disabled,
    hintDisplay: hintStyle?.display,
    actionBg: actionStyle?.backgroundColor,
    actionColor: actionStyle?.color,
    actionBorder: actionStyle?.borderColor
  };
})()`);
console.log("Lesson mobile check:", JSON.stringify(lessonCheck, null, 2));

const png = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_lesson_mobile_footer.png", Buffer.from(png.result.data, "base64"));
console.log("Saved tests/inspect_lesson_mobile_footer.png");

proc.kill();
