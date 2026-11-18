import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 9392;
const CHROME_PATH = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TARGET_URL = "http://localhost:8080/";
const SHOTS_DIR = "tests/audit_shots";

if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "qa-verify-"));
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
  console.log(`Saved screenshot: ${outPath} (${fs.statSync(outPath).size} bytes)`);
  return outPath;
};

const setViewport = async (width, height, isMobile = false) => {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: isMobile ? 2 : 1,
    mobile: isMobile,
  });
  await sleep(400);
};

await send("Runtime.enable");
await send("Page.enable");

const report = {
  summary: {
    passed: 0,
    failed: 0,
    warnings: 0,
  },
  items: {},
  screenshots: {},
  routes: {},
};

function recordItem(phase, id, title, passed, details) {
  const key = `${phase} - ${id}: ${title}`;
  report.items[key] = { passed, details };
  if (passed === true) report.summary.passed++;
  else if (passed === false) report.summary.failed++;
  else report.summary.warnings++;
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${key}`);
  if (details && !passed) console.log(`   -> Details:`, details);
}

console.log("=== STARTING QA AUDIT (POST-FIX VERIFICATION) ===");

// 1. Landing Page (Signed out)
console.log("--- Checking Landing Page ---");
await setViewport(1280, 800, false);
await send("Page.navigate", { url: TARGET_URL });
await sleep(1500);
await js(`fetch('/api/auth/signout', { method: 'POST' }).finally(() => { location.hash = '#/'; location.reload(); })`);
await sleep(1500);

report.screenshots["landing_desktop"] = await captureShot("landing_1280.png");

// Mobile landing
await setViewport(390, 844, true);
await sleep(600);
report.screenshots["landing_mobile"] = await captureShot("landing_390.png");

const landingAudit = await js(`
  (() => {
    const footer = document.querySelector('footer.footer');
    const fCs = footer ? getComputedStyle(footer) : null;
    const w = window.innerWidth;
    const overflowing = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width > 0) {
        overflowing.push({ tag: el.tagName, cls: el.className.slice(0, 30), right: r.right });
      }
    }
    return {
      footerVisible: footer && fCs && fCs.display !== 'none' && fCs.visibility !== 'hidden',
      footerHasGithub: !!footer?.querySelector('a[href*="github.com"]'),
      footerHasApache: footer?.textContent.includes('Apache 2.0') ?? false,
      overflowing,
      scrollWidth: document.documentElement.scrollWidth,
    };
  })()
`);

recordItem("Phase 4", "landing_footer", "App footer visible on landing page with GitHub and Apache 2.0",
  landingAudit.footerVisible && landingAudit.footerHasGithub && landingAudit.footerHasApache,
  landingAudit
);
recordItem("Phase 4", "landing_no_overflow", "No horizontal overflow on landing page at 390px",
  landingAudit.overflowing.length === 0,
  landingAudit.overflowing
);

// 2. Dev sign-in and initialize app state
console.log("--- Signing in via Dev Auth ---");
await js(`
  fetch('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA Auditor' })
  }).then(r => r.json())
`);
await sleep(500);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(2000);

const currentUser = await js(`window.__app ? window.__app.me : null`);
console.log("Logged in user:", currentUser);

const myUsername = currentUser?.username || "qa-auditor";

// Audit each route
const routesToAudit = [
  { name: "learn", title: "Home / Enrolled Courses", hash: "#/learn" },
  { name: "course_path", title: "Course Path", hash: "#/learn/course/1" },
  { name: "lesson", title: "Lesson Active", hash: "#/learn/lesson/1" },
  { name: "review", title: "Review", hash: "#/learn/review" },
  { name: "words", title: "Words List", hash: "#/learn/words" },
  { name: "discover", title: "Discover / Courses", hash: "#/discover" },
  { name: "course_overview", title: "Course Page Overview", hash: "#/course/1" },
  { name: "play", title: "Play Hub", hash: "#/play" },
  { name: "leaderboard", title: "Leaderboard", hash: "#/leaderboard" },
  { name: "studio", title: "Studio Home", hash: "#/studio" },
  { name: "profile", title: "Profile Page", hash: `#/u/${myUsername}` },
];

for (const r of routesToAudit) {
  console.log(`\nAuditing route: ${r.title} (${r.hash})`);
  // 1280 Desktop
  await setViewport(1280, 800, false);
  await js(`location.hash = '${r.hash}';`);
  await sleep(1200);
  report.screenshots[`${r.name}_desktop`] = await captureShot(`${r.name}_1280.png`);

  // 390 Mobile
  await setViewport(390, 844, true);
  await sleep(600);
  report.screenshots[`${r.name}_mobile`] = await captureShot(`${r.name}_390.png`);

  // Route-level inspection
  const routeAudit = await js(`
    (() => {
      const w = window.innerWidth;
      const overflowing = [];
      for (const el of document.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (rect.right > w + 1 && rect.width > 0) {
          overflowing.push({ tag: el.tagName, cls: (el.className || '').slice(0, 40), id: el.id, right: rect.right, w });
        }
      }

      // App footer check (in-app routes must hide footer)
      const footer = document.querySelector('footer.footer');
      const footerCs = footer ? getComputedStyle(footer) : null;
      const footerHidden = !footer || footerCs.display === 'none' || footerCs.visibility === 'hidden';

      // Mobile padding-bottom check
      const app = document.getElementById('app');
      const appCs = app ? getComputedStyle(app) : null;
      const pbVal = appCs ? parseInt(appCs.paddingBottom, 10) : 0;

      // Top bar title check on mobile
      const pageTitle = document.getElementById('page-title');
      const pageTitleCs = pageTitle ? getComputedStyle(pageTitle) : null;
      const brandWordmark = document.querySelector('.nav .brand-wordmark');
      const brandWordmarkCs = brandWordmark ? getComputedStyle(brandWordmark) : null;
      const brandLink = document.querySelector('.nav a.brand');
      const brandLinkCs = brandLink ? getComputedStyle(brandLink) : null;

      // Tap targets < 44px
      const smallTargets = [];
      const interactives = Array.from(document.querySelectorAll('button, a, input, select, summary, .interactive'));
      for (const el of interactives) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          if (!el.closest('p, span') || el.tagName === 'BUTTON') {
            smallTargets.push({
              tag: el.tagName,
              text: el.textContent.trim().slice(0, 25),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
              cls: (el.className || '').slice(0, 30)
            });
          }
        }
      }

      return {
        overflowing,
        footerHidden,
        footerDisplay: footerCs ? footerCs.display : null,
        paddingBottom: pbVal,
        topBar: {
          titleText: pageTitle ? pageTitle.textContent.trim() : '',
          titleDisplay: pageTitleCs ? pageTitleCs.display : 'none',
          brandDisplay: brandWordmarkCs ? brandWordmarkCs.display : (brandLinkCs ? brandLinkCs.display : 'none'),
          brandHidden: (!brandLink || brandLinkCs?.display === 'none') || (!brandWordmark || brandWordmarkCs?.display === 'none')
        },
        smallTargets: smallTargets.slice(0, 10)
      };
    })()
  `);

  report.routes[r.name] = routeAudit;

  // Acceptance checks
  recordItem("Phase 4", `${r.name}_no_overflow`, `No horizontal overflow on ${r.name} at 390px`,
    routeAudit.overflowing.length === 0,
    routeAudit.overflowing
  );

  recordItem("Phase 4", `${r.name}_footer_hidden`, `App footer hidden in-app on ${r.name}`,
    routeAudit.footerHidden,
    { footerDisplay: routeAudit.footerDisplay }
  );

  recordItem("Phase 4", `${r.name}_padding_bottom`, `Mobile padding-bottom >= 64px prevents tab bar overlap on ${r.name}`,
    routeAudit.paddingBottom >= 64,
    { paddingBottom: routeAudit.paddingBottom }
  );

  if (r.name !== 'lesson') {
    // Lesson page is focus mode, but other pages must show active title on mobile
    recordItem("Phase 4", `${r.name}_mobile_topbar_title`, `Mobile top bar shows active page title on ${r.name}`,
      routeAudit.topBar.titleDisplay !== 'none' && routeAudit.topBar.titleText.length > 0 && routeAudit.topBar.brandHidden,
      routeAudit.topBar
    );
  }
}

// =========================================================================
// DEEP ACCEPTANCE CHECKS PER PHASE
// =========================================================================
console.log("\n--- Checking Phase 0: Design Tokens & Typography ---");
const phase0Audit = await js(`
  (() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const h1 = document.querySelector('h1, h2, .brand-wordmark');
    const h1Style = h1 ? getComputedStyle(h1) : null;
    const hasGameCss = !!document.querySelector('link[href*="game.css"]');
    return {
      duskViolet: rootStyle.getPropertyValue('--color-dusk-violet').trim(),
      hiVisYellow: rootStyle.getPropertyValue('--color-hi-vis-yellow').trim(),
      boneWhite: rootStyle.getPropertyValue('--color-bone-white').trim(),
      inkBlack: rootStyle.getPropertyValue('--color-ink-black').trim(),
      radiusCards: rootStyle.getPropertyValue('--radius-cards').trim() || rootStyle.getPropertyValue('--r-card').trim(),
      radiusPill: rootStyle.getPropertyValue('--radius-pill').trim() || rootStyle.getPropertyValue('--r-pill').trim(),
      bodyFont: bodyStyle.fontFamily,
      headingFont: h1Style ? h1Style.fontFamily : null,
      hasGameCss
    };
  })()
`);

recordItem("Phase 0", "tokens_colors", "Key palette tokens defined in CSS root",
  phase0Audit.duskViolet === '#8584bd' && phase0Audit.boneWhite === '#f9f5f2',
  phase0Audit
);
recordItem("Phase 0", "tokens_radii", "Radii conform to 6px cards and 100px pills",
  (phase0Audit.radiusCards === '6px' || phase0Audit.radiusCards === '6px !important') &&
  (phase0Audit.radiusPill === '100px' || phase0Audit.radiusPill === '100px !important'),
  phase0Audit
);
recordItem("Phase 0", "font_hierarchy", "Font hierarchy matches Syne/Inter/JetBrains Mono",
  phase0Audit.bodyFont.includes('Inter') && phase0Audit.headingFont?.includes('Syne'),
  phase0Audit
);
recordItem("Phase 0", "game_css_removed", "game.css removed from index.html (folded into design.css)",
  !phase0Audit.hasGameCss,
  { hasGameCss: phase0Audit.hasGameCss }
);

console.log("\n--- Checking Phase 1: Visibly Broken Items ---");
// 1. Lesson footer on mobile
await setViewport(390, 844, true);
await js(`location.hash = '#/learn/lesson/1'; window.__app.route();`);
await sleep(1500);

const lessonAudit = await js(`
  (() => {
    const foot = document.querySelector('.lesson-foot');
    const footHint = document.querySelector('.foot-hint');
    const footHintCs = footHint ? getComputedStyle(footHint) : null;
    const checkBtn = document.querySelector('#action') || document.querySelector('#check-btn') || Array.from(document.querySelectorAll('.lesson-foot button')).find(b => b.textContent.toUpperCase().includes('CHECK'));
    const checkBtnCs = checkBtn ? getComputedStyle(checkBtn) : null;
    const enterChip = checkBtn ? checkBtn.querySelector('.kbd, .chip, kbd') : null;
    const textHasEnter = checkBtn ? checkBtn.textContent.includes('ENTER') : false;
    const footActions = document.querySelector('.foot-actions');
    const faCs = footActions ? getComputedStyle(footActions) : null;
    return {
      hintHidden: !footHint || footHintCs.display === 'none' || footHintCs.visibility === 'hidden',
      hintDisplay: footHintCs ? footHintCs.display : null,
      checkBtnFullWidth: checkBtn && foot ? (checkBtn.offsetWidth >= (foot.offsetWidth - 48) * 0.9) : false,
      checkBtnWidth: checkBtn ? checkBtn.offsetWidth : 0,
      footWidth: foot ? foot.offsetWidth : 0,
      hasEnterChip: !!enterChip || textHasEnter,
      checkBtnDisabled: checkBtn ? checkBtn.disabled : false,
      checkBtnColor: checkBtnCs ? checkBtnCs.color : null,
      checkBtnBg: checkBtnCs ? checkBtnCs.backgroundColor : null,
      checkBtnBorder: checkBtnCs ? checkBtnCs.border : null,
      checkBtnOpacity: checkBtnCs ? checkBtnCs.opacity : null,
      trackBg: (() => {
        const track = document.querySelector('.lesson-bar, .lesson-progress, .progress-bar, .track');
        return track ? getComputedStyle(track).backgroundColor : null;
      })(),
    };
  })()
`);

recordItem("Phase 1", "lesson_footer_hint", "Lesson keyboard hint hidden on mobile (< 600px)",
  lessonAudit.hintHidden,
  { hintDisplay: lessonAudit.hintDisplay }
);
recordItem("Phase 1", "lesson_check_full_width", "Lesson CHECK button full width on mobile",
  lessonAudit.checkBtnFullWidth,
  { checkBtnWidth: lessonAudit.checkBtnWidth, footWidth: lessonAudit.footWidth }
);
recordItem("Phase 1", "lesson_check_no_enter_chip", "CHECK button ENTER chip removed",
  !lessonAudit.hasEnterChip,
  { hasEnterChip: lessonAudit.hasEnterChip }
);
recordItem("Phase 1", "lesson_disabled_check_contrast", "Disabled CHECK button has solid border and readable ink contrast",
  lessonAudit.checkBtnOpacity === '1' && (lessonAudit.checkBtnColor?.includes('1a1a1a') || lessonAudit.checkBtnColor?.includes('22, 21, 29') || lessonAudit.checkBtnColor?.includes('rgba(26, 26, 26') || lessonAudit.checkBtnColor?.includes('rgba(22, 21, 29')),
  lessonAudit
);

// 2. Words list
await setViewport(1280, 800, false);
await js(`location.hash = '#/learn/words'; window.__app.route();`);
await sleep(1500);

const wordsAudit = await js(`
  (() => {
    const row = document.querySelector('.word-list li, .word-row, .words-table tr');
    const rowCs = row ? getComputedStyle(row) : null;
    const notYet = Array.from(document.querySelectorAll('.word-list .pill, .word-row .pill, .status-pill'))
      .filter(p => p.textContent.toLowerCase().includes('not yet'));
    const tabs = document.querySelector('.words-filter .segmented, .tabs, .filter-tabs');
    const activeTab = tabs ? tabs.querySelector('[aria-checked="true"]') : null;
    const inactiveTab = tabs ? tabs.querySelector('[aria-checked="false"]') : null;
    const activeCs = activeTab ? getComputedStyle(activeTab) : null;
    const inactiveCs = inactiveTab ? getComputedStyle(inactiveTab) : null;
    return {
      rowDisplay: rowCs ? rowCs.display : null,
      gridTemplate: rowCs ? rowCs.gridTemplateColumns : null,
      notYetCount: notYet.length,
      activeTabBg: activeCs ? activeCs.backgroundColor : null,
      activeTabColor: activeCs ? activeCs.color : null,
      inactiveTabBg: inactiveCs ? inactiveCs.backgroundColor : null,
      inactiveTabColor: inactiveCs ? inactiveCs.color : null,
    };
  })()
`);

recordItem("Phase 1", "words_columns_grid", "Words list columns aligned to CSS grid",
  wordsAudit.rowDisplay === 'grid' || wordsAudit.gridTemplate !== 'none',
  wordsAudit
);
recordItem("Phase 1", "words_filter_tabs_contrast", "Words list filter tabs readable segmented control",
  wordsAudit.activeTabColor && wordsAudit.inactiveTabColor && wordsAudit.activeTabColor !== wordsAudit.inactiveTabColor,
  wordsAudit
);
recordItem("Phase 2", "words_no_not_yet_pill", "Noisy 'not yet' status pills removed from words list",
  wordsAudit.notYetCount === 0,
  { notYetCount: wordsAudit.notYetCount }
);

// 3. Course page
await js(`location.hash = '#/course/1'; window.__app.route();`);
await sleep(1500);

const courseAudit = await js(`
  (() => {
    const deckRows = Array.from(document.querySelectorAll('.deck-row, .unit-card, .course-decks li, .unit-item'));
    const firstDeck = deckRows[0];
    const deckPaddingTop = firstDeck ? getComputedStyle(firstDeck).paddingTop : null;
    const pageTitle = document.getElementById('page-title');
    const topBarText = pageTitle ? pageTitle.textContent.trim() : '';
    const heading = document.querySelector('.course-hero h1, .course-head h1, .course-header h1, h1');
    const headingText = heading ? heading.textContent.trim() : '';
    return {
      deckCount: deckRows.length,
      deckPaddingTop,
      topBarText,
      headingText,
    };
  })()
`);

recordItem("Phase 1", "course_page_deck_padding", "Course deck list has vertical padding (>= 10px)",
  courseAudit.deckPaddingTop && parseInt(courseAudit.deckPaddingTop, 10) >= 10,
  courseAudit
);
recordItem("Phase 1", "course_page_topbar_title", "Course page top bar shows course title (not generic 'COURSES')",
  courseAudit.topBarText.length > 0 && !courseAudit.topBarText.toUpperCase().includes("COURSES"),
  courseAudit
);

console.log("\n--- Checking Phase 2: Consistency across the app ---");
// Check Button grammar across multiple routes
await js(`location.hash = '#/discover'; window.__app.route();`);
await sleep(1000);

const buttonAudit = await js(`
  (() => {
    const allButtons = Array.from(document.querySelectorAll('button, a.btn, a.pill-btn'));
    const filledYellow = [];
    const allCaps = [];
    for (const b of allButtons) {
      const txt = b.textContent.trim();
      const cs = getComputedStyle(b);
      const bg = cs.backgroundColor;
      // Filled yellow CTA check: rgb(244, 237, 54) or rgb(249, 204, 115)
      if (bg.includes('244, 237, 54') || bg.includes('249, 204, 115')) {
        filledYellow.push({ text: txt.slice(0, 30), bg });
      }
      if (txt.length > 3 && txt === txt.toUpperCase() && /[A-Z]/.test(txt) && !txt.includes('PAPERCARD') && !txt.includes('LT')) {
        allCaps.push(txt.slice(0, 30));
      }
    }
    const verified = document.querySelector('.verified, svg.verified, .icon-verified, [data-verified], .official svg');
    const vCs = verified ? getComputedStyle(verified) : null;
    const verifiedPath = verified ? verified.querySelector('path[fill]') : null;
    const verifiedFill = verifiedPath ? verifiedPath.getAttribute('fill') : null;

    // Check accent-color on inputs
    const cb = document.querySelector('input[type="checkbox"]');
    const radio = document.querySelector('input[type="radio"]');
    const cbAccent = cb ? getComputedStyle(cb).accentColor : null;
    const radioAccent = radio ? getComputedStyle(radio).accentColor : null;

    return {
      filledYellow,
      allCaps,
      verifiedFill,
      cbAccent,
      radioAccent
    };
  })()
`);

recordItem("Phase 2", "buttons_no_filled_yellow", "No filled yellow CTAs (DESIGN.md forbids filled yellow CTAs)",
  buttonAudit.filledYellow.length === 0,
  buttonAudit.filledYellow
);
recordItem("Phase 2", "buttons_sentence_case", "Buttons in sentence case (no ALL-CAPS CTA labels)",
  buttonAudit.allCaps.length === 0,
  buttonAudit.allCaps
);
recordItem("Phase 2", "verified_badge_not_blue", "Verified badge recoloured away from browser blue to yellow/ink",
  !buttonAudit.verifiedFill || (buttonAudit.verifiedFill !== '#3b82f6' && !buttonAudit.verifiedFill.includes('blue')),
  buttonAudit.verifiedFill
);
recordItem("Phase 2", "inputs_accent_color", "Native radio & checkboxes styled with ink accent-color",
  (buttonAudit.cbAccent?.includes('1a1a1a') || buttonAudit.cbAccent?.includes('22, 21, 29') || buttonAudit.cbAccent?.includes('26, 26, 26')) &&
  (buttonAudit.radioAccent?.includes('1a1a1a') || buttonAudit.radioAccent?.includes('22, 21, 29') || buttonAudit.radioAccent?.includes('26, 26, 26')),
  { cbAccent: buttonAudit.cbAccent, radioAccent: buttonAudit.radioAccent }
);

// Leaderboard toggle check
await js(`location.hash = '#/leaderboard'; window.__app.route();`);
await sleep(1500);

const lbAudit = await js(`
  (() => {
    const toggle = document.querySelector('.board-page .segmented, .timeframe-toggle');
    const active = toggle ? toggle.querySelector('[aria-selected="true"]') : null;
    const inactive = toggle ? toggle.querySelector('[aria-selected="false"]') : null;
    const aCs = active ? getComputedStyle(active) : null;
    const iCs = inactive ? getComputedStyle(inactive) : null;
    return {
      activeColor: aCs ? aCs.color : null,
      activeBg: aCs ? aCs.backgroundColor : null,
      inactiveColor: iCs ? iCs.color : null,
      inactiveBg: iCs ? iCs.backgroundColor : null,
    };
  })()
`);

recordItem("Phase 2", "leaderboard_toggle_contrast", "Leaderboard toggle selected cream-on-ink, unselected ink-on-cream",
  lbAudit.activeColor && lbAudit.inactiveColor && lbAudit.activeBg !== lbAudit.inactiveBg,
  lbAudit
);

console.log("\n--- Checking Phase 3: Page by Page Polish ---");
// Home
await js(`location.hash = '#/learn'; window.__app.route();`);
await sleep(1500);

const homeAudit = await js(`
  (() => {
    const enrolledCard = document.querySelector('.enrolled-course-card, .course-card.enrolled, .enrolled-card');
    const todayCard = document.querySelector('.dash-today-card, [data-card="today"], #dash-today-widget');
    const separateDaily = Array.from(document.querySelectorAll('.card h2, .card h3')).find(h => h.textContent.includes('Daily Progress'));
    const separateQuests = Array.from(document.querySelectorAll('.dash-side > details h3, .dash-side > .card h3')).find(h => h.textContent.trim() === 'Quests');
    const rankLink = Array.from(document.querySelectorAll('a, button, .rank-info')).find(el => el.textContent.includes('#') || el.textContent.includes('this week'));
    return {
      hasTodayCard: !!todayCard,
      separateDaily: !!separateDaily,
      separateQuests: !!separateQuests,
      rankLinkText: rankLink ? rankLink.textContent.trim() : null,
      enrolledCardFound: !!enrolledCard,
    };
  })()
`);

recordItem("Phase 3", "home_today_card_merged", "Home merged Daily Progress and Quests into Today card or unified widget",
  homeAudit.hasTodayCard && !homeAudit.separateDaily && !homeAudit.separateQuests,
  homeAudit
);

// Course path
await js(`location.hash = '#/learn/course/1'; window.__app.route();`);
await sleep(1500);

const pathAudit = await js(`
  (() => {
    const unitHeaders = Array.from(document.querySelectorAll('.unit-head, .unit-header, .module-head'));
    const firstHeader = unitHeaders[0];
    const aboutLink = Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.toLowerCase().includes('about course'));
    return {
      unitCount: unitHeaders.length,
      aboutLinkClass: aboutLink ? aboutLink.className : null,
    };
  })()
`);

recordItem("Phase 3", "course_path_about_link_quiet", "About course link is a quiet link (not yellow border button)",
  !pathAudit.aboutLinkClass || (!pathAudit.aboutLinkClass.includes('btn-yellow') && !pathAudit.aboutLinkClass.includes('secondary')),
  pathAudit
);

// Play Hub collapsed decks
await js(`location.hash = '#/play'; window.__app.route();`);
await sleep(1500);

const playAudit = await js(`
  (() => {
    const groups = Array.from(document.querySelectorAll('.level-group, details.deck-group, .deck-level, [data-level]'));
    const detailsCollapsed = Array.from(document.querySelectorAll('details.deck-group, details')).filter(d => !d.open);
    return {
      groupCount: groups.length,
      detailsCollapsedCount: detailsCollapsed.length,
      firstGroupText: groups[0] ? groups[0].textContent.slice(0, 40) : null
    };
  })()
`);

recordItem("Phase 3", "play_collapsed_decks", "Play hub deck picker collapses levels or uses compact summary",
  playAudit.groupCount > 0 || playAudit.detailsCollapsedCount > 0,
  playAudit
);

// Discover Mobile Filters
await setViewport(390, 844, true);
await js(`location.hash = '#/discover'; window.__app.route();`);
await sleep(1500);

const discoverAudit = await js(`
  (() => {
    const filterDetails = document.querySelector('details.filters, details#d-filters');
    const filterSummary = filterDetails ? filterDetails.querySelector('summary') : null;
    return {
      hasFilterDetails: !!filterDetails,
      isCollapsedByDefault: filterDetails ? !filterDetails.open : false,
      summaryText: filterSummary ? filterSummary.textContent.trim() : null
    };
  })()
`);

recordItem("Phase 3", "discover_mobile_filters", "Discover page collapses filters behind toggle/button on mobile",
  discoverAudit.hasFilterDetails && discoverAudit.isCollapsedByDefault,
  discoverAudit
);

// Profile avatar 56px on mobile
await js(`location.hash = '#/u/${myUsername}'; window.__app.route();`);
await sleep(1500);

const profileAudit = await js(`
  (() => {
    const av = document.querySelector('.profile-head .avatar, .profile-avatar, .avatar.big');
    const w = av ? av.offsetWidth : 0;
    const h = av ? av.offsetHeight : 0;
    const signout = Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.toLowerCase().includes('sign out'));
    const signoutCs = signout ? getComputedStyle(signout) : null;
    return {
      avatarWidth: w,
      avatarHeight: h,
      signoutColor: signoutCs ? signoutCs.color : null,
      signoutBg: signoutCs ? signoutCs.backgroundColor : null,
    };
  })()
`);

recordItem("Phase 3", "profile_avatar_mobile_56px", "Profile avatar sized to 56px on mobile (not 80px)",
  profileAudit.avatarWidth <= 64,
  profileAudit
);

// Review empty state unified
await js(`location.hash = '#/learn/review'; window.__app.route();`);
await sleep(2500);

const reviewAudit = await js(`
  (() => {
    const btns = Array.from(document.querySelectorAll('.empty-state-card a.btn, .empty-state-card button, .review-empty-stage a.btn, .review-empty-stage button'));
    return {
      actionButtonCount: btns.length,
      primaryBtnText: btns[0] ? btns[0].textContent.trim() : null
    };
  })()
`);

recordItem("Phase 3", "review_empty_state_single_button", "Review empty state unified with single primary action",
  reviewAudit.actionButtonCount === 1,
  reviewAudit
);

// Save report to disk
fs.writeFileSync("tests/full_audit_report.json", JSON.stringify(report, null, 2));

console.log("\n==========================================");
console.log(`AUDIT SUMMARY: ${report.summary.passed} PASSED, ${report.summary.failed} FAILED, ${report.summary.warnings} WARNINGS`);
console.log("==========================================");

process.exit(0);
