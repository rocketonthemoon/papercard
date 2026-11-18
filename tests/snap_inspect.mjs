import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "snap-rev-"));
const proc = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-port=9342",
  `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch("http://127.0.0.1:9342/json")).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { await sleep(200); }
}

await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (filePath) => {
  const png = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(filePath, Buffer.from(png.result.data, "base64"));
  console.log("Saved:", filePath);
};

await send("Runtime.enable");
await send("Page.enable");

// Go to site and authenticate
await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);
await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.reload()`);
await sleep(1500);

// Studio page as admin
await js(`
  window.__app.me.isAdmin = true;
  location.hash = '#/studio';
  window.__app.route();
`);
await sleep(1500);
await shot("tests/inspect_studio_admin.png");

// Play page
await js(`location.hash = '#/play'`);
await sleep(1500);
await shot("tests/inspect_play_fixed.png");

// Admin page with mocked admin data if needed
await js(`
  window.__app.me.isAdmin = true;
  const origFetch = window.fetch;
  window.fetch = async (url, opts) => {
    if (url === '/api/admin/courses') {
      return new Response(JSON.stringify({
        courses: [
          { id: 1, title: "Spanish for travellers", toCode: "es", toLang: "Spanish", words: 1, learners: 1, updatedAt: 1731934800000, creator: { id: 2, name: "Tester 399", official: false }, hidden: false },
          { id: 2, title: "Lithuanian History", toCode: "lt", toLang: "Lithuanian", words: 198, learners: 3, updatedAt: 1731934800000, creator: { id: 1, name: "Vokab", official: true }, hidden: false },
          { id: 3, title: "Lithuanian Vocabulary", toCode: "lt", toLang: "Lithuanian", words: 333, learners: 10, updatedAt: 1731934800000, creator: { id: 1, name: "Vokab", official: true }, hidden: false }
        ],
        players: 10,
        xpToday: 980
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch(url, opts);
  };
  location.hash = '#/admin';
  window.__app.route();
`);
await sleep(1500);
await shot("tests/inspect_admin_fixed.png");

// Flashcard Review
await js(`
  window.fetch = async (url, opts) => {
    if (url === '/api/learn/words') {
      return new Response(JSON.stringify({
        course: { id: 1, toLang: "Lithuanian", fromLang: "English" },
        units: [{
          id: 1,
          lessons: [{
            id: 1,
            words: [
              { id: 101, lt: "universitetas", en: "university", pos: "noun", gender: "m", learned: true, dueAt: Date.now() + 100000 }
            ]
          }]
        }],
        stats: { learned: 1, due: 0, hearts: 5, maxHearts: 5 },
        now: Date.now()
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/admin/courses') {
      return new Response(JSON.stringify({
        courses: [
          { id: 1, title: "Spanish for travellers", toCode: "es", toLang: "Spanish", words: 1, learners: 1, updatedAt: 1731934800000, creator: { id: 2, name: "Tester 399", official: false }, hidden: false },
          { id: 2, title: "Lithuanian History", toCode: "lt", toLang: "Lithuanian", words: 198, learners: 3, updatedAt: 1731934800000, creator: { id: 1, name: "Vokab", official: true }, hidden: false },
          { id: 3, title: "Lithuanian Vocabulary", toCode: "lt", toLang: "Lithuanian", words: 333, learners: 10, updatedAt: 1731934800000, creator: { id: 1, name: "Vokab", official: true }, hidden: false }
        ],
        players: 10,
        xpToday: 980
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return fetch(url, opts);
  };
  location.hash = '#/learn/review';
  window.__app.route();
`);
await sleep(1500);
await shot("tests/inspect_flashcard_fixed.png");

// Flip card to verify the back face
await js(`document.getElementById("fc-card").click()`);
await sleep(500);
await shot("tests/inspect_flashcard_back.png");

// Discover search page with search "abdul"
await js(`
  location.hash = '#/discover?q=abdul';
  window.__app.route();
`);
await sleep(1500);
await shot("tests/inspect_search_abdul.png");

// Discover page
await js(`location.hash = '#/discover'`);
await sleep(1500);
await shot("tests/inspect_courses_fixed.png");

process.exit(0);
