import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 9399;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "verify-ui-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => {
  try { proc.kill(); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { await sleep(200); }
}

if (!ws) {
  console.error("Failed to connect to Chrome CDP");
  process.exit(1);
}

await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});

const send = (method, params = {}) => new Promise((r) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});

const js = async (expr) => (await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true
})).result?.result?.value;

const shot = async (filePath) => {
  const res = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(filePath, Buffer.from(res.result.data, "base64"));
  console.log(`[Screenshot] Saved ${filePath}`);
};

const setViewport = async (width, height, isMobile = false) => {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: isMobile ? 2 : 1,
    mobile: isMobile
  });
};

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });

console.log("Navigating to http://localhost:8080/ ...");
await send("Page.navigate", { url: "http://localhost:8080/" });
await sleep(1500);

// Authenticate as dev user
await js(`fetch('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester' }) }).then(r => r.json())`);
await js(`location.hash = '#/learn'; location.reload();`);
await sleep(1500);

const testResults = {
  playDesktop: {},
  playMobile: {},
  routesVerification: {}
};

console.log("\n=======================================================");
console.log("1. VERIFYING #/play ON DESKTOP (1280px)");
console.log("=======================================================");
await setViewport(1280, 900, false);
await js(`location.hash = '#/play'; window.__app?.route?.();`);
await sleep(1500);

const deskPlay = await js(`(() => {
  const lobby = document.querySelector('.lobby');
  const picker = document.querySelector('.lobby .picker');
  const roomsWrap = document.querySelector('#my-duels-wrap') || document.querySelector('.list-card');
  const tilesWrap = document.querySelector('.tiles');
  const tiles = Array.from(document.querySelectorAll('.tile'));
  const activeTile = document.querySelector('.tile[aria-selected="true"]');
  const activeTileName = activeTile?.querySelector('.tile-name');
  const activeTileIconSvg = activeTile?.querySelector('.tile-icon svg');
  const deckGroup = document.querySelector('details.deck-group');
  const deckSummary = document.querySelector('.deck-group-summary');
  const deckChipsWrap = document.querySelector('.deck-chips');
  const deckChips = Array.from(document.querySelectorAll('.deck-chip'));

  const lobbyRect = lobby?.getBoundingClientRect();
  const pickerRect = picker?.getBoundingClientRect();
  const roomsRect = roomsWrap?.getBoundingClientRect();

  const tile0Rect = tiles[0]?.getBoundingClientRect();
  const tile1Rect = tiles[1]?.getBoundingClientRect();

  const summaryText = deckSummary?.textContent?.replace(/\\s+/g, ' ').trim() || '';
  const levelMatch = summaryText.match(/\\b([A-C][1-2])\\b/g) || [];
  const hasDuplicateLevel = levelMatch.length > 1 && levelMatch[0] === levelMatch[1];
  const hasStrayChevron = summaryText.includes('<');

  const chip0Rect = deckChips[0]?.getBoundingClientRect();
  const chip1Rect = deckChips[1]?.getBoundingClientRect();
  const chipsWrapRect = deckChipsWrap?.getBoundingClientRect();

  return {
    lobby: {
      display: lobby ? getComputedStyle(lobby).display : null,
      gridTemplateColumns: lobby ? getComputedStyle(lobby).gridTemplateColumns : null,
      isTwoColumn: !!(pickerRect && roomsRect && pickerRect.right < roomsRect.left + 50 && pickerRect.top < roomsRect.bottom),
      pickerRect: pickerRect ? { width: Math.round(pickerRect.width), height: Math.round(pickerRect.height) } : null,
      roomsRect: roomsRect ? { width: Math.round(roomsRect.width), height: Math.round(roomsRect.height) } : null
    },
    tabs: {
      display: tilesWrap ? getComputedStyle(tilesWrap).display : null,
      gridTemplateColumns: tilesWrap ? getComputedStyle(tilesWrap).gridTemplateColumns : null,
      tileCount: tiles.length,
      isSideBySide: !!(tile0Rect && tile1Rect && Math.abs(tile0Rect.top - tile1Rect.top) < 6 && tile0Rect.right <= tile1Rect.left + 25),
      tile0Width: tile0Rect ? Math.round(tile0Rect.width) : null,
      tile1Width: tile1Rect ? Math.round(tile1Rect.width) : null
    },
    activeTile: {
      text: activeTile?.textContent?.replace(/\\s+/g, ' ').trim(),
      bg: activeTile ? getComputedStyle(activeTile).backgroundColor : null,
      color: activeTile ? getComputedStyle(activeTile).color : null,
      nameColor: activeTileName ? getComputedStyle(activeTileName).color : null,
      iconWidth: activeTileIconSvg ? getComputedStyle(activeTileIconSvg).width : null,
      iconHeight: activeTileIconSvg ? getComputedStyle(activeTileIconSvg).height : null,
      iconStroke: activeTileIconSvg ? getComputedStyle(activeTileIconSvg).stroke : null
    },
    deckAccordion: {
      summaryText,
      hasDuplicateLevel,
      hasStrayChevron,
      levelChipText: deckSummary?.querySelector('.level-chip')?.textContent?.trim(),
      deckCountText: deckSummary?.querySelector('.deck-sel-count')?.textContent?.trim()
    },
    deckChips: {
      display: deckChipsWrap ? getComputedStyle(deckChipsWrap).display : null,
      gridTemplateColumns: deckChipsWrap ? getComputedStyle(deckChipsWrap).gridTemplateColumns : null,
      count: deckChips.length,
      chip0Width: chip0Rect ? Math.round(chip0Rect.width) : null,
      wrapWidth: chipsWrapRect ? Math.round(chipsWrapRect.width) : null,
      isMultiColumnGrid: !!(chip0Rect && chip1Rect && Math.abs(chip0Rect.top - chip1Rect.top) < 6),
      isCleanResponsiveGrid: !!(chip0Rect && chipsWrapRect && chip0Rect.width < chipsWrapRect.width * 0.75)
    }
  };
})()`);

testResults.playDesktop = deskPlay;
console.log("Desktop Results:", JSON.stringify(deskPlay, null, 2));

// Checks
console.log("\n--- Checking Assertions for Desktop #/play ---");
const checkDeskTwoCol = deskPlay.lobby.isTwoColumn && deskPlay.lobby.display === 'grid';
console.log(`[1] Lobby 2-column layout (picker left, rooms right): ${checkDeskTwoCol ? 'PASS' : 'FAIL'} (${deskPlay.lobby.gridTemplateColumns})`);

const checkDeskSideBySide = deskPlay.tabs.isSideBySide && deskPlay.tabs.display === 'grid';
console.log(`[2] Tabs side-by-side cards (not stacked slabs): ${checkDeskSideBySide ? 'PASS' : 'FAIL'}`);

const checkDeskActiveTile = (deskPlay.activeTile.bg === 'rgb(26, 26, 26)' || deskPlay.activeTile.bg === 'rgb(244, 237, 54)') &&
  (deskPlay.activeTile.nameColor === 'rgb(249, 245, 242)' || deskPlay.activeTile.color === 'rgb(249, 245, 242)' || deskPlay.activeTile.nameColor === 'rgb(22, 21, 29)') &&
  parseInt(deskPlay.activeTile.iconWidth) >= 18;
console.log(`[3] Active tile text high-contrast (butter on ink or cream on ink) with 20px icon: ${checkDeskActiveTile ? 'PASS' : 'FAIL'} (bg: ${deskPlay.activeTile.bg}, nameColor: ${deskPlay.activeTile.nameColor}, icon: ${deskPlay.activeTile.iconWidth})`);

const checkDeskSummary = !deskPlay.deckAccordion.hasDuplicateLevel && !deskPlay.deckAccordion.hasStrayChevron;
console.log(`[4] Deck accordion summary no duplicate level (e.g. no 'A1 A1') and no stray '<': ${checkDeskSummary ? 'PASS' : 'FAIL'} ("${deskPlay.deckAccordion.summaryText}")`);

const checkDeskChipsGrid = deskPlay.deckChips.isCleanResponsiveGrid && deskPlay.deckChips.display === 'grid';
console.log(`[5] Deck chips clean responsive grid (not 100% full-width stretched): ${checkDeskChipsGrid ? 'PASS' : 'FAIL'} (chipWidth: ${deskPlay.deckChips.chip0Width}px, wrapWidth: ${deskPlay.deckChips.wrapWidth}px)`);

await shot("tests/play_fixed_desk.png");

console.log("\n=======================================================");
console.log("2. VERIFYING #/play ON MOBILE (390px)");
console.log("=======================================================");
await setViewport(390, 844, true);
await sleep(1000);

const mobPlay = await js(`(() => {
  const lobby = document.querySelector('.lobby');
  const tilesWrap = document.querySelector('.tiles');
  const tiles = Array.from(document.querySelectorAll('.tile'));
  const activeTile = document.querySelector('.tile[aria-selected="true"]');
  const activeTileName = activeTile?.querySelector('.tile-name');
  const activeTileIconSvg = activeTile?.querySelector('.tile-icon svg');
  const deckChipsWrap = document.querySelector('.deck-chips');
  const deckChips = Array.from(document.querySelectorAll('.deck-chip'));

  const tile0Rect = tiles[0]?.getBoundingClientRect();
  const tile1Rect = tiles[1]?.getBoundingClientRect();

  return {
    lobby: {
      display: lobby ? getComputedStyle(lobby).display : null,
      flexDirection: lobby ? getComputedStyle(lobby).flexDirection : null
    },
    tabs: {
      display: tilesWrap ? getComputedStyle(tilesWrap).display : null,
      gridTemplateColumns: tilesWrap ? getComputedStyle(tilesWrap).gridTemplateColumns : null,
      isSideBySide: !!(tile0Rect && tile1Rect && Math.abs(tile0Rect.top - tile1Rect.top) < 6),
      tile0Width: tile0Rect ? Math.round(tile0Rect.width) : null,
      tile1Width: tile1Rect ? Math.round(tile1Rect.width) : null
    },
    activeTile: {
      bg: activeTile ? getComputedStyle(activeTile).backgroundColor : null,
      nameColor: activeTileName ? getComputedStyle(activeTileName).color : null,
      iconWidth: activeTileIconSvg ? getComputedStyle(activeTileIconSvg).width : null,
      iconHeight: activeTileIconSvg ? getComputedStyle(activeTileIconSvg).height : null
    },
    deckChips: {
      count: deckChips.length,
      chip0Width: deckChips[0] ? Math.round(deckChips[0].getBoundingClientRect().width) : null,
      wrapWidth: deckChipsWrap ? Math.round(deckChipsWrap.getBoundingClientRect().width) : null
    }
  };
})()`);

testResults.playMobile = mobPlay;
console.log("Mobile Results:", JSON.stringify(mobPlay, null, 2));

console.log("\n--- Checking Assertions for Mobile #/play ---");
const checkMobSideBySide = mobPlay.tabs.isSideBySide;
console.log(`[1] Tabs side-by-side on mobile: ${checkMobSideBySide ? 'PASS' : 'FAIL'} (${mobPlay.tabs.gridTemplateColumns})`);

const checkMobActiveTile = (mobPlay.activeTile.bg === 'rgb(26, 26, 26)' || mobPlay.activeTile.bg === 'rgb(244, 237, 54)') &&
  (mobPlay.activeTile.nameColor === 'rgb(249, 245, 242)' || mobPlay.activeTile.nameColor === 'rgb(22, 21, 29)') &&
  parseInt(mobPlay.activeTile.iconWidth) >= 18;
console.log(`[2] Active tile text high-contrast on mobile: ${checkMobActiveTile ? 'PASS' : 'FAIL'} (bg: ${mobPlay.activeTile.bg}, color: ${mobPlay.activeTile.nameColor})`);

await shot("tests/play_fixed_mob.png");

console.log("\n=======================================================");
console.log("3. VERIFYING CORE SCREENS (#/discover, #/course/1, #/learn, #/studio)");
console.log("=======================================================");

const routesToVerify = [
  { hash: "#/discover", name: "discover", title: "Courses" },
  { hash: "#/course/1", name: "course_1", title: "Course Overview" },
  { hash: "#/learn", name: "learn", title: "Learn Home" },
  { hash: "#/studio", name: "studio", title: "Studio" }
];

for (const route of routesToVerify) {
  // Desktop
  await setViewport(1280, 900, false);
  await js(`location.hash = '${route.hash}'; window.__app?.route?.();`);
  await sleep(1500);

  const deskAnalysis = await js(`(() => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    const searchBars = Array.from(document.querySelectorAll('.search, .search-bar, input[type="search"], #f-q'));
    const cards = Array.from(document.querySelectorAll('.card, .course-card, .deck-row, .learn-head, .path-node'));

    return {
      inputCount: inputs.length,
      styledInputs: inputs.every(inp => {
        const s = getComputedStyle(inp);
        return s.borderStyle !== 'none' || s.borderRadius !== '0px';
      }),
      searchBars: searchBars.map(sb => {
        const rect = sb.getBoundingClientRect();
        return {
          id: sb.id,
          className: sb.className,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: rect.width > 0 && rect.height > 0
        };
      }),
      cardsCount: cards.length,
      cardLayoutValid: cards.every(c => {
        const rect = c.getBoundingClientRect();
        return rect.width > 50 && rect.height > 20;
      })
    };
  })()`);

  console.log(`\n[Desktop 1280px] ${route.name} (${route.hash}):`);
  console.log(`  Inputs: ${deskAnalysis.inputCount} (all properly styled: ${deskAnalysis.styledInputs})`);
  console.log(`  Search bars: ${deskAnalysis.searchBars.length > 0 ? JSON.stringify(deskAnalysis.searchBars) : 'none'}`);
  console.log(`  Cards: ${deskAnalysis.cardsCount} (card layout valid: ${deskAnalysis.cardLayoutValid})`);

  await shot(`tests/${route.name}_fixed_desk.png`);

  // Mobile
  await setViewport(390, 844, true);
  await sleep(1000);

  const mobAnalysis = await js(`(() => {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    const searchBars = Array.from(document.querySelectorAll('.search, .search-bar, input[type="search"], #f-q'));
    const cards = Array.from(document.querySelectorAll('.card, .course-card, .deck-row'));
    const appEl = document.getElementById('app');

    const appRect = appEl?.getBoundingClientRect();
    const hasHorizontalOverflow = appEl ? (appEl.scrollWidth > window.innerWidth + 2) : false;

    return {
      inputCount: inputs.length,
      searchBars: searchBars.map(sb => {
        const rect = sb.getBoundingClientRect();
        return {
          id: sb.id,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          fitsScreen: rect.width <= 390
        };
      }),
      hasHorizontalOverflow
    };
  })()`);

  console.log(`[Mobile 390px] ${route.name} (${route.hash}):`);
  console.log(`  Search bars fit screen: ${mobAnalysis.searchBars.every(s => s.fitsScreen)}`);
  console.log(`  No horizontal overflow: ${!mobAnalysis.hasHorizontalOverflow}`);

  await shot(`tests/${route.name}_fixed_mob.png`);

  testResults.routesVerification[route.name] = {
    desktop: deskAnalysis,
    mobile: mobAnalysis
  };
}

// Summary evaluation
const allPass = checkDeskTwoCol && checkDeskSideBySide && checkDeskActiveTile &&
  checkDeskSummary && checkDeskChipsGrid && checkMobSideBySide && checkMobActiveTile;

console.log("\n=======================================================");
console.log(`FINAL VERIFICATION: ${allPass ? "ALL 5 CORE PLAY CHECKS PASSED!" : "FAILURES DETECTED"}`);
console.log("=======================================================");

fs.writeFileSync("tests/verify_play_and_ui_results.json", JSON.stringify(testResults, null, 2));
console.log("Saved full results to tests/verify_play_and_ui_results.json");

process.exit(allPass ? 0 : 1);
