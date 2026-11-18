import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9394;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-landing-'));
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

const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');

// 1. Check landing page signed out
await send('Page.navigate', { url: 'http://localhost:8080/#/' });
await sleep(1500);

const shot1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('tests/verified_landing_page.png', Buffer.from(shot1.result.data, 'base64'));
console.log('Saved tests/verified_landing_page.png (bytes:', fs.statSync('tests/verified_landing_page.png').size, ')');

// 2. Check landing page at #/landing even when signed in
await send('Runtime.evaluate', {
  expression: `fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Learner' }) })`
});
await sleep(500);
await send('Page.navigate', { url: 'http://localhost:8080/#/landing' });
await sleep(1500);

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('tests/verified_landing_preview_signedin.png', Buffer.from(shot2.result.data, 'base64'));
console.log('Saved tests/verified_landing_preview_signedin.png (bytes:', fs.statSync('tests/verified_landing_preview_signedin.png').size, ')');

proc.kill();
process.exit(0);
