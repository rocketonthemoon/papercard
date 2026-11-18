import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9396;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "comp-test-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=390,844",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => { try { proc.kill(); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
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

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);

await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(1500);

// 1. Home Today Card & Rank Line
console.log("Checking Home Today card & rank widget...");
const homeTest = await js(`({
  hasTodayWidget: !!document.getElementById('dash-today-widget'),
  hasTodayTitle: document.querySelector('#dash-today-widget h3')?.textContent === 'Today',
  hasRankWidget: !!document.querySelector('.dash-rank-widget'),
  rankText: document.querySelector('.dash-rank-val')?.textContent,
  enrolledPadding: getComputedStyle(document.querySelector('.enrolled-card')).padding
})`);
console.log("Home test:", homeTest);

// 2. Play Hub
console.log("\nChecking Play Hub...");
await js(`location.hash = '#/play'`);
await sleep(1000);
const playTest = await js(`({
  deckGroupsCount: document.querySelectorAll('details.deck-group').length,
  hasDeckSummary: !!document.querySelector('.deck-sel-count'),
  summaryText: document.querySelector('.deck-sel-count')?.textContent,
  tabTilesCount: document.querySelectorAll('.lobby .tile').length,
  tab1IconTag: document.querySelector('.lobby .tile svg')?.tagName,
  roomsEmptyLine: document.querySelector('.empty-rooms-line')?.textContent
})`);
console.log("Play test:", playTest);

// 3. Discover
console.log("\nChecking Discover...");
await js(`location.hash = '#/discover'`);
await sleep(1000);
const discoverTest = await js(`({
  langGroupHidden: document.getElementById('f-langs')?.hidden,
  filtersOpen: document.querySelector('details.filters')?.open,
  filtersClearTargetHeight: getComputedStyle(document.getElementById('f-clear')).minHeight
})`);
console.log("Discover test:", discoverTest);

// 4. Words list
console.log("\nChecking Words list...");
await js(`location.hash = '#/learn/words'`);
await sleep(1000);
const wordsTest = await js(`({
  hasNotYetPill: !!document.querySelector('.word-list .pill:not(.due):not(.ok)'),
  speakBtnMinHeight: getComputedStyle(document.querySelector('.w-speak')).minHeight
})`);
console.log("Words test:", wordsTest);

// 5. Course path
console.log("\nChecking Course path...");
await js(`location.hash = '#/learn/course/1'`);
await sleep(1000);
const pathTest = await js(`({
  hasCourseHeroMeta: !!document.querySelector('.course-hero-meta'),
  moduleNoBg: getComputedStyle(document.querySelector('.module-no')).backgroundColor,
  moduleNoBorder: getComputedStyle(document.querySelector('.module-no')).borderStyle,
  chevBorder: getComputedStyle(document.querySelector('.module-head .chev')).borderStyle,
  aboutCourseClass: document.querySelector('a[href="#/course/1"]')?.className
})`);
console.log("Course path test:", pathTest);

// 6. Profile
console.log("\nChecking Profile...");
await js(`location.hash = '#/u/Tester'`);
await sleep(1000);
const profileTest = await js(`({
  avatarWidth: getComputedStyle(document.querySelector('.profile .avatar.big')).width,
  avatarHeight: getComputedStyle(document.querySelector('.profile .avatar.big')).height,
  logoutBtnClass: document.getElementById('profile-logout')?.className,
  logoutBtnBg: getComputedStyle(document.getElementById('profile-logout')).backgroundColor,
  emptyLineText: document.querySelector('.empty-line')?.textContent
})`);
console.log("Profile test:", profileTest);

console.log("\nComponent verification complete!");
process.exit(0);
