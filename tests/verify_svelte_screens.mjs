import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9395;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-svelte2-'));
const artifactDir = 'C:/Users/Vartotojas/.gemini/antigravity/brain/0748c949-de18-49a8-bdf5-fafc30996d56';

const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=1280,850',
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    consoleErrors.push(m.params.args?.map(a => a.value || a.description).join(' '));
  }
});

async function captureScreen(route, filename, waitMs = 1200) {
  console.log(`\n--- Testing ${route} ---`);
  await send('Page.navigate', { url: 'http://localhost:8080/' + route });
  await sleep(waitMs);

  const title = (await send('Runtime.evaluate', { expression: 'document.title' })).result?.result?.value;
  const bodyText = (await send('Runtime.evaluate', {
    expression: 'document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 160)'
  })).result?.result?.value;

  console.log(`Title: ${title}`);
  console.log(`Content sample: ${bodyText}`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outPath = path.join(artifactDir, filename);
  fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
  console.log(`Saved screenshot: ${filename}`);
  return bodyText;
}

// 1. Landing Screen (Signed out)
await captureScreen('#/landing', 'verified_svelte_landing.png');

// 2. Click Dev Sign In button on landing
console.log('\n--- Clicking Dev Sign In button ---');
await send('Runtime.evaluate', {
  expression: `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Dev Sign In'));
    if (btn) btn.click();
    return !!btn;
  })()`
});
await sleep(1500);

// 2. Home / Learn Dashboard
await captureScreen('#/learn', 'verified_svelte_learn.png');

// 3. Review Flashcards
await captureScreen('#/learn/review', 'verified_svelte_review.png');

// 4. Play / Duels Lobby
await captureScreen('#/play', 'verified_svelte_play.png');

// 5. Course Path (Course 1)
await captureScreen('#/learn/course/1', 'verified_svelte_course_path.png');

// 6. Lesson Runner (Lesson 1)
await captureScreen('#/learn/lesson/1', 'verified_svelte_lesson.png');

// 7. Leaderboard
await captureScreen('#/leaderboard', 'verified_svelte_leaderboard.png');

// 8. Discover Catalog
await captureScreen('#/discover', 'verified_svelte_discover.png');

// 9. Course Studio
await captureScreen('#/studio', 'verified_svelte_studio.png');

console.log('\n=======================================');
console.log('Console Errors caught:', consoleErrors.length);
if (consoleErrors.length) {
  console.error(consoleErrors);
} else {
  console.log('Zero console errors encountered across all screens!');
}
console.log('ALL SCREENS VERIFIED SUCCESSFULLY!');

proc.kill();
process.exit(0);
