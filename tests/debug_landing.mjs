import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9389;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-rect-'));
const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=1280,800',
  '--no-first-run',
  'about:blank'
], { stdio: 'ignore' });

process.on('exit', () => { try { proc.kill(); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const page = list.find(t => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { await sleep(200); }
}

await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');

await send('Page.navigate', { url: 'http://localhost:8080/#/' });
await sleep(1500);

const metrics = (await send('Runtime.evaluate', {
  expression: `(() => {
    const app = document.querySelector("#app");
    const poster = document.querySelector(".landing-page-poster");
    const hero = document.querySelector(".poster-hero");
    const title = document.querySelector(".poster-display-title");
    const r = el => el ? { top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width } : null;
    return {
      appDisplay: app ? getComputedStyle(app).display : null,
      appVisibility: app ? getComputedStyle(app).visibility : null,
      appRect: r(app),
      posterDisplay: poster ? getComputedStyle(poster).display : null,
      posterVisibility: poster ? getComputedStyle(poster).visibility : null,
      posterRect: r(poster),
      heroRect: r(hero),
      titleText: title ? title.innerText : null,
      titleColor: title ? getComputedStyle(title).color : null
    };
  })()`,
  returnByValue: true
})).result?.result?.value;

console.log('Metrics:', JSON.stringify(metrics, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('tests/debug_landing_actual.png', Buffer.from(shot.result.data, 'base64'));
console.log('Saved tests/debug_landing_actual.png');

proc.kill();
process.exit(0);
