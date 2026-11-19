import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9696;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-studio-nav-'));
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

// Navigate to Studio course 2
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/studio/2' });
await sleep(2000);

// Check sidebar active state
const sidebarStudio = await evaluate(`({
  hasAriaCurrent: document.querySelector('.side-links [data-nav=\"studio\"]')?.getAttribute('aria-current'),
  bg: getComputedStyle(document.querySelector('.side-links [data-nav=\"studio\"]')).backgroundColor,
  color: getComputedStyle(document.querySelector('.side-links [data-nav=\"studio\"]')).color
})`);
console.log('Sidebar Studio Active State:', sidebarStudio);

// Check Tab 1: Content
const tabContent = await evaluate(`({
  ariaSelected: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[0]?.getAttribute('aria-selected'),
  text: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[0]?.textContent.trim(),
  bg: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[0]).backgroundColor,
  color: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[0]).color
})`);
console.log('Tab 1 (Content):', tabContent);
await snap('verified_studio_active_tab_content');

// Click Tab 2: Arrange
await evaluate("document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[1]?.click()");
await sleep(600);
const tabArrange = await evaluate(`({
  ariaSelected: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[1]?.getAttribute('aria-selected'),
  text: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[1]?.textContent.trim(),
  bg: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[1]).backgroundColor,
  color: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[1]).color
})`);
console.log('Tab 2 (Arrange):', tabArrange);
await snap('verified_studio_active_tab_arrange');

// Click Tab 3: Suggestions
await evaluate("document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[2]?.click()");
await sleep(600);
const tabSuggestions = await evaluate(`({
  ariaSelected: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[2]?.getAttribute('aria-selected'),
  text: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[2]?.textContent.trim(),
  bg: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[2]).backgroundColor,
  color: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[2]).color
})`);
console.log('Tab 3 (Suggestions):', tabSuggestions);
await snap('verified_studio_active_tab_suggestions');

// Click Tab 4: Settings
await evaluate("document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[3]?.click()");
await sleep(600);
const tabSettings = await evaluate(`({
  ariaSelected: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[3]?.getAttribute('aria-selected'),
  text: document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[3]?.textContent.trim(),
  bg: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[3]).backgroundColor,
  color: getComputedStyle(document.querySelectorAll('.toolbar .segmented [role=\"tab\"]')[3]).color
})`);
console.log('Tab 4 (Settings):', tabSettings);
await snap('verified_studio_active_tab_settings');

console.log('Test completed! Console errors:', consoleErrors.length);
proc.kill();
process.exit(0);
