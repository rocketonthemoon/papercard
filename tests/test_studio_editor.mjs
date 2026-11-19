import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9393;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-studio-edit-'));
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

// 1. Sign in
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/landing' });
await sleep(1500);
await evaluate("document.getElementById('dev-signin-btn')?.click()");
await sleep(1500);

// 2. Go to Studio Home
console.log('--- Testing Studio Home ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/studio' });
await sleep(2000);

const studioCourseHref = await evaluate("document.querySelector('.studio-course-card a.btn, .studio-course-card .btn')?.getAttribute('href')");
console.log('First studio course edit link:', studioCourseHref);

// Navigate to edit that course
const targetEditUrl = studioCourseHref ? `http://127.0.0.1:8080/${studioCourseHref}` : 'http://127.0.0.1:8080/#/studio/2';
await send('Page.navigate', { url: targetEditUrl });
await sleep(2000);

// 3. Check Content View
const contentInfo = await evaluate(`({
  courseTitle: document.querySelector('.page-head h1')?.textContent,
  tabs: Array.from(document.querySelectorAll('.segmented button')).map(b => b.textContent.trim()),
  decksInTree: document.querySelectorAll('.tree-unit').length,
  hasCmsMain: !!document.querySelector('.cms-main'),
  hasAddWordBtn: !!document.querySelector('.cms-main button')
})`);
console.log('Content View Info:', contentInfo);
await snap('verified_studio_editor_content');

// 4. Switch to Arrange Tab
console.log('Switching to Arrange Tab...');
await evaluate("Array.from(document.querySelectorAll('.segmented button')).find(b => b.textContent.includes('Arrange'))?.click()");
await sleep(1000);

const arrangeInfo = await evaluate(`({
  boardColsCount: document.querySelectorAll('.board-col').length,
  hasNewDeckBtn: !!document.querySelector('.board-new')
})`);
console.log('Arrange View Info:', arrangeInfo);
await snap('verified_studio_editor_arrange');

// 5. Switch to Settings Tab
console.log('Switching to Settings Tab...');
await evaluate("Array.from(document.querySelectorAll('.segmented button')).find(b => b.textContent.includes('Settings'))?.click()");
await sleep(1000);

const settingsInfo = await evaluate(`({
  hasSettingsForm: !!document.querySelector('.settings-grid form'),
  titleVal: document.querySelector('.settings-grid input[type=text]')?.value,
  hasTokensCard: !!document.querySelector('.codes-card'),
  hasDangerZone: !!document.querySelector('.danger-zone')
})`);
console.log('Settings View Info:', settingsInfo);
await snap('verified_studio_editor_settings');

console.log('All Studio Editor tests completed! Console errors:', consoleErrors.length);
proc.kill();
process.exit(0);
