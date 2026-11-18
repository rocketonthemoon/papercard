import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9398;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-land-"));
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
await send("Network.enable");
await send("Network.clearBrowserCookies");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);

const landInfo = await js(`(() => {
  const navSignin = document.getElementById("nav-signin");
  const mobNav = document.getElementById("mobile-nav");
  const compMob = mobNav ? window.getComputedStyle(mobNav) : null;
  const acc = document.getElementById("account");
  return {
    navSigninExists: !!navSignin,
    accountHTML: acc?.innerHTML,
    mobNavDisplay: compMob?.display,
    mobNavHeight: mobNav?.offsetHeight,
    mobNavHiddenAttr: mobNav?.hasAttribute("hidden"),
    bodyClasses: document.body.className
  };
})()`);
console.log("Landing page info:", JSON.stringify(landInfo));

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_landing_mobile.png", Buffer.from(shot.result.data, "base64"));
console.log("Saved tests/inspect_landing_mobile.png");

// Also test full page scrolled
await js(`window.scrollTo(0, document.body.scrollHeight)`);
await sleep(300);
const shotScrolled = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_landing_mobile_scrolled.png", Buffer.from(shotScrolled.result.data, "base64"));
console.log("Saved tests/inspect_landing_mobile_scrolled.png");

// Also test desktop footer
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await js(`window.scrollTo(0, document.body.scrollHeight)`);
await sleep(300);
const shotDesktop = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("tests/inspect_landing_desktop_footer.png", Buffer.from(shotDesktop.result.data, "base64"));
console.log("Saved tests/inspect_landing_desktop_footer.png");

process.exit(0);
