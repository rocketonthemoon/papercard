import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9397;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-logout-'));

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
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value || a.description || '').join(' ');
    console.log(`[Browser ${m.params.type}]`, text);
  }
});

const evaluate = async expr => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return res?.result?.result?.value;
};

// 1. Go to landing and sign in
await send('Page.navigate', { url: 'http://127.0.0.1:8080/#/landing' });
await sleep(1500);
await evaluate("document.getElementById('dev-signin-btn')?.click()");
await sleep(1500);

console.log('Current URL after sign-in:', await evaluate('location.href'));
console.log('Logout btn text:', await evaluate("document.getElementById('logout')?.textContent"));

// 2. Click sign out
console.log('Clicking Sign out button...');
await evaluate("document.getElementById('logout')?.click()");
await sleep(2000);

console.log('Current URL after sign out:', await evaluate('location.href'));
console.log('Landing poster exists?', await evaluate("!!document.querySelector('.landing-page-poster')"));
console.log('GSI exists?', await evaluate("!!document.querySelector('#gsi-btn-container')"));
console.log('Dev btn exists?', await evaluate("!!document.querySelector('#dev-signin-btn')"));
console.log('Body classes:', await evaluate('document.body.className'));
console.log('App Main HTML preview:', (await evaluate("document.getElementById('app-main')?.innerHTML") || '').slice(0, 300));

proc.kill();
process.exit(0);
