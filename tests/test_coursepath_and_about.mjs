import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9395;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-cpath-'));
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

const consoleErrors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map(a => a.value || a.description || '').join(' ');
    consoleErrors.push(text);
    console.log('Browser Error:', text);
  }
});

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

// Sign in
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/landing' });
await sleep(1500);
await evaluate("document.getElementById('dev-signin-btn')?.click()");
await sleep(1500);

// 1. Course Path
console.log('--- Testing Course Path ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/learn/course/1' });
await sleep(2000);

const coursePathInfo = await evaluate(`({
  heroTitle: document.querySelector('.course-hero-title')?.textContent,
  unitsCount: document.querySelectorAll('.module-card').length,
  openUnitTitle: document.querySelector('.module-card.open h2')?.textContent,
  lessonsInOpenUnit: document.querySelectorAll('.module-card.open .lesson-node').length,
  hasTodayWidget: !!document.querySelector('.dash-today-card'),
  hasRankCard: !!document.querySelector('.dash-rank-card')
})`);
console.log('Course path info:', coursePathInfo);
await snap('verified_restored_course_path_new');

// 2. Course Detail / About
console.log('--- Testing Course Detail / About ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/course/1' });
await sleep(2000);

const courseDetailInfo = await evaluate(`({
  courseTitle: document.querySelector('.course-hero h1')?.textContent,
  decksCount: document.querySelectorAll('.deck-row').length,
  hasSideCard: !!document.querySelector('.side-card'),
  actionBtn: document.querySelector('.course-hero-actions button, .course-hero-actions a')?.textContent
})`);
console.log('Course detail / about info:', courseDetailInfo);
await snap('verified_restored_course_detail_new');

console.log('All tests completed! Console errors:', consoleErrors.length);
proc.kill();
process.exit(0);
