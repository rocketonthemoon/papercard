import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9390;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-dash-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1200,800",
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

const desktopShot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_desktop_learn.png", Buffer.from(desktopShot.result.data, "base64"));

// Mobile
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const mobileShot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_mobile_learn.png", Buffer.from(mobileShot.result.data, "base64"));
console.log("Screenshots saved!");
process.exit(0);
