import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 9396;
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-fc-'));
const proc = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--window-size=390,844',
  '--no-first-run',
  'about:blank'
], { stdio: 'ignore' });

process.on('exit', () => { try { proc.kill(); } catch {} });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
    if (p) ws = new WebSocket(p.webSocketDebuggerUrl);
  } catch { await sleep(200); }
}

await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

const send = (m, p = {}) => new Promise(r => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
const js = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:8080/#/' });
await sleep(1500);

await js(`fetch('/api/auth/dev', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: 'Abdul Salam' }) })`);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(2000);

const injectRes = await js(`
  (() => {
    const closeSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    const shuffleSvg = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 3.5h3v3M3.5 16.5l4-4 2 2 4 4h3M16.5 13.5v3h-3M3.5 3.5l6 6M12 12l4.5 4.5"/></svg>';
    const flipSvg = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h11a3 3 0 0 1 3 3v1M6 4 3 7l3 3M17 13H6a3 3 0 0 1-3-3V9M14 16l3-3-3-3"/></svg>';
    const speakerSvg = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5 4.5 8H2v4h2.5L9 15.5V4.5z"/><path d="M13 7a4 4 0 0 1 0 6"/><path d="M15.5 4.5a7.5 7.5 0 0 1 0 11"/></svg>';

    const html = '<div class="fc-review">' +
      '<header class="fc-top">' +
        '<div class="fc-top-bar">' +
          '<button class="icon-btn" id="fc-quit" aria-label="Quit review">' + closeSvg + '</button>' +
          '<div class="fc-counter">Card <b>1</b> / 9</div>' +
          '<div class="fc-top-actions">' +
            '<button class="btn outline small" id="fc-shuffle">' + shuffleSvg + ' Shuffle</button>' +
            '<button class="btn outline small" id="fc-dir">LT → EN</button>' +
          '</div>' +
        '</div>' +
        '<div class="progress progress-bar" role="progressbar" aria-valuenow="1" aria-valuemin="1" aria-valuemax="9">' +
          '<i style="width: 11%"></i>' +
        '</div>' +
      '</header>' +
      '<div class="fc-stage">' +
        '<div class="flashcard fc-card" id="fc-card">' +
          '<div class="flashcard-face flashcard-front">' +
            '<div class="fc-head">' +
              '<span class="tag-chip">noun</span>' +
              '<span class="pill">f</span>' +
              '<span class="pill ok">Learned</span>' +
            '</div>' +
            '<div class="fc-body">' +
              '<h2 class="fc-word">auditorija</h2>' +
              '<span class="fc-lang">Lithuanian</span>' +
              '<button type="button" class="icon-btn fc-speaker" id="fc-speak" title="Listen">' + speakerSvg + '</button>' +
            '</div>' +
            '<div class="fc-foot">' +
              '<span>' + flipSvg + ' Tap card or press <b>Space</b> to flip</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="fc-controls">' +
        '<div class="fc-actions" id="fc-actions-unflipped">' +
          '<button class="btn outline" id="fc-prev" disabled>← Previous</button>' +
          '<button class="btn fc-flip" id="fc-flip-btn">' + flipSvg + ' Flip card</button>' +
          '<button class="btn outline" id="fc-skip">Skip →</button>' +
        </div>' +
        '<p class="fc-keyboard-hints">Keyboard: Space flip</p>' +
      '</div>' +
    '</div>';
    document.getElementById('app').innerHTML = html;
    document.body.classList.add('focus');
    return 'injected';
  })()
`);
console.log('Inject result:', injectRes);
await sleep(1000);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('tests/inspect_flashcards_mobile_fixed.png', Buffer.from(shot.result.data, 'base64'));
console.log('Saved tests/inspect_flashcards_mobile_fixed.png');

const metrics = await js(`(() => {
  const actions = document.querySelector('.fc-actions');
  const btns = [...document.querySelectorAll('.fc-actions .btn')].map(b => ({
    text: b.textContent.trim(),
    rect: { left: Math.round(b.getBoundingClientRect().left), right: Math.round(b.getBoundingClientRect().right), width: Math.round(b.getBoundingClientRect().width) }
  }));
  const quit = document.querySelector('#fc-quit');
  const quitSvg = quit ? quit.querySelector('svg') : null;
  const hints = document.querySelector('.fc-keyboard-hints');
  return {
    quitBtn: quit ? {
      rect: { left: Math.round(quit.getBoundingClientRect().left), width: Math.round(quit.getBoundingClientRect().width), height: Math.round(quit.getBoundingClientRect().height) },
      bg: getComputedStyle(quit).backgroundColor,
      border: getComputedStyle(quit).border
    } : null,
    quitSvg: quitSvg ? {
      rect: { width: Math.round(quitSvg.getBoundingClientRect().width), height: Math.round(quitSvg.getBoundingClientRect().height) },
      stroke: getComputedStyle(quitSvg).stroke
    } : null,
    actionsRect: actions ? { left: Math.round(actions.getBoundingClientRect().left), right: Math.round(actions.getBoundingClientRect().right), width: Math.round(actions.getBoundingClientRect().width) } : null,
    buttons: btns,
    hintsDisplay: hints ? getComputedStyle(hints).display : null,
    scrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth
  };
})()`);
console.log('FLASHCARDS METRICS:', JSON.stringify(metrics, null, 2));

proc.kill();
