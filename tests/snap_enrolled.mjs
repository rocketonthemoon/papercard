import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9392;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-learn-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=390,844",
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
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);
await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(1500);

// Enroll in Lithuanian if not enrolled and set learned words or check enrolled-card
const cardInfo = await js(`
  const card = document.querySelector(".enrolled-card");
  if (!card) {
    JSON.stringify({ error: "no card found" });
  } else {
    const foot = card.querySelector(".enrolled-foot");
    const btns = foot ? Array.from(foot.querySelectorAll(".btn")).map(b => ({
      text: b.textContent,
      w: b.offsetWidth,
      h: b.offsetHeight,
      whiteSpace: window.getComputedStyle(b).whiteSpace,
      flex: window.getComputedStyle(b).flex
    })) : [];
    JSON.stringify({
      cardW: card.offsetWidth,
      cardH: card.offsetHeight,
      footW: foot ? foot.offsetWidth : 0,
      btns
    });
  }
`);
console.log("Card info:", cardInfo);

// Enroll and simulate some learned progress
await js(`
  // Find or simulate enrolled card with learned words
  const card = document.querySelector(".enrolled-card");
  if (card) {
    const foot = card.querySelector(".enrolled-foot");
    // Make sure we have "Continue →" displayed
    const btn = foot?.querySelector(".btn-gate-pill");
    console.log("Current button text:", btn?.textContent);
  }
`);

// Scroll down to the enrolled card
await js(`document.querySelector(".enrolled-card")?.scrollIntoView()`);
await sleep(500);

// Simulate learned words like in user's screenshot
const testEval = await js(`(() => {
  const card = document.querySelector(".enrolled-card");
  if (!card) return "no card";
  const foot = card.querySelector(".enrolled-foot");
  if (!foot) return "no foot";
  const firstA = foot.querySelector("a");
  if (!firstA) return "no a";
  firstA.textContent = "Continue →";
  return { html: foot.innerHTML, text: firstA.textContent };
})()`);
console.log("testEval result:", JSON.stringify(testEval));
await sleep(300);

const btnText = await js(`document.querySelector(".enrolled-card .btn-gate-pill")?.textContent`);
console.log("Verified button text before capture:", btnText);

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_enrolled_mobile.png", Buffer.from(shot.result.data, "base64"));
console.log("Saved tests/inspect_enrolled_mobile.png");

// Also test desktop
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const shotDesktop = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_enrolled_desktop.png", Buffer.from(shotDesktop.result.data, "base64"));
console.log("Saved tests/inspect_enrolled_desktop.png");

process.exit(0);
