import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9396;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-prof-"));
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

// Navigate to profile directly
await js(`
  const u = window.__app.me?.username || 'tester';
  location.hash = '#/u/' + u;
  window.__app.route();
`);
await sleep(1500);

const profileInfo = await js(`(() => {
  const head = document.querySelector(".profile-head");
  const actions = document.querySelector(".profile-actions");
  const btns = actions ? Array.from(actions.querySelectorAll(".btn")).map(b => ({
    id: b.id,
    text: b.textContent.trim(),
    w: b.offsetWidth,
    h: b.offsetHeight,
    display: window.getComputedStyle(b).display
  })) : [];
  return {
    hash: location.hash,
    headW: head?.offsetWidth,
    btns
  };
})()`);
console.log("Profile info on mobile:", JSON.stringify(profileInfo));

let shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_mobile_profile.png", Buffer.from(shot.result.data, "base64"));
console.log("Saved tests/inspect_mobile_profile.png");

// Also test desktop profile
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(500);
shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_desktop_profile.png", Buffer.from(shot.result.data, "base64"));
console.log("Saved tests/inspect_desktop_profile.png");

// Test clicking Sign out
await js(`document.getElementById("profile-logout")?.click()`);
await sleep(1500);

const postLogoutHash = await js(`location.hash`);
const isLanding = await js(`document.body.classList.contains("landing")`);
console.log("Post logout:", { postLogoutHash, isLanding });

shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_post_logout.png", Buffer.from(shot.result.data, "base64"));
console.log("Saved tests/inspect_post_logout.png");

process.exit(0);
