import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9398;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-rem-'));
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

if (!ws) {
  console.error('Failed to connect to Chrome CDP');
  process.exit(1);
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
  return res.result.result.value;
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
await evaluate(`document.getElementById('dev-signin-btn')?.click()`);
await sleep(1500);

// 1. Review
console.log('--- Testing Review ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/learn/review' });
await sleep(2000);
const reviewInfo = await evaluate(`({
  hasFcReview: !!document.querySelector('.fc-review'),
  hasFcCard: !!document.querySelector('.fc-card'),
  frontText: document.querySelector('.fc-front')?.innerText || '',
  flipBtn: !!document.getElementById('fc-flip')
})`);
console.log('Review info:', reviewInfo);
await snap('verified_restored_review');

// 2. Discover / Courses
console.log('--- Testing Discover ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/discover' });
await sleep(2000);
const discoverInfo = await evaluate(`({
  hasSearch: !!document.querySelector('.discover-search'),
  pcardCount: document.querySelectorAll('.pcard').length,
  firstTitle: document.querySelector('.pcard-title')?.textContent || ''
})`);
console.log('Discover info:', discoverInfo);
await snap('verified_restored_discover');

// 3. Studio
console.log('--- Testing Studio ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/studio' });
await sleep(2000);
const studioInfo = await evaluate(`({
  hasToolbar: !!document.querySelector('.studio-toolbar'),
  courseCardCount: document.querySelectorAll('.studio-course-card').length,
  newBtn: !!document.querySelector('.new-course')
})`);
console.log('Studio info:', studioInfo);
await snap('verified_restored_studio');

// 4. Words
console.log('--- Testing Words ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/learn/words' });
await sleep(2000);
const wordsInfo = await evaluate(`({
  hasFilter: !!document.querySelector('.words-filter'),
  hasSections: document.querySelectorAll('.words-deck-group').length
})`);
console.log('Words info:', wordsInfo);
await snap('verified_restored_words');

console.log('All remaining tests completed! Console errors:', consoleErrors.length);
proc.kill();
process.exit(0);
