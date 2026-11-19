import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9595;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-all-four-'));
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

// Auto-accept confirm dialogs
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

console.log('--- 1. Testing Sign In & Hearts in Header and Home ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/landing' });
await sleep(1500);
await evaluate("document.getElementById('dev-signin-btn')?.click()");
await sleep(1500);

const homeInfo = await evaluate(`({
  topChips: document.getElementById('top-chips')?.innerText.replace(/\\n/g, ' '),
  hasHeartsInHeader: document.querySelector('.top-chips [title=\"Hearts\"]') !== null,
  headerHeartsVal: document.querySelector('.top-chips [title=\"Hearts\"] b')?.textContent,
  hasHeartsInToday: document.querySelector('.chips [title=\"Hearts\"]') !== null,
  todayHeartsVal: document.querySelector('.chips [title=\"Hearts\"] b')?.textContent
})`);
console.log('Home & Header Hearts Info:', homeInfo);
await snap('verified_hearts_display');

console.log('--- 2. Testing Duel Answers Key & Right/Wrong Tags ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/play' });
await sleep(2000);
await evaluate("document.getElementById('create')?.click()");
await sleep(2500);

for (let i = 0; i < 10; i++) {
  await evaluate("document.querySelectorAll('.qdot')[" + i + "]?.click()");
  await sleep(150);
  await evaluate("document.querySelectorAll('.option')[0]?.click()");
  await sleep(200);
}
await evaluate("document.getElementById('submit')?.click()");
await sleep(2500);

const duelResults = await evaluate(`({
  score: document.querySelector('.score')?.textContent,
  totalItems: document.querySelectorAll('.list-card li.answer').length,
  rightTags: document.querySelectorAll('.list-card li.answer .tag.ok').length,
  wrongTags: document.querySelectorAll('.list-card li.answer .tag.miss').length,
  rightMarks: document.querySelectorAll('.list-card li.answer .mark-ok').length,
  wrongMarks: document.querySelectorAll('.list-card li.answer .mark-miss').length,
  firstItemText: document.querySelector('.list-card li.answer')?.innerText.replace(/\\n/g, ' ')
})`);
console.log('Duel Results Inspection:', duelResults);
await snap('verified_duel_key_tags');

console.log('--- 3. Testing CoursePath Stars & Feedback Modal ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/learn/course/1' });
await sleep(2000);

const coursePathInfo = await evaluate(`({
  unitsCount: document.querySelectorAll('.unit-card').length,
  hasStarsContainer: document.querySelector('.stars') !== null,
})`);
console.log('CoursePath Info:', coursePathInfo);

// Open feedback modal programmatically or via star click
await evaluate(`
  const firstUnit = document.querySelector('.unit-card');
  if (firstUnit) {
    // simulate finished deck feedback click
    const evt = new CustomEvent('click');
    const starBtn = document.querySelector('.stars .star');
    if (starBtn) starBtn.click();
  }
`);
await sleep(1000);
await snap('verified_course_path_stars');

console.log('--- 4. Testing Studio Editor Navigation, Stability & Arrange Deck ---');
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/studio/2' });
await sleep(2000);

const tbBefore = await evaluate(`({
  x: document.querySelector('.toolbar')?.getBoundingClientRect().x,
  y: document.querySelector('.toolbar')?.getBoundingClientRect().y,
  width: document.querySelector('.toolbar')?.getBoundingClientRect().width,
  actionsWidth: document.querySelector('.toolbar-actions')?.getBoundingClientRect().width
})`);
console.log('Toolbar in Content:', tbBefore);
await snap('verified_studio_content_stable');

// Switch to Arrange
console.log('Switching to Arrange tab...');
await evaluate("document.querySelectorAll('.segmented [role=\"tab\"]')[1]?.click()");
await sleep(1000);

const tbArrange = await evaluate(`({
  x: document.querySelector('.toolbar')?.getBoundingClientRect().x,
  y: document.querySelector('.toolbar')?.getBoundingClientRect().y,
  width: document.querySelector('.toolbar')?.getBoundingClientRect().width,
  actionsWidth: document.querySelector('.toolbar-actions')?.getBoundingClientRect().width,
  boardColsCount: document.querySelectorAll('.board-col').length,
  hasMoveLeftRight: document.querySelector('.board-col-head [title=\"Move deck left\"]') !== null,
  hasMoveUpDown: document.querySelector('.board-card [title=\"Move lesson up\"]') !== null,
  hasQuickAddLesson: document.querySelector('.board-add input') !== null,
  hasQuickAddDeck: document.getElementById('board-new-deck') !== null
})`);
console.log('Toolbar & Features in Arrange:', tbArrange);
await snap('verified_studio_arrange_functional');

// Switch to Suggestions (Feedback)
console.log('Switching to Suggestions tab...');
await evaluate("document.querySelectorAll('.segmented [role=\"tab\"]')[2]?.click()");
await sleep(1000);

const tbSuggestions = await evaluate(`({
  x: document.querySelector('.toolbar')?.getBoundingClientRect().x,
  y: document.querySelector('.toolbar')?.getBoundingClientRect().y,
  width: document.querySelector('.toolbar')?.getBoundingClientRect().width,
  actionsWidth: document.querySelector('.toolbar-actions')?.getBoundingClientRect().width,
  hasFilterSegment: document.querySelector('.cms-main .segmented') !== null
})`);
console.log('Toolbar in Suggestions:', tbSuggestions);
await snap('verified_studio_suggestions');

// Switch to Settings
console.log('Switching to Settings tab...');
await evaluate("document.querySelectorAll('.segmented [role=\"tab\"]')[3]?.click()");
await sleep(1000);

const tbSettings = await evaluate(`({
  x: document.querySelector('.toolbar')?.getBoundingClientRect().x,
  y: document.querySelector('.toolbar')?.getBoundingClientRect().y,
  width: document.querySelector('.toolbar')?.getBoundingClientRect().width,
  actionsWidth: document.querySelector('.toolbar-actions')?.getBoundingClientRect().width
})`);
console.log('Toolbar in Settings:', tbSettings);
await snap('verified_studio_settings_stable');

// Test clicking a lesson card in Arrange to verify navigation to Content
await evaluate("document.querySelectorAll('.segmented [role=\"tab\"]')[1]?.click()");
await sleep(600);
console.log('Clicking lesson open button to verify navigation inside Studio...');
await evaluate("document.querySelector('.board-card [title=\"Edit its words in Content\"]')?.click()");
await sleep(1000);

const afterOpen = await evaluate(`({
  activeTab: document.querySelector('.segmented [role=\"tab\"].selected')?.textContent.trim(),
  hasCmsMain: document.getElementById('cms-main') !== null
})`);
console.log('After clicking lesson in Arrange, navigated to:', afterOpen);

console.log('All tests completed! Console errors:', consoleErrors.length);
proc.kill();
process.exit(0);
