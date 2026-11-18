import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9391;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-els-'));
const proc = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--window-size=1280,800',
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

await send('Page.navigate', { url: 'http://localhost:8080/#/' });
await sleep(1500);

const expr = `(() => {
  return Array.from(document.querySelectorAll('#app *')).map(el => ({
    tag: el.tagName,
    cls: el.className,
    text: el.innerText ? el.innerText.slice(0, 30) : '',
    rect: { top: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }
  })).filter(x => x.rect.h > 0);
})()`;

const els = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
console.log('Elements count in #app:', els ? els.length : 0);
if (els) {
  console.log('First 20 elements in #app:', JSON.stringify(els.slice(0, 20), null, 2));
}

// Now let's check what if the user is SIGNED IN:
await send('Runtime.evaluate', {
  expression: `fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) })`
});
await sleep(500);
await send('Page.navigate', { url: 'http://localhost:8080/#/' });
await sleep(1500);

const signedInHash = (await send('Runtime.evaluate', { expression: 'location.hash' })).result?.result?.value;
console.log('Signed in location.hash after going to #/:', signedInHash);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('tests/debug_signed_in_hash.png', Buffer.from(shot.result.data, 'base64'));

proc.kill();
process.exit(0);
