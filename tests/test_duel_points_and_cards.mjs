import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9394;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-duel-pts-'));
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

// Auto-accept any dialogs (like confirm)
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.javascriptDialogOpening') {
    send('Page.handleJavaScriptDialog', { accept: true });
  }
});

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

// 1. Sign in
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/landing' });
await sleep(1500);
await evaluate("document.getElementById('dev-signin-btn')?.click()");
await sleep(1500);

// 2. Go to Play and create a room
console.log('Creating duel room in Play...');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/play' });
await sleep(2000);
await evaluate("document.getElementById('create')?.click()");
await sleep(2500);

const duelUrl = await evaluate('location.href');
console.log('Navigated to duel:', duelUrl);

// 3. Measure question 1 card dimensions
const q1Metrics = await evaluate(`({
  sheetHeight: document.querySelector('.duel-sheet')?.getBoundingClientRect().height,
  sheetWidth: document.querySelector('.duel-sheet')?.getBoundingClientRect().width,
  promptHeight: document.querySelector('.prompt-card')?.getBoundingClientRect().height,
  qcardHeight: document.querySelector('.duel-q')?.getBoundingClientRect().height,
  promptText: document.querySelector('.prompt-word')?.textContent
})`);
console.log('Question 1 Metrics:', q1Metrics);
await snap('verified_duel_q1');

// Click question 2 dot
await evaluate("document.querySelectorAll('.qdot')[1]?.click()");
await sleep(500);

// Measure question 2 card dimensions
const q2Metrics = await evaluate(`({
  sheetHeight: document.querySelector('.duel-sheet')?.getBoundingClientRect().height,
  sheetWidth: document.querySelector('.duel-sheet')?.getBoundingClientRect().width,
  promptHeight: document.querySelector('.prompt-card')?.getBoundingClientRect().height,
  qcardHeight: document.querySelector('.duel-q')?.getBoundingClientRect().height,
  promptText: document.querySelector('.prompt-word')?.textContent
})`);
console.log('Question 2 Metrics:', q2Metrics);
await snap('verified_duel_q2');

// Click question 3 dot
await evaluate("document.querySelectorAll('.qdot')[2]?.click()");
await sleep(500);

// Measure question 3 card dimensions
const q3Metrics = await evaluate(`({
  sheetHeight: document.querySelector('.duel-sheet')?.getBoundingClientRect().height,
  sheetWidth: document.querySelector('.duel-sheet')?.getBoundingClientRect().width,
  promptHeight: document.querySelector('.prompt-card')?.getBoundingClientRect().height,
  qcardHeight: document.querySelector('.duel-q')?.getBoundingClientRect().height,
  promptText: document.querySelector('.prompt-word')?.textContent
})`);
console.log('Question 3 Metrics:', q3Metrics);

// 4. Answer all questions
const questionCount = await evaluate("document.querySelectorAll('.qdot').length");
console.log('Answering all', questionCount, 'questions...');
for (let i = 0; i < questionCount; i++) {
  await evaluate(`document.querySelectorAll('.qdot')[${i}]?.click()`);
  await sleep(200);
  await evaluate("document.querySelectorAll('.option')[0]?.click()");
  await sleep(300);
}

// 5. Submit duel
console.log('Submitting duel...');
await evaluate("document.getElementById('submit')?.click()");
await sleep(2500);

// 6. Verify Results & Points calculation
const resultsInfo = await evaluate(`({
  scoreText: document.querySelector('.score')?.textContent,
  pointsValue: document.querySelector('.score b')?.textContent,
  maxPoints: document.querySelector('.score span')?.textContent,
  rightCount: document.querySelector('.good')?.textContent,
  scoreboardPts: document.querySelector('.pts b')?.textContent,
  answersCount: document.querySelectorAll('li.answer').length,
  rightAnswers: document.querySelectorAll('li.answer .tag.ok').length,
  wrongAnswers: document.querySelectorAll('li.answer .tag.miss').length,
  firstAnswer: document.querySelector('li.answer')?.innerText.replace(/\\n/g, ' ')
})`);
console.log('Duel Results Info:', resultsInfo);
await snap('verified_duel_results_points');

console.log('All tests completed! Console errors:', consoleErrors.length);
proc.kill();
process.exit(0);
