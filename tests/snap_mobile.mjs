import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9377;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-mob-"));
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
await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});

// Go to site and authenticate
await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);
await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.hash = '#/learn'`);
await js(`location.reload()`);
await sleep(1500);

const accInfo = await js(`
  const el = document.getElementById("account");
  const comp = el ? window.getComputedStyle(el) : null;
  const who = document.querySelector(".who-pill");
  const whoComp = who ? window.getComputedStyle(who) : null;
  const navInner = document.querySelector(".nav-inner");
  JSON.stringify({
    accountHTML: el ? el.outerHTML : "null",
    accountDisplay: comp ? comp.display : "null",
    accountWidth: comp ? comp.width : "null",
    offsetWidth: el ? el.offsetWidth : "null",
    whoDisplay: whoComp ? whoComp.display : "null",
    whoWidth: whoComp ? whoComp.width : "null",
    navInnerChildren: Array.from(navInner ? navInner.children : []).map(c => ({
      tag: c.tagName,
      cls: c.className,
      id: c.id,
      display: window.getComputedStyle(c).display,
      width: c.offsetWidth,
      pos: window.getComputedStyle(c).position
    }))
  })
`);
console.log("Account info:", accInfo);

await shot("tests/inspect_mobile_topbar.png");

console.log("account outerHTML:", await js(`document.getElementById("account")?.outerHTML`));
console.log("account display:", await js(`getComputedStyle(document.getElementById("account")).display`));
console.log("who-pill display:", await js(`document.querySelector(".who-pill") ? getComputedStyle(document.querySelector(".who-pill")).display : "not found"`));
console.log("avatar display:", await js(`document.querySelector(".avatar") ? getComputedStyle(document.querySelector(".avatar")).display : "not found"`));
console.log("nav-inner innerHTML:", await js(`document.querySelector(".nav-inner")?.innerHTML`));

// Play page on mobile
await js(`
  location.hash = '#/play';
  window.__app.route();
`);
await sleep(1500);

const maxContentInfo = await js(`
  const p = document.querySelector(".lobby .picker");
  const items = [];
  for (const el of p.querySelectorAll("*")) {
    const clone = el.cloneNode(true);
    clone.style.width = "max-content";
    clone.style.position = "absolute";
    clone.style.visibility = "hidden";
    document.body.appendChild(clone);
    const maxW = clone.offsetWidth;
    clone.remove();
    if (maxW > 300) {
      items.push({ tag: el.tagName, cls: el.className, id: el.id, maxW, text: el.textContent?.slice(0, 30) });
    }
  }
  JSON.stringify(items.sort((a,b) => b.maxW - a.maxW).slice(0, 15));
`);
console.log("Max content elements:", maxContentInfo);

await shot("tests/inspect_mobile_play_overflow.png");

// Scroll down to check action button
await js(`window.scrollTo(0, document.body.scrollHeight)`);
await sleep(500);
await shot("tests/inspect_mobile_play_bottom.png");

// Studio page on mobile
await js(`
  location.hash = '#/studio';
  window.__app.route();
`);
await sleep(1500);
await shot("tests/inspect_mobile_studio.png");

process.exit(0);
