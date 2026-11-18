import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 9388;
const CHROME_PATH = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TARGET_URL = "http://localhost:8080/";
const SHOTS_DIR = "tests/audit_shots";

if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "qa-audit-"));
const proc = spawn(CHROME_PATH, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1280,800",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => {
  try { proc.kill(); } catch {}
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {
    await sleep(200);
  }
}

if (!ws) {
  console.error("Failed to connect to Chrome debugging port");
  process.exit(1);
}

await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});

const send = (method, params = {}) => new Promise((r) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});

const js = async (expr) => {
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return res.result?.result?.value;
};

const captureShot = async (filename) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const outPath = path.join(SHOTS_DIR, filename);
  fs.writeFileSync(outPath, Buffer.from(shot.result.data, "base64"));
  return outPath;
};

const setViewport = async (width, height, isMobile = false) => {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: isMobile ? 2 : 1,
    mobile: isMobile,
  });
  await sleep(300);
};

await send("Runtime.enable");
await send("Page.enable");

const auditResults = {
  routes: {},
  overflowChecks: {},
  phase0: {},
  phase1: {},
  phase2: {},
  phase3: {},
  phase4: {},
};

console.log("=== STARTING QA AUDIT ===");

// 1. Landing Page (Signed out)
await setViewport(1280, 800, false);
await send("Page.navigate", { url: TARGET_URL });
await sleep(1500);
// Ensure signed out
await js(`fetch('/api/auth/signout', { method: 'POST' }).then(() => { location.hash = '#/'; location.reload(); })`);
await sleep(1500);

auditResults.routes["landing_desktop"] = await captureShot("landing_1280.png");

// Check landing footer on desktop
const landingFooterDesktop = await js(`
  (() => {
    const f = document.querySelector('footer.footer');
    if (!f) return { exists: false };
    const cs = getComputedStyle(f);
    return {
      exists: true,
      display: cs.display,
      visibility: cs.visibility,
      hasGithub: !!f.querySelector('a[href*="github.com"]'),
      hasApache: f.textContent.includes('Apache 2.0')
    };
  })()
`);

// Landing on Mobile
await setViewport(390, 844, true);
await sleep(500);
auditResults.routes["landing_mobile"] = await captureShot("landing_390.png");

const landingOverflow = await js(`
  (() => {
    const w = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width > 0) {
        bad.push({ tag: el.tagName, cls: el.className, id: el.id, right: r.right, w });
      }
    }
    return { scrollW: document.documentElement.scrollWidth, innerW: w, overflows: bad.slice(0, 5) };
  })()
`);
auditResults.overflowChecks["landing"] = landingOverflow;

// Sign In for In-App Routes
await js(`
  fetch('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA Auditor' })
  }).then(r => r.json())
`);
await sleep(800);

const signedInRoutes = [
  { name: "learn", hash: "#/learn" },
  { name: "course_path", hash: "#/learn/course/1" },
  { name: "lesson", hash: "#/learn/lesson/1" },
  { name: "review", hash: "#/learn/review" },
  { name: "words", hash: "#/learn/words" },
  { name: "discover", hash: "#/discover" },
  { name: "course", hash: "#/course/1" },
  { name: "play", hash: "#/play" },
  { name: "leaderboard", hash: "#/leaderboard" },
  { name: "studio", hash: "#/studio" },
  { name: "profile", hash: "#/u/qa-auditor" },
];

for (const r of signedInRoutes) {
  console.log(`Auditing ${r.name} (${r.hash})...`);
  // Desktop
  await setViewport(1280, 800, false);
  await js(`location.hash = '${r.hash}'; if (window.__app && window.__app.route) window.__app.route(); else location.reload();`);
  await sleep(1500);
  auditResults.routes[`${r.name}_desktop`] = await captureShot(`${r.name}_1280.png`);

  // Mobile
  await setViewport(390, 844, true);
  await sleep(600);
  auditResults.routes[`${r.name}_mobile`] = await captureShot(`${r.name}_390.png`);

  // Overflow test
  const ov = await js(`
    (() => {
      const w = window.innerWidth;
      const bad = [];
      for (const el of document.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (rect.right > w + 1 && rect.width > 0) {
          bad.push({ tag: el.tagName, cls: el.className, id: el.id, right: rect.right, width: rect.width });
        }
      }
      return { scrollW: document.documentElement.scrollWidth, innerW: w, overflows: bad.slice(0, 5) };
    })()
  `);
  auditResults.overflowChecks[r.name] = ov;

  // Mobile footer & topbar title & bottom padding checks
  const mobileShell = await js(`
    (() => {
      const footer = document.querySelector('footer.footer');
      const footerStyle = footer ? getComputedStyle(footer) : null;
      const topTitle = document.getElementById('page-title');
      const topTitleStyle = topTitle ? getComputedStyle(topTitle) : null;
      const brand = document.querySelector('.nav .brand');
      const brandStyle = brand ? getComputedStyle(brand) : null;
      const app = document.getElementById('app');
      const appStyle = app ? getComputedStyle(app) : null;
      return {
        footerDisplay: footerStyle ? footerStyle.display : null,
        topTitleText: topTitle ? topTitle.textContent : '',
        topTitleDisplay: topTitleStyle ? topTitleStyle.display : null,
        brandDisplay: brandStyle ? brandStyle.display : null,
        appPaddingBottom: appStyle ? appStyle.paddingBottom : null,
      };
    })()
  `);
  auditResults.phase4[`${r.name}_shell`] = mobileShell;
}

// SPECIFIC CHECKS
console.log("Running detailed phase checks...");

// Phase 1: Lesson checks
await setViewport(390, 844, true);
await js(`location.hash = '#/learn/lesson/1'; window.__app.route();`);
await sleep(1500);
auditResults.phase1.lesson = await js(`
  (() => {
    const foot = document.querySelector('.lesson-foot');
    const footHint = document.querySelector('.foot-hint');
    const checkBtn = document.querySelector('#check-btn') || document.querySelector('.check-btn') || document.querySelector('button[data-action="check"]') || document.querySelector('.lesson-foot button.primary') || Array.from(document.querySelectorAll('.lesson-foot button')).find(b => b.textContent.includes('Check') || b.textContent.includes('CHECK'));
    const enterChip = checkBtn ? checkBtn.querySelector('.kbd, .chip, kbd') : null;
    return {
      footHintDisplay: footHint ? getComputedStyle(footHint).display : 'none',
      checkBtnWidth: checkBtn ? checkBtn.offsetWidth : null,
      footWidth: foot ? foot.offsetWidth : null,
      hasEnterChip: !!enterChip || (checkBtn ? checkBtn.textContent.includes('ENTER') : false),
      checkBtnText: checkBtn ? checkBtn.textContent.trim() : null,
      checkBtnDisabled: checkBtn ? checkBtn.disabled : null,
      checkBtnColor: checkBtn ? getComputedStyle(checkBtn).color : null,
      checkBtnBg: checkBtn ? getComputedStyle(checkBtn).backgroundColor : null,
    };
  })()
`);

// Phase 1: Words list checks
await setViewport(1280, 800, false);
await js(`location.hash = '#/learn/words'; window.__app.route();`);
await sleep(1500);
auditResults.phase1.words = await js(`
  (() => {
    const table = document.querySelector('.words-table, .words-list, table.words, .word-rows, ul.words');
    const row = document.querySelector('.word-row, tr.word, li.word-row');
    const rowGrid = row ? getComputedStyle(row).display : null;
    const filterTabs = document.querySelector('.filter-tabs, .tabs, .segmented-control');
    const tabsStyle = filterTabs ? {
      color: getComputedStyle(filterTabs).color,
      bg: getComputedStyle(filterTabs).backgroundColor,
    } : null;
    const notYetPills = Array.from(document.querySelectorAll('.word-row .status-pill, .word-row .pill, .word-row .badge')).filter(p => p.textContent.toLowerCase().includes('not yet'));
    return {
      rowDisplay: rowGrid,
      filterTabsFound: !!filterTabs,
      filterTabsStyle: tabsStyle,
      notYetPillCount: notYetPills.length
    };
  })()
`);

// Phase 1: Course page checks
await js(`location.hash = '#/course/1'; window.__app.route();`);
await sleep(1500);
auditResults.phase1.course = await js(`
  (() => {
    const deckRows = document.querySelectorAll('.deck-row, .unit-row, .course-deck');
    const firstDeck = deckRows[0];
    const topTitle = document.getElementById('page-title');
    return {
      deckCount: deckRows.length,
      firstDeckPadding: firstDeck ? getComputedStyle(firstDeck).padding : null,
      topBarTitle: topTitle ? topTitle.textContent : null,
    };
  })()
`);

// Phase 2: Button grammar & styling across app
auditResults.phase2.buttons = await js(`
  (() => {
    const buttons = Array.from(document.querySelectorAll('button, a.btn, a.pill-btn'));
    const yellowCTAs = [];
    const allCaps = [];
    for (const b of buttons) {
      const text = b.textContent.trim();
      const cs = getComputedStyle(b);
      const bg = cs.backgroundColor;
      // Check for yellow background CTA (#f4ed36 is rgb(244, 237, 54) or buttery rgb(249, 204, 115))
      if (bg.includes('244, 237, 54') || bg.includes('249, 204, 115')) {
        yellowCTAs.push({ text: text.slice(0, 30), bg });
      }
      if (text.length > 3 && text === text.toUpperCase() && /[A-Z]/.test(text) && !text.includes('PAPERCARD') && !text.includes('LT')) {
        allCaps.push(text.slice(0, 30));
      }
    }
    const verified = document.querySelector('.verified, svg.verified, .icon-verified, [data-verified]');
    const verifiedColor = verified ? getComputedStyle(verified).color || getComputedStyle(verified).fill : null;
    return {
      yellowCTAs,
      allCaps,
      verifiedColor
    };
  })()
`);

// Phase 2: Leaderboard toggle
await js(`location.hash = '#/leaderboard'; window.__app.route();`);
await sleep(1500);
auditResults.phase2.leaderboardToggle = await js(`
  (() => {
    const toggle = document.querySelector('.seg-control, .toggle, .tabs, .segmented');
    const btns = toggle ? Array.from(toggle.querySelectorAll('button, a')) : [];
    return btns.map(b => ({
      text: b.textContent.trim(),
      selected: b.classList.contains('active') || b.getAttribute('aria-selected') === 'true',
      color: getComputedStyle(b).color,
      bg: getComputedStyle(b).backgroundColor,
    }));
  })()
`);

// Phase 3: Home enrolled card & Today card
await js(`location.hash = '#/learn'; window.__app.route();`);
await sleep(1500);
auditResults.phase3.home = await js(`
  (() => {
    const todayCard = document.querySelector('.today-card, [data-card="today"]');
    const dailyProgress = Array.from(document.querySelectorAll('.card h3, .card h2')).find(h => h.textContent.includes('Daily Progress'));
    const quests = Array.from(document.querySelectorAll('.card h3, .card h2')).find(h => h.textContent.includes('Quests'));
    const rankLink = Array.from(document.querySelectorAll('a, button, .rank')).find(el => el.textContent.includes('#') || el.textContent.includes('this week'));
    const enrolledCard = document.querySelector('.enrolled-course-card, .course-hero, .enrolled-card');
    return {
      hasTodayCard: !!todayCard,
      hasSeparateDailyProgress: !!dailyProgress,
      hasSeparateQuests: !!quests,
      rankText: rankLink ? rankLink.textContent.trim() : null,
      enrolledCardStyle: enrolledCard ? {
        border: getComputedStyle(enrolledCard).border,
        boxShadow: getComputedStyle(enrolledCard).boxShadow
      } : null
    };
  })()
`);

// Phase 3: Play hub deck collapse
await js(`location.hash = '#/play'; window.__app.route();`);
await sleep(1500);
auditResults.phase3.play = await js(`
  (() => {
    const deckPickers = document.querySelectorAll('.level-group, .deck-group, details.deck-picker, [data-level-group]');
    const checkBoxes = document.querySelectorAll('.deck-checkbox, input[type="checkbox"]');
    return {
      groupCount: deckPickers.length,
      checkboxCount: checkBoxes.length,
      firstGroupSummary: deckPickers[0] ? deckPickers[0].querySelector('summary, .group-header')?.textContent?.trim() : null
    };
  })()
`);

// Phase 3: Profile avatar size on mobile
await setViewport(390, 844, true);
await js(`location.hash = '#/u/qa-auditor'; window.__app.route();`);
await sleep(1500);
auditResults.phase3.profileMobile = await js(`
  (() => {
    const av = document.querySelector('.profile-avatar, .avatar-large, .profile-head .avatar, .avatar');
    return {
      avatarWidth: av ? av.offsetWidth : null,
      avatarHeight: av ? av.offsetHeight : null
    };
  })()
`);

// Write report to JSON for inspection
fs.writeFileSync("tests/audit_results.json", JSON.stringify(auditResults, null, 2));
console.log("=== AUDIT SUITE FINISHED ===");
process.exit(0);
