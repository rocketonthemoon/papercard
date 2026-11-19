import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9396;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-align-'));
const artifactDir = 'C:/Users/Vartotojas/.gemini/antigravity/brain/0748c949-de18-49a8-bdf5-fafc30996d56';

const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=1280,900',
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

const send = (method, params = {}) => new Promise(r => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');

const evaluate = async expr => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return res?.result?.result?.value;
};

const snap = async name => {
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(artifactDir, name + '.png');
  fs.writeFileSync(p, Buffer.from(result.data, 'base64'));
  console.log('Saved screenshot:', name + '.png');
};

// 1. Sign in
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/landing' });
await sleep(1500);
await evaluate("document.getElementById('dev-signin-btn')?.click()");
await sleep(1500);

// Check alignment of dashboard
console.log('Checking Home alignment...');
const layoutBoxes = await evaluate(`({
  sidebarWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width,
  sidebarLeft: document.querySelector('.sidebar')?.getBoundingClientRect().left,
  navLeft: document.querySelector('.nav')?.getBoundingClientRect().left,
  mainLeft: document.querySelector('.app')?.getBoundingClientRect().left,
  mainWidth: document.querySelector('.app')?.getBoundingClientRect().width,
  bodyPaddingLeft: getComputedStyle(document.body).paddingLeft,
  appPaddingLeft: getComputedStyle(document.getElementById('app')).paddingLeft
})`);
console.log('Layout boxes on Home:', layoutBoxes);
await snap('verified_aligned_home');

// 2. Click sign out
console.log('Clicking sign out...');
await evaluate("document.getElementById('logout')?.click()");
await sleep(1500);

console.log('Post-logout URL:', await evaluate('location.href'));
console.log('Post-logout Body classes:', await evaluate('document.body.className'));
console.log('Post-logout Landing poster visible?', await evaluate("!!document.querySelector('.landing-page-poster')"));
await snap('verified_post_logout_landing');

proc.kill();
process.exit(0);
