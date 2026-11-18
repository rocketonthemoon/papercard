import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9402;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-landfull-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1200,900",
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
await send("Network.enable");
await send("Network.clearBrowserCookies");

await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);

// Desktop screenshots:
// 1. Hero
let shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/landing_desk_hero.png", Buffer.from(shot.result.data, "base64"));

// 2. Features Section
await js(`document.querySelector(".landing-features")?.scrollIntoView()`);
await sleep(400);
shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/landing_desk_features.png", Buffer.from(shot.result.data, "base64"));

// 3. Philosophy & CTA Section
await js(`document.querySelector(".landing-philosophy")?.scrollIntoView()`);
await sleep(400);
shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/landing_desk_philosophy.png", Buffer.from(shot.result.data, "base64"));

// Mobile screenshots (390x844):
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);

// 4. Mobile Hero
await js(`window.scrollTo(0, 0)`);
await sleep(400);
shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/landing_mob_hero.png", Buffer.from(shot.result.data, "base64"));

// 5. Mobile Features
await js(`document.querySelector(".landing-features")?.scrollIntoView()`);
await sleep(400);
shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/landing_mob_features.png", Buffer.from(shot.result.data, "base64"));

// 6. Mobile Philosophy & CTA
await js(`document.querySelector(".landing-philosophy")?.scrollIntoView()`);
await sleep(400);
shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/landing_mob_philosophy.png", Buffer.from(shot.result.data, "base64"));

// Check for any horizontal overflow on mobile
const overflow = await js(`(() => {
  const docW = document.documentElement.offsetWidth;
  const elements = [];
  for (const el of document.querySelectorAll("*")) {
    if (el.offsetWidth > docW) {
      elements.push({ tag: el.tagName, cls: el.className, w: el.offsetWidth, docW });
    }
  }
  return elements;
})()`);
console.log("Mobile overflow elements:", JSON.stringify(overflow));

console.log("All landing page snapshots captured successfully!");
process.exit(0);
