import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9398;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-web-'));
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

const evaluate = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return res.result?.result?.value;
};

const snap = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) {
    fs.writeFileSync(path.join(artifactDir, name + '.png'), Buffer.from(res.result.data, 'base64'));
    console.log(`Saved screenshot: ${name}.png`);
  }
};

console.log('--- 1. Testing Landing Page (signed out) ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/' });
await sleep(2500);

const landingInfo = await evaluate(`({
  hasGsi: !!document.getElementById('gsi'),
  hasDevBtn: !!document.getElementById('dev-signin-btn'),
  gsiContent: document.getElementById('gsi')?.innerText || '',
  hasHero: !!document.querySelector('.poster-hero'),
  bodyClasses: document.body.className
})`);
console.log('Landing state:', landingInfo);
await snap('verified_restored_landing');

console.log('--- 2. Signing In via Dev Sign In ---');
await evaluate(`document.getElementById('dev-signin-btn')?.click()`);
await sleep(2000);

console.log('--- 3. Testing Play Hub (Duels) ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/play' });
await sleep(2000);
const playInfo = await evaluate(`({
  hasPicker: !!document.querySelector('.picker'),
  deckCount: document.getElementById('deck-count')?.textContent || '',
  activeTab: document.querySelector('.tile[aria-selected="true"]')?.textContent?.trim() || ''
})`);
console.log('Play info:', playInfo);
await snap('verified_restored_play');

console.log('Creating duel room...');
await evaluate(`document.getElementById('create')?.click()`);
await sleep(2500);
const duelUrl = await evaluate(`location.href`);
console.log('Duel URL:', duelUrl);
await snap('verified_restored_duel');

console.log('--- 4. Testing Course Path & Answering Lessons ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/learn/course/1' });
await sleep(2000);
const coursePathInfo = await evaluate(`({
  title: document.querySelector('.course-head h2')?.textContent || '',
  lessonsCount: document.querySelectorAll('.lesson-node').length,
  firstLessonText: document.querySelector('.lesson-node')?.textContent?.trim() || ''
})`);
console.log('Course path info:', coursePathInfo);
await snap('verified_restored_course_path');

console.log('Opening first lesson...');
await evaluate(`document.querySelector('.lesson-node')?.click()`);
await sleep(2000);
await snap('verified_restored_lesson_start');

console.log('Answering lesson question...');
const answerResult = await evaluate(`(() => {
  const opt = document.querySelector('.option');
  if (opt) {
    opt.click();
    return 'option_clicked';
  }
  const input = document.getElementById('typed');
  if (input) {
    return 'input_present';
  }
  return 'unknown';
})()`);
console.log('Exercise type:', answerResult);
await sleep(500);
await evaluate(`document.getElementById('action')?.click()`);
await sleep(1500);
await snap('verified_restored_lesson_feedback');

const feedbackInfo = await evaluate(`({
  feedbackClass: document.getElementById('foot')?.className || '',
  feedbackText: document.getElementById('feedback')?.innerText || '',
  progressWidth: document.getElementById('prog')?.style?.width || ''
})`);
console.log('Feedback after check:', feedbackInfo);

console.log('--- 5. Testing Leaderboards ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/leaderboard' });
await sleep(2000);
const boardInfo = await evaluate(`({
  title: document.querySelector('.board-page header h2')?.textContent || '',
  hasRows: document.querySelectorAll('.board-item, .podium-spot, tr').length,
  meCard: document.querySelector('.muted.center')?.textContent || ''
})`);
console.log('Leaderboard info:', boardInfo);
await snap('verified_restored_leaderboard');

console.log('All tests completed! Console errors encountered:', consoleErrors.length);
proc.kill();
process.exit(0);
