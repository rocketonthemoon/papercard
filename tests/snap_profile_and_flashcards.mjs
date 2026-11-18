import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9375;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-fix3-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=390,844",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => {
  try { proc.kill(); } catch { }
});

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
const shot = async (filePath) => {
  const png = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(filePath, Buffer.from(png.result.data, "base64"));
  console.log("Saved:", filePath);
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send("Page.navigate", { url: "http://localhost:8080/#/" });
await sleep(1500);

// Dev login
const loginRes = await js(`
  fetch('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Abdul Salam' })
  }).then(r => r.json())
`);
const username = loginRes?.user?.username || 'abdulsalam2';

// 1. Profile on mobile
await js(`location.hash = '#/u/' + '${username}'; location.reload();`);
await sleep(1500);
await shot("tests/inspect_profile_mobile_fixed.png");

// 2. Play a lesson or review
// Complete lesson 1 to learn words:
await js(`
  (async () => {
    // Enroll and complete lesson 1
    await fetch('/api/learn/lesson/1/start', { method: 'POST' });
    await fetch('/api/learn/lesson/1/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mistakes: 0, durationMs: 5000 })
    });
    location.hash = '#/learn/review';
    location.reload();
  })()
`);
await sleep(2500);

await shot("tests/inspect_flashcards_mobile_fixed.png");

const fcMetrics = await js(`(() => {
  const actions = document.querySelector('.fc-actions');
  const quitBtn = document.querySelector('#fc-quit');
  const quitSvg = document.querySelector('#fc-quit svg');
  const buttons = [...document.querySelectorAll('.fc-actions .btn')].map(b => ({
    text: b.textContent.trim(),
    rect: b.getBoundingClientRect()
  }));
  return {
    quitBtn: quitBtn ? {
      box: quitBtn.getBoundingClientRect(),
      bg: getComputedStyle(quitBtn).backgroundColor,
      border: getComputedStyle(quitBtn).border
    } : null,
    quitSvg: quitSvg ? {
      box: quitSvg.getBoundingClientRect(),
      stroke: getComputedStyle(quitSvg).stroke
    } : null,
    actionsBox: actions ? actions.getBoundingClientRect() : null,
    buttons,
    scrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth
  };
})()`);
console.log('Flashcards metrics:', JSON.stringify(fcMetrics, null, 2));

proc.kill();
process.exit(0);
