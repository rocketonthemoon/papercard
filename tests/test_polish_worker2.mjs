import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9395;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-test-"));
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

// Dev login
await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(1500);

const routes = [
  { hash: "#/learn", name: "home" },
  { hash: "#/learn/course/1", name: "course_path" },
  { hash: "#/learn/words", name: "words" },
  { hash: "#/learn/review", name: "review" },
  { hash: "#/play", name: "play" },
  { hash: "#/discover", name: "discover" },
  { hash: "#/leaderboard", name: "leaderboard" },
  { hash: "#/studio", name: "studio" },
  { hash: "#/u/Tester", name: "profile" },
];

console.log("=== Testing Desktop (1280px) ===");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

for (const r of routes) {
  await js(`location.hash = '${r.hash}'`);
  await sleep(1000);
  const info = await js(`({
    footerDisplay: getComputedStyle(document.querySelector('.footer')).display,
    bodyHasShell: document.body.classList.contains('shell'),
    pageTitle: document.getElementById('page-title')?.textContent,
    brandDisplay: getComputedStyle(document.querySelector('.nav .brand')).display
  })`);
  console.log(`[Desktop] ${r.name} (${r.hash}): footer=${info.footerDisplay}, title="${info.pageTitle}"`);
}

console.log("\n=== Testing Mobile (390px) ===");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

for (const r of routes) {
  await js(`location.hash = '${r.hash}'`);
  await sleep(1000);
  const info = await js(`({
    footerDisplay: getComputedStyle(document.querySelector('.footer')).display,
    brandDisplay: getComputedStyle(document.querySelector('.nav .brand')).display,
    pageTitleDisplay: getComputedStyle(document.querySelector('.nav .page-title')).display,
    pageTitleText: document.querySelector('.nav .page-title')?.textContent,
    pageTitleColor: getComputedStyle(document.querySelector('.nav .page-title')).color,
    appPaddingBottom: getComputedStyle(document.querySelector('main#app')).paddingBottom,
  })`);
  console.log(`[Mobile] ${r.name} (${r.hash}): brandVisible=${info.brandDisplay !== 'none'}, titleVisible=${info.pageTitleDisplay !== 'none'}, title="${info.pageTitleText}", footerHidden=${info.footerDisplay === 'none'}, padBottom=${info.appPaddingBottom}`);
  
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`tests/worker2_mobile_${r.name}.png`, Buffer.from(shot.result.data, "base64"));
}

// Check landing page (signed out)
console.log("\n=== Testing Landing Page (Signed Out) ===");
await js(`fetch('/api/auth/logout', { method: 'POST' }); location.hash = '#/'; location.reload();`);
await sleep(1500);
const landingInfo = await js(`({
  bodyHasShell: document.body.classList.contains('shell'),
  footerDisplay: getComputedStyle(document.querySelector('.footer')).display,
  brandDisplay: getComputedStyle(document.querySelector('.nav .brand')).display
})`);
console.log(`[Landing] bodyHasShell=${landingInfo.bodyHasShell}, footerDisplay=${landingInfo.footerDisplay}, brandDisplay=${landingInfo.brandDisplay}`);

const landingShot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(`tests/worker2_mobile_landing.png`, Buffer.from(landingShot.result.data, "base64"));

console.log("\nAll tests completed!");
process.exit(0);
