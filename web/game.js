// Labas front end: learn words in any language in short lessons; courses come from the official account and from learners.
// Signed out: a landing page with Google sign-in. Signed in: Learn (your current course's path, review, word list),
// Discover (courses by us and by learners; follow creators), Play (word duels), the leaderboard, the Studio (make
// your own course) and, for admins, course moderation.
// Routes: #/ (landing), #/learn, #/learn/lesson/ID, #/learn/review, #/learn/words, #/discover, #/course/ID,
// #/u/USERNAME, #/studio, #/studio/ID, #/play, #/duel/CODE, #/leaderboard, #/admin. No frameworks.

const $app = document.getElementById("app");
const $account = document.getElementById("account");
let me = null;
let config = { googleClientId: null, devLogin: false };
let pollTimer = null;
let clockTimer = null;

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtDate = (ms) => new Date(ms || Date.now()).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtMinutes = (ms) => `${Math.max(1, Math.ceil(ms / 60000))} min`;
/** "in 3 days", "in 5 hours", "now" */
const fmtUntil = (at, now = Date.now()) => {
  const ms = at - now;
  if (ms <= 0) return "now";
  const h = Math.round(ms / 3600000);
  if (h < 1) return `in ${fmtMinutes(ms)}`;
  if (h < 36) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(ms / 86400000);
  return `in ${d} day${d === 1 ? "" : "s"}`;
};

function avatar(user) {
  const initial = esc((user?.name ?? "?").trim().charAt(0).toUpperCase());
  return user?.picture
    ? `<span class="avatar"><img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer"></span>`
    : `<span class="avatar" aria-hidden="true">${initial}</span>`;
}

function stopTimers() {
  clearInterval(pollTimer);
  clearInterval(clockTimer);
  pollTimer = clockTimer = null;
}

const duelCodeFromHash = () => /^#\/duel\/([A-Za-z0-9]{6})$/.exec(location.hash)?.[1]?.toUpperCase() ?? null;
const shareLink = (code) => `${location.origin}${location.pathname}#/duel/${code}`;

function errorCard(message, back = ["#/learn", "Back to Learn"]) {
  return `<section class="card picker"><header class="picker-head"><h2>Hmm.</h2><p class="muted">${esc(message)}</p></header><div class="row" style="justify-content:center"><a class="btn" href="${back[0]}">${back[1]}</a></div></section>`;
}

// ---------------------------------------------------------------- the course: levels, parts of speech, letters

const LEVELS = {
  A1: ["Absolute beginner", "Campus survival"],
  A2: ["Elementary", "Practical independence"],
  B1: ["Intermediate", "Fluency bridge"],
  B2: ["Upper intermediate", "Confident everyday conversation"],
};
const GENDERS = { m: "masc.", f: "fem.", mpl: "masc. pl.", fpl: "fem. pl." };
const POS_LABELS = { noun: "noun", verb: "verb", phrase: "phrase", other: "word" };
/** The course being played or edited: its language, language code and special letters. */
let course = null;
const letters = (c = course) => (c?.letters ?? "").split(/\s+/).filter(Boolean);
const L = (c = course) => (c?.toCode ? ` lang="${esc(c.toCode)}"` : "");
const toLang = (c = course) => c?.toLang || "the language";
const lettersHtml = (c = course, title = "Shift-click for capital") =>
  letters(c).length ? `<div class="lt-keys" role="group" aria-label="${esc(toLang(c))} letters">${letters(c).map((l) => `<button type="button" class="lt-key" data-ch="${esc(l)}" title="${title}">${esc(l)}</button>`).join("")}</div>` : "";

/** "noun · fem." */
const wordTag = (w) => `<span class="wtag">${esc(POS_LABELS[w.pos] ?? w.pos ?? "")}${GENDERS[w.gender] ? ` · ${GENDERS[w.gender]}` : ""}</span>`;
const levelChip = (level) => (level ? `<span class="level-chip">${esc(level)}</span>` : "");

// ---------------------------------------------------------------- icons (inline SVG, gradients defined in index.html)

const I = {
  join: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="10" width="40" height="40" rx="3" fill="url(#gGreen)"/><rect x="32" y="30" width="40" height="40" rx="3" fill="url(#gNavy)"/><text x="22" y="37" font-size="18" font-weight="800" text-anchor="middle" fill="#2c3860" font-family="Mulish,sans-serif">A</text><text x="52" y="58" font-size="18" font-weight="800" text-anchor="middle" fill="#fff" font-family="Mulish,sans-serif">B</text></svg>`,
  share: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="16" width="44" height="44" rx="4" fill="url(#gNavy)"/><rect x="28" y="28" width="44" height="40" rx="4" fill="url(#gGreen)"/><path d="M38 48h18m-6-6 6 6-6 6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  decks: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="10" y="22" width="34" height="46" rx="4" fill="url(#gNavy)"/><rect x="22" y="16" width="34" height="46" rx="4" fill="url(#gGreen)"/><rect x="34" y="10" width="34" height="46" rx="4" fill="url(#gNavy)"/><text x="51" y="40" font-size="17" font-weight="800" text-anchor="middle" fill="#fff" font-family="Mulish,sans-serif">A1</text></svg>`,
  answer: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="10" width="64" height="60" rx="4" fill="url(#gGreen)"/><rect x="16" y="20" width="48" height="10" rx="3" fill="#fff"/><rect x="16" y="36" width="48" height="10" rx="3" fill="url(#gNavy)"/><rect x="16" y="52" width="48" height="10" rx="3" fill="#fff"/><path d="M22 41l3 3 5-6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cards: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="12" y="18" width="38" height="50" rx="5" fill="url(#gNavy)" transform="rotate(-9 31 43)"/><rect x="28" y="12" width="38" height="50" rx="5" fill="url(#gGreen)"/><text x="47" y="45" font-size="24" font-weight="800" text-anchor="middle" fill="#fff" font-family="Mulish,sans-serif">Ą</text></svg>`,
  check: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="4" fill="var(--green)"/><path d="M5.5 10.5l3 3 6-7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ok: `<svg viewBox="0 0 20 20" class="mark-ok" aria-label="right"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  miss: `<svg viewBox="0 0 20 20" class="mark-miss" aria-label="wrong"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  back: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  copy: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M13 4H5a1 1 0 0 0-1 1v8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  send: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10 17 3l-4 14-3-6z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>`,
  trophy: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3h8v4a4 4 0 0 1-8 0zM6 5H3a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3M10 11v4m-3 2h6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  learn: `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M10 18c10-4 20-4 30 2v46c-10-6-20-6-30-2z" fill="url(#gGreen)"/><path d="M70 18c-10-4-20-4-30 2v46c10-6 20-6 30-2z" fill="url(#gNavy)"/><path d="M18 30q4-3 8 0t8 0M18 40h14M48 30h14M48 40h14M48 50h10" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`,
  room: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="8" width="28" height="28" rx="3" fill="url(#gGreen)"/><rect x="44" y="8" width="28" height="28" rx="3" fill="url(#gNavy)"/><rect x="8" y="44" width="28" height="28" rx="3" fill="url(#gNavy)"/><rect x="44" y="44" width="28" height="28" rx="3" fill="url(#gGreen)"/><path d="M58 52v12M52 58h12" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.1 5 2.9 1.4-1.8 2.9-2.9 5-2.9 3.8 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z" fill="#ff4b62"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 5.5 5 10.5A5 5 0 0 1 7 13c0-2 1-3.5 2-4.5.3 1.7 1.2 2.7 2.2 3C10.6 8.5 11 5 12 2z" fill="#ff9a1f"/><path d="M12 13c.6 1.6 2 2.2 2 4a2 2 0 0 1-4 0c0-1 .5-1.6 1-2 .1.8.5 1.2 1 1.3-.2-1.3-.3-2.3 0-3.3z" fill="#ffd56b"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7z" fill="#ffc21a"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z" fill="currentColor"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="2.2" fill="none"/></svg>`,
  tick: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  cup: `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M24 12h32v18a16 16 0 0 1-32 0z" fill="url(#gGreen)"/><path d="M24 18H14a10 10 0 0 0 10 12M56 18h10a10 10 0 0 1-10 12" stroke="url(#gNavy)" stroke-width="5" fill="none"/><rect x="36" y="44" width="8" height="12" fill="url(#gNavy)"/><rect x="26" y="56" width="28" height="10" rx="3" fill="url(#gNavy)"/><path d="m40 19 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff"/></svg>`,
  edit: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>`,
  trash: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12l5-5 5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  plus: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  chat: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h13v9H9l-4 3v-3H3.5z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M7 8.2h6M7 10.8h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  refresh: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  list: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="3.5" cy="5" r="1.2" fill="currentColor"/><circle cx="3.5" cy="10" r="1.2" fill="currentColor"/><circle cx="3.5" cy="15" r="1.2" fill="currentColor"/></svg>`,
};

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (loadGoogleScript.p ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your connection or ad blocker."));
    document.head.append(s);
  }));
}

async function mountGoogleButton(err) {
  try {
    await loadGoogleScript();
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async ({ credential }) => {
        try {
          ({ user: me } = await api("/auth/google", { method: "POST", body: { credential } }));
          afterSignIn();
        } catch (x) {
          err(x.message);
        }
      },
    });
    const slot = document.getElementById("gsi");
    if (!slot) return;
    google.accounts.id.renderButton(slot, { theme: isDark() ? "filled_black" : "outline", size: "large", shape: "rectangular", text: "signin_with", width: 260 });
  } catch (x) {
    err(x.message);
  }
}

/** Tiny generated sound effects (no audio files). */
const sfx = (() => {
  let ctx = null;
  const tone = (freq, at, dur, type = "sine", gain = 0.12) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at);
    o.stop(ctx.currentTime + at + dur);
  };
  const play = (notes) => {
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      notes.forEach((n) => tone(...n));
    } catch {}
  };
  return {
    right: () => play([[660, 0, 0.12], [880, 0.1, 0.18]]),
    wrong: () => play([[220, 0, 0.18, "triangle"], [180, 0.12, 0.22, "triangle"]]),
    done: () => play([[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1046, 0.36, 0.3]]),
  };
})();

// ---------------------------------------------------------------- word duels

async function renderDuel(code) {
  $app.innerHTML = `<p class="muted loading">Loading duel ${esc(code)}…</p>`;
  let duel;
  try {
    duel = await api(`/duels/${code}`);
  } catch (x) {
    $app.innerHTML = errorCard(x.message, ["#/play", "Back to Play"]);
    return;
  }
  course = duel.course;
  if (duel.you.submitted) renderResults(duel);
  else renderDuelPlay(duel);
}

function wireCopy() {
  for (const b of $app.querySelectorAll("[data-copy]")) {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast("Invite link copied");
      } catch {
        prompt("Copy this link:", b.dataset.copy);
      }
    };
  }
}

/** The question heading and the word to translate, for any exercise kind. */
function promptHtml(c) {
  const lt = c.kind === "pick_en";
  const head = { pick_en: "What does this mean?", pick_lt: `How do you say this in ${esc(toLang())}?`, type_lt: `Write this in ${esc(toLang())}`, build: `Translate this into ${esc(toLang())}` }[c.kind];
  return `<h1 class="q">${head}</h1>
    <div class="prompt-card"><span class="prompt-word"${lt ? L() : ""}>${esc(c.prompt)}</span>${c.pos && c.pos !== "phrase" ? wordTag(c) : ""}</div>`;
}

function optionsHtml(c, picked) {
  return `<div class="options">${c.options
    .map((o, i) => `<button class="option" data-id="${o.id}" aria-pressed="${o.id === picked}"${c.kind === "pick_lt" ? L() : ""}><span class="key">${i + 1}</span><span>${esc(o.text)}</span></button>`)
    .join("")}</div>`;
}

function renderDuelPlay(duel) {
  const started = Date.now();
  const draftKey = `labas-duel-${duel.code}`;
  let answers = Array(duel.count).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    if (Array.isArray(saved) && saved.length === duel.count) answers = saved;
  } catch {}
  let at = answers.indexOf(null);
  if (at < 0) at = duel.count - 1;

  $app.innerHTML = `
    <div class="toolbar">
      <a class="back" href="#/play">${I.back} Play</a>
      <div class="toolbar-actions">
        <button class="btn outline" data-copy="${esc(shareLink(duel.code))}">${I.copy} Invite link</button>
        <button class="btn" id="submit">${I.send} Submit answers</button>
      </div>
    </div>
    <div class="workspace two">
      <aside class="card side">
        <section><h3>Duel</h3><div class="row"><span class="code-chip">${esc(duel.code)}</span></div><p class="muted small">${esc(duel.title)} · set by ${esc(duel.creator.name)}</p></section>
        <section><h3>Answered</h3><p class="big-num"><b id="answered">0</b> <small>of ${duel.count}</small></p><div class="bar"><i id="answered-bar"></i></div></section>
        <section><h3>Time</h3><p class="timer" id="clock" title="Time since you first opened this duel">0:00</p></section>
        <section><h3>Scoring</h3><ul class="checks"><li>${I.check} +10 per right answer</li><li>${I.check} One try; answers are revealed at the end</li><li>${I.check} Ties go to the faster player</li></ul></section>
        <section><h3>Players (${duel.players.length})</h3>${
          duel.players.length
            ? `<ul class="people">${duel.players.map((p) => `<li>${avatar(p)}<span>${esc(p.name)}</span><span class="played">played</span></li>`).join("")}</ul>`
            : `<p class="muted small">Nobody has played yet. Be the first, then send the link.</p>`
        }</section>
      </aside>
      <div class="sheet-wrap">
        <div class="sheet duel-sheet">
          <div class="sheet-head"><span><b>Name :</b> ${esc(me.name)}</span><span><b>Date :</b> ${fmtDate(duel.createdAt)}</span></div>
          <nav class="qdots" id="qdots" aria-label="Questions"></nav>
          <div class="duel-q" id="qcard"></div>
          <div class="row spread"><button class="btn outline" id="prev">${I.back} Previous</button><button class="btn" id="next">Next ${I.arrow}</button></div>
          <p id="submit-error" class="error" hidden></p>
        </div>
      </div>
    </div>`;
  wireCopy();

  const save = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(answers));
    } catch {}
  };
  const draw = () => {
    const q = duel.questions[at];
    const done = answers.filter((a) => a != null).length;
    document.getElementById("answered").textContent = done;
    document.getElementById("answered-bar").style.width = `${(100 * done) / duel.count}%`;
    document.getElementById("qdots").innerHTML = duel.questions
      .map((_, i) => `<button class="qdot ${answers[i] != null ? "done" : ""} ${i === at ? "at" : ""}" data-q="${i}" aria-label="Question ${i + 1}${answers[i] != null ? " (answered)" : ""}">${i + 1}</button>`)
      .join("");
    document.getElementById("qcard").innerHTML = `<p class="muted small">Question ${at + 1} of ${duel.count}</p>${promptHtml(q)}${optionsHtml(q, answers[at])}`;
    document.getElementById("prev").disabled = at === 0;
    document.getElementById("next").hidden = at === duel.count - 1;
    for (const b of $app.querySelectorAll("[data-q]")) b.onclick = () => ((at = Number(b.dataset.q)), draw());
    for (const b of $app.querySelectorAll("#qcard .option")) {
      b.onclick = () => {
        answers[at] = Number(b.dataset.id);
        save();
        const next = answers.indexOf(null, at + 1) >= 0 ? answers.indexOf(null, at + 1) : answers.indexOf(null);
        draw();
        if (next >= 0) setTimeout(() => ((at = next), draw()), 260);
      };
    }
  };
  document.getElementById("prev").onclick = () => ((at = Math.max(0, at - 1)), draw());
  document.getElementById("next").onclick = () => ((at = Math.min(duel.count - 1, at + 1)), draw());
  draw();

  // The server keeps the real clock; this one is only a guide.
  const clock = document.getElementById("clock");
  clockTimer = setInterval(() => (clock.textContent = fmtTime(Date.now() - started)), 1000);

  const onKey = (e) => {
    if (!document.getElementById("qcard")) return removeEventListener("keydown", onKey);
    if (/^[1-9]$/.test(e.key)) $app.querySelectorAll("#qcard .option")[Number(e.key) - 1]?.click();
  };
  addEventListener("keydown", onKey);

  document.getElementById("submit").onclick = async (e) => {
    const left = answers.filter((a) => a == null).length;
    if (left && !confirm(`You haven't answered ${left} question${left > 1 ? "s" : ""}. Submit anyway?`)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api(`/duels/${duel.code}/submit`, { method: "POST", body: { answers } });
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      stopTimers();
      sfx.done();
      renderResults(result, true);
    } catch (x) {
      const errEl = document.getElementById("submit-error");
      errEl.textContent = x.message;
      errEl.hidden = false;
      btn.disabled = false;
      if (x.status === 409) renderDuel(duel.code);
    }
  };
}

function renderResults(duel, justSubmitted = false) {
  const others = duel.players.filter((p) => !p.isYou);
  const youWon = duel.winner && duel.players[0]?.isYou;
  const verdict = !duel.winner
    ? `<p class="muted small">Waiting for a friend to play. Send them the invite link!</p>`
    : duel.tie
      ? `<div class="winner tie">${I.trophy} It's a tie!</div>`
      : `<div class="winner">${I.trophy} ${youWon ? "You win!" : `${esc(duel.winner)} wins!`}</div>`;

  $app.innerHTML = `
    <div class="toolbar">
      <a class="back" href="#/play">${I.back} Play</a>
      <div class="toolbar-actions">
        <button class="btn outline" data-copy="${esc(shareLink(duel.code))}">${I.copy} Invite link</button>
        <a class="btn" href="#/play">New room ${I.arrow}</a>
      </div>
    </div>
    <div class="workspace two">
      <aside class="card side">
        <section><h3>${justSubmitted ? "Your score" : "Your result"}</h3><p class="score"><b>${duel.you.points}</b><span class="muted">/ ${duel.maxPoints} points</span></p></section>
        <section><ul class="kv">
          <li><span>Right</span><b class="good">${duel.you.correct}/${duel.count}</b></li>
          <li><span>Wrong</span><b class="${duel.count - duel.you.correct ? "bad" : ""}">${duel.count - duel.you.correct}</b></li>
          <li><span>Time</span><b>${fmtTime(duel.you.elapsedMs)}</b></li>
        </ul></section>
        <section><h3>Scoreboard</h3>${verdict}
          <ul class="people">${duel.players
            .map(
              (p) => `<li class="${p.isYou ? "you" : ""}"><span class="muted small">#${p.rank}</span>${avatar(p)}<span>${esc(p.name)}${p.isYou ? " (you)" : ""}<br><span class="muted small">${p.correct}/${duel.count} right · ${fmtTime(p.elapsedMs)}</span></span><span class="pts">${p.points}</span></li>`,
            )
            .join("")}</ul>
          ${others.length ? "" : `<button class="btn dashed block" data-copy="${esc(shareLink(duel.code))}">${I.copy} Copy invite link</button>`}
        </section>
      </aside>
      <section class="card list-card">
        <div class="list-head"><h3>Answer key · ${esc(duel.title)}</h3><span class="muted small">${duel.you.correct} of ${duel.count} right</span></div>
        <ul class="rows">${duel.key
          .map(
            (k) => `<li class="answer">${k.right ? I.ok : I.miss}<div><span class="found"${k.kind === "pick_en" ? L() : ""}>${esc(k.prompt)}</span> → <b${k.kind === "pick_lt" ? L() : ""}>${esc(k.answer)}</b>
              ${k.right ? "" : `<p class="muted small">You said: ${k.yours != null ? esc(k.yours) : "(no answer)"}</p>`}</div>
              <span class="tag ${k.right ? "ok" : "miss"}">${k.right ? "right" : "wrong"}</span></li>`,
          )
          .join("")}</ul>
      </section>
    </div>`;
  wireCopy();

  // Watch for friends finishing.
  if (!pollTimer) {
    let seen = duel.players.length;
    pollTimer = setInterval(async () => {
      if (duelCodeFromHash() !== duel.code || document.hidden) return;
      try {
        const fresh = await api(`/duels/${duel.code}`);
        if (fresh.players.length !== seen) {
          seen = fresh.players.length;
          toast("Someone just finished!");
          renderResults(fresh);
        }
      } catch {}
    }, 5000);
  }
}

// ---------------------------------------------------------------- top bar

const page = () => {
  const h = location.hash;
  if (h.startsWith("#/learn/review")) return "review";
  if (h.startsWith("#/learn")) return "learn";
  if (h.startsWith("#/leaderboard")) return "leaderboard";
  if (h.startsWith("#/admin")) return "admin";
  if (h.startsWith("#/discover") || h.startsWith("#/course/")) return "discover";
  if (h.startsWith("#/studio")) return "studio";
  if (h.startsWith("#/u/")) return "profile";
  if (h.startsWith("#/play") || duelCodeFromHash()) return "play";
  return "home";
};

/** Line icons for the sidebar and widgets (20×20, drawn in currentColor). */
const icon = (d) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: icon(`<path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z"/>`),
  review: icon(`<rect x="3" y="5.5" width="10.5" height="11.5" rx="2"/><path d="M7 3h7.5A2.5 2.5 0 0 1 17 5.5v8.5"/>`),
  courses: icon(`<circle cx="10" cy="10" r="7"/><path d="m8.5 7.3 4 2.7-4 2.7z"/>`),
  play: icon(`<path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10z"/>`),
  trophy: icon(`<path d="M6 3.5h8v4a4 4 0 0 1-8 0zM6 5H3.5a2.5 2.5 0 0 0 2.6 3M14 5h2.5a2.5 2.5 0 0 1-2.6 3M10 11.5V15m-3 2h6"/>`),
  studio: icon(`<path d="M3.5 16.5h3l9-9-3-3-9 9z"/><path d="m11 5.5 3 3"/>`),
  admin: icon(`<path d="M10 2.5 16 5v4.5c0 3.6-2.6 6.4-6 8-3.4-1.6-6-4.4-6-8V5z"/>`),
  logout: icon(`<path d="M8 4H4.5v12H8M12 6.5 15.5 10 12 13.5M15.5 10H8"/>`),
  chev: icon(`<path d="m5 7.5 5 5 5-5"/>`),
  lock: icon(`<rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>`),
  plus: icon(`<path d="M10 4v12M4 10h12"/>`),
};

const NAV = [
  ["learn", "#/learn", "Home", "home"],
  ["review", "#/learn/review", "Review", "review"],
  ["discover", "#/discover", "Courses", "courses"],
  ["play", "#/play", "Play", "play"],
  ["leaderboard", "#/leaderboard", "Leaders", "trophy"],
  ["studio", "#/studio", "Studio", "studio"],
];
const TITLES = { learn: "Home", review: "Review", discover: "Courses", play: "Play", leaderboard: "Leaderboard", studio: "Studio", admin: "Admin", profile: "Profile", home: "Home" };

/** The streak and hearts shown in the top bar, and the review count on the sidebar (from the latest stats). */
let topStats = null;
function setTopStats(stats) {
  if (stats) topStats = stats;
  const chips = document.getElementById("top-chips");
  if (!me || !topStats || !chips) return;
  chips.innerHTML = `<span class="top-chip" title="Day streak">${I.fire}${topStats.streak} day${topStats.streak === 1 ? "" : "s"}</span><span class="top-chip" title="Hearts">${I.heart}${topStats.hearts}</span>`;
  const review = document.querySelector('.side-links a[data-nav="review"]');
  if (review) {
    review.querySelector(".badge-dot")?.remove();
    if (topStats.due) review.insertAdjacentHTML("beforeend", `<span class="badge-dot" aria-label="${topStats.due} due">${topStats.due > 99 ? "99+" : topStats.due}</span>`);
  }
}
const refreshTopStats = () =>
  api("/learn")
    .then((d) => setTopStats(d.stats))
    .catch(() => {});

const MASCOT_SVG = `
<svg class="poster-mascot" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Flying Papers Mascot">
  <!-- Body (Bone White Cream fill, 3.5px Pure Black outline) -->
  <path d="M50 140 C50 80, 80 40, 120 40 C160 40, 190 80, 190 140 C190 185, 165 210, 120 210 C75 210, 50 185, 50 140 Z" fill="#f9f5f2" stroke="#000000" stroke-width="3.5" stroke-linejoin="round"/>
  <!-- Belly patch / Riso texture accent -->
  <path d="M75 145 C75 110, 95 85, 120 85 C145 85, 165 110, 165 145 C165 175, 145 195, 120 195 C95 195, 75 175, 75 145 Z" fill="#f4ed36" stroke="#000000" stroke-width="3" stroke-linejoin="round"/>
  <!-- Hi-Vis Cap / Hat on top -->
  <path d="M85 45 C85 25, 110 20, 120 20 C130 20, 155 25, 155 45 Z" fill="#f4ed36" stroke="#000000" stroke-width="3.5"/>
  <path d="M80 45 L175 42 C185 42, 185 48, 175 50 L80 50 Z" fill="#000000" stroke="#000000" stroke-width="2"/>
  <!-- Cartoon Big Eyes -->
  <ellipse cx="102" cy="100" rx="16" ry="20" fill="#f9f5f2" stroke="#000000" stroke-width="3"/>
  <ellipse cx="138" cy="100" rx="16" ry="20" fill="#f9f5f2" stroke="#000000" stroke-width="3"/>
  <!-- Mischievous Ink Pupils looking sideways -->
  <ellipse cx="108" cy="102" rx="7" ry="10" fill="#000000"/>
  <ellipse cx="144" cy="102" rx="7" ry="10" fill="#000000"/>
  <circle cx="106" cy="98" r="2.5" fill="#f9f5f2"/>
  <circle cx="142" cy="98" r="2.5" fill="#f9f5f2"/>
  <!-- Cheeky Cartoon Smile with Tongue -->
  <path d="M105 130 Q120 145 135 130" stroke="#000000" stroke-width="3.5" stroke-linecap="round" fill="none"/>
  <path d="M112 135 Q120 148 128 135" fill="#f8c1ba" stroke="#000000" stroke-width="2.5"/>
  <!-- Flying Paper sheet held in wing/hand -->
  <path d="M175 110 L215 95 L225 140 L185 155 Z" fill="#f9f5f2" stroke="#000000" stroke-width="3.5" stroke-linejoin="round"/>
  <line x1="185" y1="118" x2="210" y2="108" stroke="#000000" stroke-width="2"/>
  <line x1="188" y1="128" x2="215" y2="118" stroke="#000000" stroke-width="2"/>
  <line x1="192" y1="138" x2="218" y2="128" stroke="#000000" stroke-width="2"/>
  <!-- Hand grasping the paper -->
  <ellipse cx="178" cy="132" rx="8" ry="12" fill="#f4ed36" stroke="#000000" stroke-width="3"/>
  <!-- Left hand resting on hip -->
  <path d="M60 135 Q40 145 55 165" stroke="#000000" stroke-width="3.5" fill="#f4ed36" stroke-linejoin="round"/>
  <!-- Cartoon Shoes / Feet -->
  <path d="M90 205 L80 225 L105 225 L105 208 Z" fill="#f4ed36" stroke="#000000" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M135 205 L135 225 L160 225 L150 205 Z" fill="#f4ed36" stroke="#000000" stroke-width="3.5" stroke-linejoin="round"/>
</svg>`;

function renderNav() {
  const signedIn = !!me;
  document.body.classList.toggle("shell", signedIn);
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.hidden = !signedIn;
  const themeBtn = document.getElementById("theme");
  if (!signedIn) {
    if (themeBtn) document.querySelector(".nav-inner")?.append(themeBtn);
    const pt = document.getElementById("page-title");
    if (pt) pt.textContent = "";
    const tc = document.getElementById("top-chips");
    if (tc) tc.innerHTML = "";
    $account.innerHTML = `<a class="btn-outlined-display small" href="#signin" id="nav-signin">SIGN IN</a>`;
    document.getElementById("nav-signin").onclick = (e) => {
      e.preventDefault();
      const drawer = document.getElementById("signin-drawer");
      if (drawer) {
        drawer.hidden = false;
        drawer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    return;
  }
  const items = me.isAdmin ? [...NAV, ["admin", "#/admin", "Admin", "admin"]] : NAV;
  if (sidebar) {
    document.getElementById("side-links").innerHTML = items
      .map(([key, href, label, ic]) => `<a href="${href}" class="side-pill" data-nav="${key}"${page() === key ? ' aria-current="page"' : ""}>${ICON[ic]}<span>${label}</span></a>`)
      .join("");
    const bottom = document.getElementById("side-bottom");
    bottom.innerHTML = `<button class="btn-gate-pill small" id="logout" title="Sign out" aria-label="Sign out">SIGN OUT</button>`;
    if (themeBtn) bottom.prepend(themeBtn);
  }
  const topLinks = document.querySelector(".links");
  if (topLinks) {
    topLinks.innerHTML = items
      .map(([key, href, label]) => `<a href="${href}" class="nav-pill" data-nav="${key}"${page() === key ? ' aria-current="page"' : ""}>${label}</a>`)
      .join("");
  }
  const learnCourseMatch = /^#\/learn\/course\/(\d+)$/.exec(location.hash);
  const pageTitle = document.getElementById("page-title");
  if (pageTitle) {
    pageTitle.textContent = location.hash.startsWith("#/learn/words")
      ? "YOUR WORDS"
      : learnCourseMatch
        ? (course?.title || "LEARN")
        : (TITLES[page()]?.toUpperCase() ?? "FLYING PAPERS");
  }
  $account.innerHTML = `<a class="who-pill" href="#/u/${esc(me.username)}" title="Your profile (@${esc(me.username)})">${avatar(me)}<span>${esc(me.name)}</span></a>`;
  document.getElementById("logout")?.addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST", body: {} });
    window.google?.accounts?.id?.disableAutoSelect?.();
    me = null;
    topStats = null;
    location.hash = "#/";
    route();
  });
  setTopStats();
}

// ---------------------------------------------------------------- landing page (signed out)

/** [phrase, language code, language, meaning]: phrases from courses, in several languages. */
const EXAMPLES = [
  ["Labas rytas!", "lt", "Lithuanian", "Good morning!"],
  ["Ačiū labai!", "lt", "Lithuanian", "Thank you very much!"],
  ["Kaip sekasi?", "lt", "Lithuanian", "How are you doing?"],
  ["Kur yra kavinė?", "lt", "Lithuanian", "Where is the cafe?"],
  ["Noriu kavos, prašau.", "lt", "Lithuanian", "I'd like a coffee, please."],
  ["Malonu susipažinti!", "lt", "Lithuanian", "Nice to meet you!"],
  ["Aš mokausi lietuvių kalbos.", "lt", "Lithuanian", "I am learning Lithuanian."],
  ["Iki pasimatymo!", "lt", "Lithuanian", "See you later!"],
];

const FAQ = [
  ["Is it free?", "Yes. Sign in with Google or join as a guest and start learning. Everything is accessible."],
  ["What is the Flying Papers aesthetic?", "Operates like a Saturday-morning cartoon printed on thick riso cardstock: a flat muted-violet stage, a small cast of saturated confetti colors, and poster-scale display type."],
  ["What courses are available?", "We offer authentic Lithuanian vocabulary courses (A1–B1) covering everyday conversation, campus life, food, and culture, plus historical chronicles of the Grand Duchy."],
  ["Do I need a Lithuanian keyboard?", "No. On-screen buttons for letters like ą, č, ę, ė, į, š, ų, ū, ž appear under the answer box. Leaving accents off still counts, and we display proper orthography."],
  ["How does spaced review work?", "Words you master return in 1 day, then 3 days, then at expanding intervals like a printed receipt. Keep your retention near 100%."],
  ["How do hearts work?", "You start each round with 5 hearts. Wrong answers in fresh lessons consume a heart. Practice sessions earn them back."],
  ["What are Word Duels?", "Head-to-head multiplayer. You and a rival answer the exact same 10 words under the clock. Higher score wins the crown."],
];

const FEATURES = [
  ["learn", "Conversational Lithuanian", "Practical vocabulary courses from first greetings to fluent conversations."],
  ["cards", "Receipts on Cardstock", "Spaced repetition brings words back right before you would forget them."],
  ["heart", "5 Hearts Keep You Sharp", "Each miss matters in fresh lessons. Practise finished decks to restore hearts."],
  ["fire", "Streaks & Confetti XP", "Learn a little every day to grow your streak and hit your goals."],
  ["cup", "Saturday Showdowns", "Compete with fellow learners on the weekly confessional leaderboard."],
  ["room", "1-on-1 Word Duels", "Same 10 cards, real-time stopwatch. Whoever gets more right wins."],
];

function landingHtml() {
  const challenged = duelCodeFromHash();
  return `
    <div class="landing-page-poster">
      ${challenged ? `<div class="confetti-card confetti-yellow" style="margin-bottom:24px;"><b>WORD DUEL CHALLENGE:</b> You've been challenged to duel <b>${esc(challenged)}</b>. Jump into the arena!</div>` : ""}
      
      <!-- Component 1: Hero screen with mascot (from DESIGN.md) -->
      <section class="poster-hero">
        <span class="eyebrow-tag">[ RISO CARDSTOCK // ISSUE #01 ]</span>
        <div class="poster-headline-container">
          <h1 class="poster-display-title">
            <span class="txt-hi">FLYING</span> <span class="txt-butter">PAPERS</span>
            <br>
            <span class="txt-butter">SATURDAY</span> <span class="txt-hi">MORNING</span>
            <br>
            <span class="txt-hi">CONFESSIONAL</span>
          </h1>
          <div class="poster-mascot-slot">
            ${MASCOT_SVG}
          </div>
        </div>
        
        <p class="poster-lead">Printed on thick riso cardstock: a flat muted-violet stage, saturated confetti colors, and type so loud it takes the viewport. Learn Lithuanian and words that stick.</p>
        
        <div class="poster-actions">
          <button type="button" class="btn-gate-pill big" id="cta-get-started">START LEARNING →</button>
          <button type="button" class="btn-outlined-display big" id="cta-guest-btn">PLAY AS GUEST</button>
        </div>
        
        <a href="#signin" class="link-disclaimer-underline" id="cta-signin-link">Already a member? Sign in with Google or account</a>
        
        <div class="poster-signin-drawer" id="signin-drawer" hidden>
          <div class="signin-box card">
            <span class="mono-tag dark-ink">[ ACCESS GATE // AUTHENTICATE ]</span>
            <div id="gsi" class="gsi-slot"></div>
            <p id="signin-error" class="error" hidden></p>
            ${
              config.devLogin
                ? `<form id="dev-login" class="dev-login">
                     <input type="text" id="dev-name" placeholder="Your name (guest pass)" maxlength="40" required class="riso-input" value="Learner">
                     <button class="btn-gate-pill" style="width:100%; justify-content:center;">ENTER AS GUEST →</button>
                   </form>`
                : ""
            }
          </div>
        </div>
      </section>

      <!-- Component 2: Confetti Card Grid Section (from DESIGN.md) -->
      <section class="poster-section">
        <div class="section-label-row">
          <span class="mono-tag light-bone" style="align-self:flex-start;">[ CONFETTI CARDS // SPECIFICATION ]</span>
          <h2 class="section-title"><span class="txt-hi">SATURATED</span> <span class="txt-butter">CONFETTI</span></h2>
        </div>
        <div class="confetti-grid">
          <div class="confetti-card confetti-matcha">
            <span class="mono-tag dark-ink">[ 01 // VOCABULARY ]</span>
            <h3>Authentic Lithuanian</h3>
            <p>Everyday vocabulary, campus conversation, dining, and street idioms printed into long-term memory.</p>
          </div>
          <div class="confetti-card confetti-pink">
            <span class="mono-tag dark-ink">[ 02 // SPACED REVIEWS ]</span>
            <h3>Receipts on Cardstock</h3>
            <p>Tight spaced intervals return each learned card right before you'd forget it. Zero cramming.</p>
          </div>
          <div class="confetti-card confetti-magenta">
            <span class="mono-tag light-bone">[ 03 // WORD DUELS ]</span>
            <h3>10 Cards. Real Showdown.</h3>
            <p>Challenge a friend or rival to the exact same 10 words. Speed and precision take the crown.</p>
          </div>
          <div class="confetti-card confetti-red">
            <span class="mono-tag light-bone">[ 04 // 5 HEARTS FLAME ]</span>
            <h3>Hearts Keep You Sharp</h3>
            <p>5 hearts per round. Misses sting, practice heals. Daily streaks keep the confessional burning.</p>
          </div>
          <div class="confetti-card confetti-lilac">
            <span class="mono-tag light-bone">[ 05 // BALTIC CHRONICLES ]</span>
            <h3>Grand Duchy to Baltic Way</h3>
            <p>Castles, kings, book smugglers, and restored independence in authentic A1–B1 historical decks.</p>
          </div>
          <div class="confetti-card confetti-butter">
            <span class="mono-tag dark-ink">[ 06 // STUDIO CMS ]</span>
            <h3>Create & Publish Decks</h3>
            <p>Build custom courses, arrange lessons, and export portable SQLite files with open access.</p>
          </div>
        </div>
      </section>

      <!-- Component 3: Color Swatch Legend Block (from DESIGN.md) -->
      <section class="poster-section">
        <div class="card swatch-legend-card">
          <div class="swatch-head">
            <span class="mono-tag dark-ink">[ SYSTEM // TOKENS ]</span>
            <h3 class="swatch-heading">PALETTE</h3>
          </div>
          <div class="swatch-grid">
            <div class="swatch-item" style="background:#8584bd; color:#f9f5f2;">
              <span class="swatch-name">Dusk Violet</span>
              <span class="swatch-hex">#8584bd</span>
            </div>
            <div class="swatch-item" style="background:#f4ed36; color:#000000;">
              <span class="swatch-name">Hi-Vis Yellow</span>
              <span class="swatch-hex">#f4ed36</span>
            </div>
            <div class="swatch-item" style="background:#f9cc73; color:#1a1a1a;">
              <span class="swatch-name">Buttery Yellow</span>
              <span class="swatch-hex">#f9cc73</span>
            </div>
            <div class="swatch-item" style="background:#61609a; color:#f9f5f2;">
              <span class="swatch-name">Lilac Shadow</span>
              <span class="swatch-hex">#61609a</span>
            </div>
            <div class="swatch-item" style="background:#f8c1ba; color:#1a1a1a;">
              <span class="swatch-name">Bubblegum Pink</span>
              <span class="swatch-hex">#f8c1ba</span>
            </div>
            <div class="swatch-item" style="background:#b5c995; color:#1a1a1a;">
              <span class="swatch-name">Matcha Cream</span>
              <span class="swatch-hex">#b5c995</span>
            </div>
            <div class="swatch-item" style="background:#ac4f98; color:#f9f5f2;">
              <span class="swatch-name">Magenta Punch</span>
              <span class="swatch-hex">#ac4f98</span>
            </div>
            <div class="swatch-item" style="background:#c94245; color:#f9f5f2;">
              <span class="swatch-name">Firecracker Red</span>
              <span class="swatch-hex">#c94245</span>
            </div>
            <div class="swatch-item" style="background:#f9f5f2; color:#1a1a1a; border:1.5px solid #1a1a1a;">
              <span class="swatch-name">Bone White</span>
              <span class="swatch-hex">#f9f5f2</span>
            </div>
            <div class="swatch-item" style="background:#1a1a1a; color:#f9f5f2;">
              <span class="swatch-name">Ink Black</span>
              <span class="swatch-hex">#1a1a1a</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Vocabulary Examples -->
      <section class="poster-section">
        <div class="card dark-text-card">
          <span class="mono-tag dark-ink" style="align-self:flex-start;">[ CURRICULUM // EXAMPLES ]</span>
          <h2 class="sub-headline">AUTHENTIC VOCABULARY</h2>
          <ul class="riso-examples">
            ${EXAMPLES.map(([phrase, code, lang, en]) => `
              <li class="riso-ex-item">
                <span class="riso-phrase" lang="${code}">${esc(phrase)} <span class="mono-tag dark-ink" style="font-size:10px; margin-left:4px;">${lang.toUpperCase()}</span></span>
                <span class="riso-arrow">→</span>
                <span class="riso-translation">${esc(en)}</span>
              </li>
            `).join("")}
          </ul>
        </div>
      </section>

      <!-- Inquiries FAQ -->
      <section class="poster-section">
        <div class="card dark-text-card">
          <span class="mono-tag dark-ink" style="align-self:flex-start;">[ FAQ // INQUIRIES ]</span>
          <h2 class="sub-headline">CONFESSIONAL INQUIRIES</h2>
          <div class="riso-faq">
            ${FAQ.map(([q, a]) => `
              <details class="riso-details">
                <summary class="riso-summary"><span class="q-text">${esc(q)}</span><span class="q-icon">+</span></summary>
                <p class="riso-answer">${esc(a)}</p>
              </details>
            `).join("")}
          </div>
        </div>
      </section>

      <!-- Final CTA Banner -->
      <section class="poster-section">
        <div class="confetti-card confetti-magenta cta-poster">
          <span class="mono-tag light-bone">[ ADMISSION // FINAL STEP ]</span>
          <h2 class="cta-title">I'M OVER 18. LET ME IN.</h2>
          <p class="cta-desc">Your first lesson takes under three minutes. Step onto the violet stage and start learning.</p>
          <button type="button" class="btn-gate-pill big" id="cta-bottom-start">ENTER THE STAGE →</button>
        </div>
      </section>
    </div>`;
}

function renderLanding() {
  $app.innerHTML = landingHtml();
  const drawer = document.getElementById("signin-drawer");
  const err = (msg) => {
    const e = document.getElementById("signin-error");
    if (e) {
      e.textContent = msg;
      e.hidden = !msg;
    }
  };
  if (config.googleClientId) mountGoogleButton(err);
  else {
    const gsi = document.getElementById("gsi");
    if (gsi) gsi.innerHTML = `<p class="mono-tag dark-ink">Guest access enabled.</p>`;
  }

  const openDrawer = () => {
    if (drawer) {
      drawer.hidden = false;
      drawer.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("dev-name")?.focus();
    }
  };

  document.getElementById("cta-get-started")?.addEventListener("click", openDrawer);
  document.getElementById("cta-guest-btn")?.addEventListener("click", openDrawer);
  document.getElementById("cta-signin-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    openDrawer();
  });
  document.getElementById("cta-bottom-start")?.addEventListener("click", openDrawer);

  document.getElementById("dev-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const devName = document.getElementById("dev-name")?.value || "Learner";
      ({ user: me } = await api("/auth/dev", { method: "POST", body: { name: devName } }));
      afterSignIn();
    } catch (x) {
      err(x.message);
    }
  });
}

/** After signing in, go where the visitor was headed (a duel link) or to Learn. */
function afterSignIn() {
  if (!duelCodeFromHash() && page() === "home") location.hash = "#/learn";
  route();
  refreshTopStats();
}

// ---------------------------------------------------------------- Play: create or join a room

/** Units grouped by level, in course order: [[level, [units]]]. */
function byLevel(units) {
  const groups = [];
  for (const u of units) {
    const last = groups.at(-1);
    if (last && last[0] === u.level) last[1].push(u);
    else groups.push([u.level, [u]]);
  }
  return groups;
}

const unitWords = (u) => u.lessons.reduce((n, l) => n + l.total, 0);
const unitLearned = (u) => u.lessons.reduce((n, l) => n + l.done, 0);

async function renderPlayHub() {
  $app.innerHTML = `
    <div class="lobby">
      <section class="card picker">
        <header class="picker-head"><h2>Play a friend</h2><p class="muted">Create a word duel and send the link, or join one with a code</p></header>
        <div class="tiles two" role="tablist">
          <button class="tile" role="tab" data-mode="create" aria-selected="true"><span class="tip">You play first, then send the link</span><span class="tile-icon">${I.room}</span><span class="tile-name">Create a room</span></button>
          <button class="tile" role="tab" data-mode="join" aria-selected="false"><span class="tip">Got a code from a friend?</span><span class="tile-icon">${I.join}</span><span class="tile-name">Join a room</span></button>
        </div>
        <div class="pane" id="pane-create">
          <label class="field" id="course-pick" hidden>Course <select id="duel-course"></select></label>
          <div class="row spread"><h3>Which decks?</h3><span class="muted small" id="deck-count"></span></div>
          <div class="deck-picker" id="decks"><p class="muted">Loading decks…</p></div>
          <p id="create-error" class="error" hidden></p>
          <div class="pane-actions"><span class="muted">10 random words from these decks. You play first, then send the link.</span><button class="btn" id="create">Create room ${I.arrow}</button></div>
        </div>
        <form class="pane" id="pane-join" hidden>
          <label class="field">Room code
            <span class="row"><input type="text" id="join-code" placeholder="e.g. K7QX4M" maxlength="6" autocomplete="off" style="flex:1;min-width:160px;text-transform:uppercase;letter-spacing:.12em"><button class="btn">Join ${I.arrow}</button></span>
          </label>
        </form>
      </section>
      <aside class="card list-card">
        <div class="list-head"><h3>Your rooms <span class="muted" id="duel-count"></span></h3></div>
        <ul class="rows" id="my-duels"><li class="empty-row">Loading…</li></ul>
      </aside>
    </div>`;

  for (const b of $app.querySelectorAll(".tile")) {
    b.onclick = () => {
      for (const x of $app.querySelectorAll(".tile")) x.setAttribute("aria-selected", String(x === b));
      document.getElementById("pane-create").hidden = b.dataset.mode !== "create";
      document.getElementById("pane-join").hidden = b.dataset.mode !== "join";
      if (b.dataset.mode === "join") document.getElementById("join-code").focus();
    };
  }

  const picked = new Set();
  let duelCourse = null;
  const decks = document.getElementById("decks");
  const countPicked = (units) => {
    const words = units.filter((u) => picked.has(u.id)).reduce((n, u) => n + unitWords(u), 0);
    document.getElementById("deck-count").textContent = picked.size ? `${picked.size} deck${picked.size > 1 ? "s" : ""} · ${words} words` : "Pick at least one";
  };
  const loadDecks = (cid) =>
    api(`/learn${cid ? `?course=${cid}` : ""}`).then(({ units, course: c, myCourses }) => {
      duelCourse = c;
      picked.clear();
      const sel = document.getElementById("duel-course");
      if (sel && !sel.options.length && myCourses.length) {
        sel.innerHTML = myCourses.map((x) => `<option value="${x.id}" ${x.id === c?.id ? "selected" : ""}>${esc(x.title)}</option>`).join("");
        document.getElementById("course-pick").hidden = myCourses.length < 2;
        sel.onchange = () => loadDecks(Number(sel.value)).catch((x) => toast(x.message));
      }
      if (!c) return (decks.innerHTML = `<p class="muted">Start a course first: <a href="#/discover">Discover courses</a>.</p>`);
      // Start with the decks you've begun (or the first one).
      for (const u of units) if (unitLearned(u) > 0) picked.add(u.id);
      if (!picked.size && units[0]) picked.add(units[0].id);
      decks.innerHTML = byLevel(units)
        .map(
          ([level, us]) => `<div class="deck-group"><div class="row spread"><b>${levelChip(level)} ${esc(LEVELS[level]?.[0] ?? "")}</b><button type="button" class="linkbtn small" data-level="${esc(level)}">Select all</button></div>
            <div class="deck-chips">${us
              .map(
                (u) => `<label class="deck-chip"><input type="checkbox" value="${u.id}" ${picked.has(u.id) ? "checked" : ""}><span>${esc(u.title)}<small>${unitWords(u)} words${unitLearned(u) ? ` · ${unitLearned(u)} learned` : ""}</small></span></label>`,
              )
              .join("")}</div></div>`,
        )
        .join("");
      for (const cb of decks.querySelectorAll("input[type=checkbox]")) cb.onchange = () => ((cb.checked ? picked.add(Number(cb.value)) : picked.delete(Number(cb.value))), countPicked(units));
      for (const b of decks.querySelectorAll("[data-level]")) {
        b.onclick = () => {
          const group = b.closest(".deck-group").querySelectorAll("input[type=checkbox]");
          const all = [...group].every((x) => x.checked);
          for (const x of group) {
            x.checked = !all;
            x.onchange();
          }
        };
      }
      countPicked(units);
    });
  loadDecks(0).catch((x) => (decks.innerHTML = `<p class="error">${esc(x.message)}</p>`));

  document.getElementById("create").onclick = async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("create-error");
    errEl.hidden = true;
    btn.disabled = true;
    try {
      const { code } = await api("/duels", { method: "POST", body: { courseId: duelCourse?.id, unitIds: [...picked] } });
      location.hash = `#/duel/${code}`;
    } catch (x) {
      errEl.textContent = x.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };

  document.getElementById("pane-join").onsubmit = (e) => {
    e.preventDefault();
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) location.hash = `#/duel/${code}`;
    else toast("Codes have 6 letters and numbers");
  };

  try {
    const { duels } = await api("/duels");
    const list = document.getElementById("my-duels");
    if (!list) return;
    document.getElementById("duel-count").textContent = duels.length ? `(${duels.length})` : "";
    list.innerHTML = duels.length
      ? duels
          .map(
            (d) => `<li><a class="duel-row" href="#/duel/${esc(d.code)}"><span class="code-chip">${esc(d.code)}</span>
              <span>${esc(d.title)}<br><span class="muted small">by ${esc(d.creator)} · ${d.players} played</span></span>
              <span class="act">${d.myPoints == null ? "Play" : `${d.myPoints} pts`}</span></a></li>`,
          )
          .join("")
      : `<li class="empty-row">No rooms yet. Create your first one!</li>`;
  } catch {
    /* the hub still works without the list */
  }
}

// ================================================================ Learn: path, lessons, review, word list

const QUESTS = [20, 50, 100, 250, 500, 1000];

function statChips(stats) {
  return `<div class="chips">
    <span class="chip" title="Day streak">${I.fire}<b>${stats.streak}</b></span>
    <span class="chip" title="Total XP">${I.bolt}<b>${stats.xp}</b></span>
    <span class="chip" title="Hearts">${I.heart}<b>${stats.hearts}</b></span>
  </div>`;
}

/** The first lesson that isn't finished (the one to do next). */
function currentLessonId(units) {
  for (const u of units) for (const l of u.lessons) if (l.total > 0 && l.done < l.total) return l.id;
  return null;
}

function reviewCardHtml(stats) {
  return `<section class="card side-card review-card">
    <div class="row spread"><h3>Review</h3><a href="#/learn/words" class="small">Your words</a></div>
    <div class="review-count"><span class="review-icon">${I.cards}</span><div><b>${stats.due}</b> <span class="muted small">word${stats.due === 1 ? "" : "s"} due</span><br><span class="muted small">${stats.learned} learned so far</span></div></div>
    ${
      stats.due
        ? `<a class="btn small" href="#/learn/review">Review now</a>`
        : `<p class="muted small">${stats.learned ? `Nothing due. Next review ${fmtUntil(stats.nextDueAt)}.` : "Words you learn come back here for review, just before you'd forget them."}</p>`
    }
  </section>`;
}

/** Pastel background for a course, picked from its id so it stays the same everywhere. */
const tint = (id) => `tint-${Math.abs(Number(id) || 0) % 6}`;

/** A lesson's state as a small ring: dashed (not started), partial arc, or a green check (done). */
function ringHtml(done, total) {
  if (total && done >= total)
    return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--green)"/><path d="M6 10.3l2.6 2.6L14 7.6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (!done) return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="2.2 2.4"/></svg>`;
  const c = 2 * Math.PI * 8;
  return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" stroke-width="2"/><circle cx="10" cy="10" r="8" fill="none" stroke="var(--green)" stroke-width="2" stroke-dasharray="${((c * done) / total).toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 10 10)"/></svg>`;
}

/** The podium (top three, 2-1-3) and the rest of the board. */
function boardHtml(rows, limit = 9) {
  if (!rows.length) return `<p class="muted small">No XP yet. Finish a lesson to get on the board!</p>`;
  const spot = (r, cls) =>
    r ? `<a class="podium-spot ${cls}" href="#/u/${esc(r.username)}"><span class="pic">${avatar(r)}<span class="rank-badge">${r.rank}</span></span><b>${esc(r.name)}${r.isYou ? " (you)" : ""}</b><span>${r.xp} XP</span></a>` : "<span></span>";
  return `<div class="podium">${spot(rows[1], "second")}${spot(rows[0], "first")}${spot(rows[2], "third")}</div>
    ${rows.length > 3 ? `<ol class="rank-list">${rows.slice(3, limit).map((r) => `<li class="${r.isYou ? "you" : ""}"><span class="n">${r.rank}</span>${avatar(r)}<a href="#/u/${esc(r.username)}">${esc(r.name)}${r.isYou ? " (you)" : ""}</a><span class="xp">${r.xp} XP</span></li>`).join("")}</ol>` : ""}`;
}

/**
 * XP per day for the last 14 days as dot columns: one series, so no legend (the title names it). Each dot is a
 * fixed amount of XP (a multiple of 10, at most 12 dots a column). Hover or focus a column for its value; a
 * screen-reader table carries the same numbers.
 */
function activityHtml(days) {
  const max = Math.max(...days.map((d) => d.xp), 10);
  const step = Math.max(10, Math.ceil(max / 12 / 10) * 10);
  const dayName = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);
  const cols = days
    .map((d, i) => {
      const n = Math.ceil(d.xp / step);
      const label = `${dayName(d.day, { weekday: "short", day: "numeric", month: "short" })}: ${d.xp} XP`;
      return `<div class="activity-col ${i === days.length - 1 ? "today" : ""}" tabindex="0" data-tip="${esc(label)}" aria-label="${esc(label)}">${"<i></i>".repeat(n)}</div>`;
    })
    .join("");
  const xs = days.map((d, i) => `<span>${i % 2 === days.length % 2 ? "" : dayName(d.day, { day: "numeric" })}</span>`).join("");
  return `<div class="activity">
      <div class="activity-axis" aria-hidden="true"><span>${step * 12}</span><span>${step * 6}</span><span>0</span></div>
      <div class="activity-cols" role="img" aria-label="XP earned per day over the last 14 days">${cols}</div>
      <div class="activity-x" aria-hidden="true">${xs}</div>
    </div>
    <table class="sr-only"><caption>XP per day</caption><tbody>${days.map((d) => `<tr><th scope="row">${esc(d.day)}</th><td>${d.xp}</td></tr>`).join("")}</tbody></table>
    <p class="stat-note">Each dot is ${step} XP.</p>`;
}

function wireChartTips(root) {
  for (const chart of root.querySelectorAll(".activity")) {
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    chart.append(tip);
    const show = (col) => {
      tip.textContent = col.dataset.tip;
      const c = col.getBoundingClientRect();
      const p = chart.getBoundingClientRect();
      tip.style.left = `${c.left - p.left + c.width / 2}px`;
      tip.style.top = `${Math.max(0, c.top - p.top + c.height - col.childElementCount * 10 - 14)}px`;
      tip.hidden = false;
    };
    for (const col of chart.querySelectorAll(".activity-col")) {
      col.onmouseenter = col.onfocus = () => show(col);
      col.onmouseleave = col.onblur = () => (tip.hidden = true);
    }
  }
}

function dashSideHtml(stats, board, feed = { courses: [] }) {
  const today = stats?.days?.at(-1)?.xp ?? 0;
  const fresh = (feed?.courses || []).filter((c) => !c.enrolled);
  const quests = stats ? QUESTS.filter((q) => q > stats.xp)
    .slice(0, 3)
    .map((q) => `<li><div class="row spread"><span>Earn ${q} XP</span><span class="muted small">${stats.xp}/${q}</span></div><div class="bar"><i style="width:${Math.round((100 * stats.xp) / q)}%"></i></div></li>`)
    .join("") : "";

  return `
    <aside class="dash-side">
      <section class="card widget dash-progress-card">
        <div class="widget-head">
          <h3>Daily Progress</h3>
          ${today ? `<span class="pill ok">+${today} XP today</span>` : `<span class="pill">0 XP today</span>`}
        </div>
        <div class="stat-row">
          <div><span>Streak</span><b>${stats?.streak ?? 0}d</b></div>
          <div><span>Learned</span><b>${stats?.learned ?? 0}</b></div>
          <div><span>Due</span><b>${stats?.due ?? 0}</b></div>
          <div><span>Hearts</span><b>${stats?.hearts ?? 0}</b></div>
        </div>
        ${stats?.due ? `<a class="btn block" href="#/learn/review">${FC_ICONS.shuffle} Review ${plural(stats.due, "word")} now</a>` : `<p class="stat-note">${stats?.learned ? `All caught up! Next review ${fmtUntil(stats.nextDueAt)}.` : "Words you learn come back for review just before you'd forget them."}</p>`}
        ${stats && stats.hearts < stats.maxHearts ? `<p class="stat-note small">Next heart in ${fmtMinutes(stats.nextHeartMs)}.</p>` : ""}
        ${stats?.days?.length ? `<div class="dash-activity-wrap"><div class="dash-activity-head"><span class="muted small">14-Day Momentum</span><span class="muted small">XP per day</span></div>${activityHtml(stats.days)}</div>` : ""}
        <div class="dash-side-links">
          <a class="small" href="#/learn/words">${I.list} All your words</a>
          ${stats?.learned ? `<a class="small" href="#/learn/review">${I.cards} Shuffled flashcards</a>` : ""}
        </div>
      </section>
      <section class="card widget" id="board-widget">
        <div class="widget-head"><h3>Leaderboard</h3><select id="board-period" aria-label="Period"><option value="week">Weekly</option><option value="all">All time</option></select></div>
        <div id="board-body">${boardHtml(board?.rows ?? [])}</div>
      </section>
      ${
        fresh.length
          ? `<section class="card widget"><div class="widget-head"><h3>From people you follow</h3><a href="#/discover?tab=following" class="small">All</a></div>
              <ul class="feed">${fresh.slice(0, 3).map((c) => `<li><a href="#/course/${c.id}"><b>${esc(c.title)}</b></a><span class="muted small">by ${userLink(c.creator)} · ${plural(c.words, "word")}</span></li>`).join("")}</ul></section>`
          : ""
      }
      ${quests ? `<section class="card widget"><h3>Quests</h3><ul class="quests">${quests}</ul></section>` : ""}
    </aside>`;
}

function wireDashSide(root = $app) {
  wireChartTips(root);
  const period = root.querySelector("#board-period");
  if (period) {
    period.onchange = async (e) => {
      try {
        const b = await api(`/leaderboard?period=${e.target.value}`);
        const body = root.querySelector("#board-body");
        if (body) body.innerHTML = boardHtml(b.rows);
      } catch (x) {
        toast(x.message);
      }
    };
  }
}

/** Home dashboard: displays enrolled courses cards. Clicking a course opens its learning path. */
async function renderEnrolledCourses() {
  $app.innerHTML = `<p class="muted loading">Loading your courses…</p>`;
  let data;
  let board = { rows: [] };
  let feed = { courses: [] };
  try {
    [data, board, feed] = await Promise.all([
      api("/learn"),
      api("/leaderboard?period=week").catch(() => board),
      api("/feed").catch(() => feed),
    ]);
  } catch (x) {
    $app.innerHTML = errorCard(x.message, ["#/discover", "Discover courses"]);
    return;
  }
  const { stats, myCourses = [] } = data;
  course = data.course;
  setTopStats(stats);

  const enrolledCards = myCourses
    .map((c) => {
      const pct = c.words ? Math.round((100 * (c.learned || 0)) / c.words) : 0;
      return `
      <div class="card enrolled-card" data-course="${c.id}">
        <div class="tile-art ${tint(c.id)}">
          <span class="tag-chip">${c.creator?.official ? "Official" : "Enrolled"}</span>
          <span class="lang-orb">${esc(flag(c))}</span>
          <h3 title="${esc(c.title)}">${esc(c.title)}</h3>
          <div class="meta">
            <span>${esc(c.fromLang)} → ${esc(c.toLang)}</span>
            <span>${plural(c.units, "deck")}</span>
            <span>${plural(c.words, "word")}</span>
          </div>
        </div>
        ${c.description ? `<p class="enrolled-desc">${esc(c.description)}</p>` : ""}
        <div class="enrolled-progress">
          <div class="row spread small">
            <span><b>${pct}%</b> completed</span>
            <span class="muted">${c.learned || 0}/${c.words} words</span>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>
        <div class="enrolled-foot">
          <a class="btn ${c.learned ? "" : "outline"}" href="#/learn/course/${c.id}">${c.learned ? "Continue learning" : "Start course"}</a>
          <a class="btn outline small" href="#/course/${c.id}" title="Course details">About</a>
        </div>
      </div>`;
    })
    .join("");

  const addCard = `
    <a class="enrolled-add" href="#/discover">
      <div>
        <span class="plus">${ICON.plus}</span>
        <b>Find more courses</b>
        <span class="muted small">Courses by us and by other learners</span>
      </div>
    </a>`;

  const emptyState = `
    <section class="card picker">
      <header class="picker-head">
        <span class="board-icon">${I.learn}</span>
        <h2>You're not enrolled in any courses yet</h2>
        <p class="muted">Explore courses created by us and the community to start learning.</p>
      </header>
      <div class="row" style="justify-content:center">
        <a class="btn" href="#/discover">Find a course</a>
        <a class="btn outline" href="#/studio">Create a course</a>
      </div>
    </section>`;

  $app.innerHTML = `
    <div class="dash">
      <div class="dash-main">
        <header class="dash-head">
          <div>
            <h1>My Courses</h1>
            <p class="muted">${myCourses.length ? "Pick a course to continue learning" : "Start your language journey"}</p>
          </div>
          <a class="btn outline small" href="#/discover">${ICON.plus} Discover</a>
        </header>
        ${myCourses.length ? `<div class="enrolled-grid">${enrolledCards}${addCard}</div>` : emptyState}
      </div>
      ${dashSideHtml(stats, board, feed)}
    </div>`;

  wireDashSide($app);

  for (const card of $app.querySelectorAll(".enrolled-card[data-course]")) {
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      location.hash = `#/learn/course/${card.dataset.course}`;
    });
  }
}

/** Specific course learning path: displays decks and lessons for that course. */
async function renderCoursePath(courseId) {
  $app.innerHTML = `<p class="muted loading">Loading course path…</p>`;
  let data;
  let board = { rows: [] };
  let feed = { courses: [] };
  try {
    [data, board, feed] = await Promise.all([
      api(`/learn?course=${courseId}`),
      api("/leaderboard?period=week").catch(() => board),
      api("/feed").catch(() => feed),
    ]);
  } catch (x) {
    $app.innerHTML = errorCard(x.message, ["#/learn", "Back to My Courses"]);
    return;
  }
  const { units, stats } = data;
  course = data.course;
  setTopStats(stats);
  if (!course) {
    $app.innerHTML = errorCard("Course not found", ["#/learn", "Back to My Courses"]);
    return;
  }

  // Which lessons are open: everything up to the first unfinished one.
  const current = currentLessonId(units);
  let reached = true;
  const state = new Map();
  for (const u of units)
    for (const l of u.lessons) {
      const done = l.total > 0 && l.done >= l.total;
      const isCurrent = l.id === current;
      state.set(l.id, { done, isCurrent, locked: !done && !isCurrent && !reached });
      if (isCurrent) reached = false;
    }
  const openUnit = units.find((u) => u.lessons.some((l) => l.id === current))?.id ?? units[0]?.id;

  const moduleHtml = (u, ui) => {
    const words = unitWords(u);
    const learned = unitLearned(u);
    const pct = words ? Math.round((100 * learned) / words) : 0;
    const done = u.lessons.length > 0 && u.lessons.every((l) => state.get(l.id).done);
    const hasCurrent = u.lessons.some((l) => l.id === current);
    const allLocked = u.lessons.length > 0 && u.lessons.every((l) => state.get(l.id).locked);
    const action = hasCurrent
      ? `<a class="btn" href="#/learn/lesson/${current}">${learned ? "Continue learning" : "Start learning"}</a>`
      : done
        ? `<a class="btn outline" href="#/learn/lesson/${u.lessons[0].id}">Practise</a>`
        : allLocked
          ? `<span class="btn outline" aria-disabled="true">${ICON.lock} Locked</span>`
          : "";
    const rows = u.lessons
      .map((l, li) => {
        const s = state.get(l.id);
        const inner = `<span class="lesson-num">${li + 1}</span><span class="lesson-title">${esc(l.title)}</span>
          <span class="lesson-state">${ringHtml(l.done, l.total)}${l.done && !s.done ? `${l.done}/` : ""}${plural(l.total, "word")}</span>
          <span class="lesson-end">${s.locked ? ICON.lock : ICON.chev.replace("m5 7.5 5 5 5-5", "m7.5 5 5 5-5 5")}</span>`;
        return `<li>${
          s.locked
            ? `<div class="lesson-row-link locked" title="Finish the lessons before this one first">${inner}</div>`
            : `<a class="lesson-row-link ${s.isCurrent ? "current" : ""}" href="#/learn/lesson/${l.id}" title="${s.done ? "Practise" : s.isCurrent ? "Up next" : "Open"}">${inner}</a>`
        }</li>`;
      })
      .join("");
    const feedbackBlock =
      done && !u.feedbackSent
        ? `<div class="unit-done compact"><div><b>Deck complete! How was it?</b><p class="muted small">Tell the creator what to improve.</p></div>
            <div class="stars" role="group" aria-label="Rate this deck">${[1, 2, 3, 4, 5].map((n) => `<button class="star" data-feedback="${u.id}" data-rating="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${I.star}</button>`).join("")}</div></div>`
        : "";
    return `<section class="card module-card ${u.id === openUnit ? "open" : ""}" data-unit="${u.id}">
      <div class="module-head" data-toggle="${u.id}">
        <span class="module-no">${ui + 1}<small>/${units.length}</small></span>
        <div><h2>${esc(u.title)}${u.level ? ` <span class="pill">${esc(u.level)}</span>` : ""}</h2>${u.description ? `<p>${esc(u.description)}</p>` : ""}</div>
        <button class="chev" aria-label="Show lessons" aria-expanded="${u.id === openUnit}">${ICON.chev}</button>
      </div>
      <div class="module-progress">
        <div class="row spread"><span>${pct}% done</span><span class="muted small">${words - learned ? `${plural(words - learned, "word")} left` : "All learned"}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${action}
      </div>
      <ul class="lesson-rows">${rows || `<li class="muted small">No lessons yet.</li>`}</ul>
      ${feedbackBlock}
      <div class="module-foot"><span class="muted small">${plural(u.lessons.length, "lesson")} · ${plural(words, "word")}</span><button class="linkbtn small" data-feedback="${u.id}">${I.chat} Suggest a change</button></div>
    </section>`;
  };

  const totalWords = course.words || 0;
  const learnedWords = course.learned || 0;
  const coursePct = totalWords ? Math.round((100 * learnedWords) / totalWords) : 0;

  $app.innerHTML = `
    <div class="dash">
      <div class="dash-main">
        <div class="toolbar">
          <a class="back" href="#/learn">${I.back} My courses</a>
          <div class="toolbar-actions">
            ${course.mine ? `<a class="btn outline small" href="#/studio/${course.id}">${I.edit} Edit in Studio</a>` : ""}
            <a class="btn outline small" href="#/course/${course.id}">About course</a>
          </div>
        </div>

        <section class="card course-hero-path ${tint(course.id)}">
          <div class="course-hero-inner">
            <span class="lang-orb">${esc(flag(course))}</span>
            <div class="course-hero-text">
              <div class="row spread">
                <span class="tag-chip">${course.creator?.official ? "Official" : "Course"}</span>
                <span class="muted small">${esc(course.fromLang)} → ${esc(course.toLang)}</span>
              </div>
              <h2>${esc(course.title)}</h2>
              ${course.description ? `<p class="muted">${esc(course.description)}</p>` : ""}
              <div class="course-path-progress">
                <div class="row spread small">
                  <span><b>${coursePct}%</b> done</span>
                  <span class="muted">${learnedWords}/${totalWords} words learned · ${plural(units.length, "deck")}</span>
                </div>
                <div class="bar"><i style="width:${coursePct}%"></i></div>
              </div>
            </div>
          </div>
        </section>

        ${units.map(moduleHtml).join("") || `<section class="card picker"><header class="picker-head"><h2>No lessons yet</h2><p class="muted">${course.mine ? `Add decks and words in the <a href="#/studio/${course.id}">Studio</a>.` : "The creator hasn't added any lessons yet."}</p></header></section>`}
      </div>
      ${dashSideHtml(stats, board, feed)}
    </div>`;

  wireDashSide($app);

  for (const h of $app.querySelectorAll("[data-toggle]")) {
    h.onclick = (e) => {
      if (e.target.closest("a")) return;
      const card = h.closest(".module-card");
      card.classList.toggle("open");
      h.querySelector(".chev").setAttribute("aria-expanded", String(card.classList.contains("open")));
    };
  }
  for (const b of $app.querySelectorAll("[data-feedback]")) {
    b.onclick = (e) => {
      e.stopPropagation();
      const u = units.find((x) => x.id === Number(b.dataset.feedback));
      openFeedback(u, Number(b.dataset.rating ?? 0), () => {
        u.feedbackSent = true;
        renderCoursePath(courseId);
      });
    };
  }
}

/** Legacy alias pointing to renderEnrolledCourses */
const renderLearnPath = renderEnrolledCourses;

// ---------------------------------------------------------------- unit feedback ("suggest an improvement")

const FEEDBACK_CATEGORIES = [
  ["too-easy", "Too easy"],
  ["too-hard", "Too hard"],
  ["mistake", "Mistake in a word"],
  ["idea", "Idea"],
];

function openFeedback(unit, rating = 0, onSent = () => {}) {
  let stars = rating;
  let category = null;
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<form class="modal card feedback-modal" role="dialog" aria-modal="true" aria-labelledby="fb-title">
    <button type="button" class="icon-btn modal-close" aria-label="Close">${I.close}</button>
    <h2 id="fb-title">Suggest an improvement</h2>
    <p class="muted small">Deck: <b>${esc(unit.title)}</b></p>
    <div class="stars big" role="group" aria-label="How was this deck?">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-n="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${I.star}</button>`).join("")}</div>
    <div class="fb-cats" role="group" aria-label="What kind of suggestion?">${FEEDBACK_CATEGORIES.map(([k, label]) => `<button type="button" class="fb-cat" data-cat="${k}" aria-pressed="false">${label}</button>`).join("")}</div>
    <label class="field">What should change? <textarea id="fb-text" maxlength="1000" required placeholder="For example: “stotelė” should also accept “autobusų stotelė”…"></textarea></label>
    <p class="error" id="fb-err" hidden></p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn outline" id="fb-cancel">Cancel</button><button class="btn" id="fb-send">Send suggestion</button></div>
  </form>`;
  document.body.append(back);
  const form = back.querySelector("form");
  const paintStars = () => form.querySelectorAll(".star").forEach((s) => s.classList.toggle("on", Number(s.dataset.n) <= stars));
  paintStars();
  const close = () => {
    back.remove();
    removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  addEventListener("keydown", onKey);
  addEventListener("hashchange", close, { once: true });
  back.onclick = (e) => e.target === back && close();
  form.querySelector(".modal-close").onclick = close;
  form.querySelector("#fb-cancel").onclick = close;
  form.querySelectorAll(".star").forEach((s) => (s.onclick = () => ((stars = Number(s.dataset.n)), paintStars())));
  form.querySelectorAll(".fb-cat").forEach((b) => {
    b.onclick = () => {
      category = category === b.dataset.cat ? null : b.dataset.cat;
      form.querySelectorAll(".fb-cat").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.cat === category)));
    };
  });
  form.querySelector("#fb-text").focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector("#fb-err");
    const send = form.querySelector("#fb-send");
    send.disabled = true;
    try {
      await api(`/learn/units/${unit.id}/feedback`, { method: "POST", body: { rating: stars, category, text: form.querySelector("#fb-text").value } });
      close();
      toast("Thanks for the suggestion!");
      onSent();
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
      send.disabled = false;
    }
  };
}

// ---------------------------------------------------------------- the lesson player (lessons, practice and review)

async function renderLesson(id) {
  document.body.classList.add("focus");
  $app.innerHTML = `<p class="muted loading">Loading lesson…</p>`;
  let data;
  try {
    data = await api(`/learn/lessons/${id}`);
  } catch (x) {
    document.body.classList.remove("focus");
    $app.innerHTML = errorCard(x.message);
    return;
  }
  course = data.course;
  const all = data.challenges;
  // New words first; when the whole lesson is learned, practise all of it.
  const practice = all.length > 0 && all.every((c) => c.completed);
  const queue = practice ? all : all.filter((c) => !c.completed);
  if (!queue.length) {
    document.body.classList.remove("focus");
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>This lesson is empty</h2><p class="muted">An admin can add words in the content editor.</p></header><div class="row" style="justify-content:center"><a class="btn" href="#/learn">Back to Learn</a></div></section>`;
    return;
  }
  runPlayer({ mode: practice ? "practice" : "lesson", queue, stats: data.stats, lesson: data.lesson });
}

/** Fisher-Yates array shuffle. */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Speech synthesis helper for flashcard pronunciation. */
function speakWord(text, lang = "lt-LT", el = null) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (el) {
      el.classList.add("speaking");
      u.onend = () => el.classList.remove("speaking");
      u.onerror = () => el.classList.remove("speaking");
    }
    window.speechSynthesis.speak(u);
  } catch {}
}

/** Lightweight celebratory confetti particle explosion. */
function launchConfetti(durationMs = 2400) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "99999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let w = (canvas.width = window.innerWidth);
  let h = (canvas.height = window.innerHeight);

  const colors = ["#2fbf80", "#5fe0a6", "#ffb84d", "#4da6ff", "#b388ff", "#ff6b8b"];
  const pieces = Array.from({ length: 65 }, () => ({
    x: w * 0.5 + (Math.random() * 200 - 100),
    y: h * 0.45,
    w: Math.random() * 8 + 6,
    h: Math.random() * 6 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 16,
    vy: (Math.random() - 1.2) * 14,
    rot: Math.random() * 360,
    vrot: (Math.random() - 0.5) * 12,
    gravity: 0.38,
    drag: 0.96,
  }));

  const start = performance.now();
  let rafId;

  const tick = (now) => {
    const elapsed = now - start;
    if (elapsed > durationMs) {
      canvas.remove();
      return;
    }
    ctx.clearRect(0, 0, w, h);
    const alpha = Math.max(0, 1 - (elapsed / durationMs) ** 2);
    ctx.globalAlpha = alpha;

    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.rot += p.vrot;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  const onResize = () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  };
  window.addEventListener("resize", onResize, { once: true });
}

const FC_ICONS = {
  shuffle: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 3.5h3v3M3.5 16.5l4-4 2 2 4 4h3M16.5 13.5v3h-3M3.5 3.5l6 6M12 12l4.5 4.5"/></svg>`,
  flip: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h11a3 3 0 0 1 3 3v1M6 4 3 7l3 3M17 13H6a3 3 0 0 1-3-3V9M14 16l3-3-3-3"/></svg>`,
  speaker: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5 4.5 8H2v4h2.5L9 15.5V4.5z"/><path d="M13 7a4 4 0 0 1 0 6"/><path d="M15.5 4.5a7.5 7.5 0 0 1 0 11"/></svg>`,
};

/** Interactive Flashcards session for learned words in shuffled order. */
function runFlashcards({ words, stats, course, now }) {
  document.body.classList.add("focus");
  let deck = shuffle(words);
  let index = 0;
  let flipped = false;
  let direction = "lt-en"; // "lt-en": Target language on front, English on back
  const mastered = new Set();
  const stillLearning = new Set();

  const toLanguageName = course?.toLang || "Lithuanian";
  const fromLanguageName = course?.fromLang || "English";
  const courseBack = course?.id ? `#/learn/course/${course.id}` : "#/learn";

  const toggleFlip = (force) => {
    flipped = typeof force === "boolean" ? force : !flipped;
    const card = document.getElementById("fc-card");
    if (card) {
      card.classList.toggle("flipped", flipped);
      card.setAttribute("aria-expanded", String(flipped));
    }
    const unflippedRow = document.getElementById("fc-actions-unflipped");
    const flippedRow = document.getElementById("fc-actions-flipped");
    if (unflippedRow && flippedRow) {
      unflippedRow.style.display = flipped ? "none" : "flex";
      flippedRow.style.display = flipped ? "flex" : "none";
    }
  };

  const render = () => {
    if (index >= deck.length) {
      document.body.classList.remove("focus");
      cleanup();
      launchConfetti();
      $app.innerHTML = `
        <section class="card finish">
          <span class="finish-icon">${I.cards}</span>
          <h1>Review complete!</h1>
          <p class="muted">You reviewed all ${words.length} learned words in shuffled order.</p>
          <div class="finish-stats">
            <div class="fstat xp"><span>Mastered</span><b>${mastered.size}</b></div>
            <div class="fstat acc"><span>Practiced</span><b>${stillLearning.size}</b></div>
            <div class="fstat hp"><span>Cards</span><b>${words.length}</b></div>
          </div>
          <div class="row" style="justify-content:center">
            <button class="btn big" id="fc-again">${FC_ICONS.shuffle} Shuffle & Review again</button>
            <a class="btn big outline" href="${courseBack}">Done</a>
          </div>
          <a class="small" href="#/learn/words">${I.list} All your words</a>
        </section>`;
      document.getElementById("fc-again")?.addEventListener("click", () => {
        runFlashcards({ words, stats, course, now });
      });
      return;
    }

    const w = deck[index];
    const isLtFront = direction === "lt-en";
    const frontText = isLtFront ? w.lt : w.en;
    const backText = isLtFront ? w.en : w.lt;
    const frontLang = isLtFront ? toLanguageName : fromLanguageName;
    const backLang = isLtFront ? fromLanguageName : toLanguageName;
    const progressPct = Math.round(((index) / deck.length) * 100);

    $app.innerHTML = `
      <div class="fc-review">
        <header class="fc-top">
          <div class="fc-top-bar">
            <button class="icon-btn" id="fc-quit" aria-label="Quit review">${I.close}</button>
            <div class="fc-counter">Card <b>${index + 1}</b> / ${deck.length}</div>
            <div class="fc-top-actions">
              <button class="btn outline small" id="fc-shuffle" title="Reshuffle deck">${FC_ICONS.shuffle} Shuffle</button>
              <button class="btn outline small" id="fc-dir" title="Change card direction">${isLtFront ? `${toLanguageName.slice(0, 2).toUpperCase()} → ${fromLanguageName.slice(0, 2).toUpperCase()}` : `${fromLanguageName.slice(0, 2).toUpperCase()} → ${toLanguageName.slice(0, 2).toUpperCase()}`}</button>
            </div>
          </div>
          <div class="progress" role="progressbar" aria-valuenow="${index + 1}" aria-valuemin="1" aria-valuemax="${deck.length}">
            <i style="width: ${progressPct}%"></i>
          </div>
        </header>

        <div class="fc-stage">
          <div class="flashcard ${flipped ? "flipped" : ""}" id="fc-card" tabindex="0" role="button" aria-label="Flashcard: ${esc(frontText)}. Click or press space to flip.">
            <!-- Front -->
            <div class="flashcard-face flashcard-front">
              <div class="fc-head">
                <span class="tag-chip">${w.pos ? esc(w.pos) : "Word"}</span>
                ${w.gender ? `<span class="pill">${esc(w.gender)}</span>` : ""}
                ${w.dueAt && w.dueAt <= now ? `<span class="pill due">Due for review</span>` : `<span class="pill ok">Learned</span>`}
              </div>
              <div class="fc-body">
                <h2 class="fc-word"${isLtFront ? L() : ""}>${esc(frontText)}</h2>
                <span class="fc-lang">${esc(frontLang)}</span>
                <button type="button" class="icon-btn fc-speaker" id="fc-speak" title="Listen" aria-label="Listen to pronunciation">${FC_ICONS.speaker}</button>
              </div>
              <div class="fc-foot">
                <span>${FC_ICONS.flip} Tap card or press <b>Space</b> to flip</span>
              </div>
            </div>

            <!-- Back -->
            <div class="flashcard-face flashcard-back">
              <div class="fc-head">
                <span class="tag-chip">${esc(w.pos || "Meaning")}</span>
                <span class="pill ok">Answer</span>
              </div>
              <div class="fc-body">
                <h2 class="fc-word"${!isLtFront ? L() : ""}>${esc(backText)}</h2>
                <span class="fc-lang">${esc(backLang)}</span>
                ${w.note ? `<p class="fc-note">${esc(w.note)}</p>` : ""}
                ${w.also ? `<p class="fc-also muted small">Also accepted: ${esc(w.also)}</p>` : ""}
              </div>
              <div class="fc-foot">
                <span>Did you recall this correctly?</span>
              </div>
            </div>
          </div>
        </div>

        <div class="fc-controls">
          <div class="fc-actions" id="fc-actions-unflipped" style="display: ${flipped ? "none" : "flex"}">
            <button class="btn outline" id="fc-prev" ${index === 0 ? "disabled" : ""}>← Previous</button>
            <button class="btn fc-flip" id="fc-flip-btn">${FC_ICONS.flip} Flip card</button>
            <button class="btn outline" id="fc-skip">Skip →</button>
          </div>
          <div class="fc-rate-row" id="fc-actions-flipped" style="display: ${flipped ? "flex" : "none"}">
            <button class="btn outline learning" id="fc-learning">Still learning</button>
            <button class="btn mastered" id="fc-mastered">Got it! ✓</button>
          </div>
          <p class="fc-keyboard-hints">Keyboard: <b>Space</b> flip · <b>1</b> Still learning · <b>2</b> Got it · <b>A</b> Audio · <b>← / →</b></p>
        </div>
      </div>`;

    document.getElementById("fc-card")?.addEventListener("click", (e) => {
      if (e.target.closest("#fc-speak") || e.target.closest("button")) return;
      toggleFlip();
    });

    document.getElementById("fc-flip-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFlip(true);
    });

    document.getElementById("fc-speak")?.addEventListener("click", (e) => {
      e.stopPropagation();
      speakWord(isLtFront ? w.lt : w.en, isLtFront ? "lt-LT" : "en-US", document.getElementById("fc-speak"));
    });

    document.getElementById("fc-quit")?.addEventListener("click", () => {
      cleanup();
      location.hash = courseBack;
    });

    document.getElementById("fc-shuffle")?.addEventListener("click", () => {
      const card = document.getElementById("fc-card");
      if (card) {
        card.classList.add("fc-shuffling");
        setTimeout(() => {
          deck = shuffle(words);
          index = 0;
          flipped = false;
          toast("Cards shuffled!");
          render();
        }, 220);
      } else {
        deck = shuffle(words);
        index = 0;
        flipped = false;
        toast("Cards shuffled!");
        render();
      }
    });

    document.getElementById("fc-dir")?.addEventListener("click", () => {
      direction = direction === "lt-en" ? "en-lt" : "lt-en";
      flipped = false;
      render();
    });

    document.getElementById("fc-prev")?.addEventListener("click", () => {
      if (index > 0) {
        index--;
        flipped = false;
        render();
      }
    });

    document.getElementById("fc-skip")?.addEventListener("click", () => {
      index++;
      flipped = false;
      render();
    });

    document.getElementById("fc-learning")?.addEventListener("click", () => {
      stillLearning.add(w.id);
      deck.push(w);
      index++;
      flipped = false;
      render();
    });

    document.getElementById("fc-mastered")?.addEventListener("click", () => {
      mastered.add(w.id);
      if (w.dueAt && w.dueAt <= now) {
        api(`/learn/words/${w.id}/answer`, { method: "POST", body: { review: true, text: w.lt, kind: "type_lt" } }).catch(() => {});
      }
      index++;
      flipped = false;
      render();
    });
  };

  const onKey = (e) => {
    if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
    if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowUp" || e.code === "ArrowDown") {
      e.preventDefault();
      toggleFlip();
    } else if (e.key === "a" || e.key === "A" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      const currentWord = deck[index];
      if (currentWord) {
        const isLt = direction === "lt-en";
        speakWord(isLt ? currentWord.lt : currentWord.en, isLt ? "lt-LT" : "en-US", document.getElementById("fc-speak"));
      }
    } else if (e.key === "1" && flipped) {
      e.preventDefault();
      document.getElementById("fc-learning")?.click();
    } else if (e.key === "2" && flipped) {
      e.preventDefault();
      document.getElementById("fc-mastered")?.click();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      if (flipped) {
        mastered.add(deck[index]?.id);
        if (deck[index]?.dueAt && deck[index]?.dueAt <= now) {
          api(`/learn/words/${deck[index].id}/answer`, { method: "POST", body: { review: true, text: deck[index].lt, kind: "type_lt" } }).catch(() => {});
        }
        index++;
        flipped = false;
        render();
      } else {
        index++;
        flipped = false;
        render();
      }
    } else if (e.code === "ArrowLeft" && index > 0) {
      e.preventDefault();
      index--;
      flipped = false;
      render();
    }
  };

  window.addEventListener("keydown", onKey);
  const cleanup = () => {
    window.removeEventListener("keydown", onKey);
  };
  addEventListener("hashchange", cleanup, { once: true });

  render();
}

async function renderReview() {
  document.body.classList.add("focus");
  $app.innerHTML = `<p class="muted loading">Loading your review flashcards…</p>`;
  let wordsData;
  try {
    wordsData = await api("/learn/words");
  } catch (x) {
    document.body.classList.remove("focus");
    $app.innerHTML = errorCard(x.message);
    return;
  }
  course = wordsData.course;
  const { units, stats, now } = wordsData;
  const learnedWords = (units || []).flatMap((u) => (u.lessons || []).flatMap((l) => l.words || [])).filter((w) => w.learned);

  if (!learnedWords.length) {
    document.body.classList.remove("focus");
    const s = stats || {};
    $app.innerHTML = `<section class="card finish">
      <span class="finish-icon">${I.cards}</span>
      <h1>${s.learned ? "No learned words yet" : "Nothing to review yet"}</h1>
      <p class="muted">${s.learned ? "Finish a lesson first to unlock flashcard review." : "Complete your first lesson! Words you learn will appear here as shuffled flashcards."}</p>
      <div class="row" style="justify-content:center"><a class="btn" href="${course?.id ? `#/learn/course/${course.id}` : '#/learn'}">Start a lesson</a></div>
    </section>`;
    return;
  }

  runFlashcards({ words: learnedWords, stats, course, now });
}

/**
 * Plays a queue of exercises. `mode`: "lesson" (hearts at stake), "practice" (a finished lesson: no hearts lost,
 * +1 heart per right answer) or "review" (spaced repetition: no hearts). A wrong answer shows the right one and
 * comes back at the end of the queue.
 */
function runPlayer({ mode, queue, stats, lesson = null }) {
  document.body.classList.add("focus");
  const review = mode === "review";
  const safe = mode !== "lesson";
  const total = queue.length;
  let solved = 0;
  let mistakes = 0;
  let xpEarned = 0;

  $app.innerHTML = `
    <div class="lesson">
      <header class="lesson-top">
        <button class="icon-btn" id="quit" aria-label="Quit">${I.close}</button>
        <div class="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${total}"><i id="prog"></i></div>
        <span class="hearts" title="${review ? "Review: no hearts lost" : safe ? "Practice: no hearts lost" : "Hearts"}">${I.heart}<b id="hearts">${safe ? "∞" : stats.hearts}</b></span>
      </header>
      <main class="lesson-body" id="stage"></main>
      <footer class="lesson-foot" id="foot">
        <div class="foot-inner">
          <div class="feedback" id="feedback"></div>
          <button class="btn big" id="action" disabled>Check</button>
        </div>
      </footer>
    </div>`;

  const stage = document.getElementById("stage");
  const foot = document.getElementById("foot");
  const feedback = document.getElementById("feedback");
  const action = document.getElementById("action");
  const setProgress = () => {
    document.getElementById("prog").style.width = `${(100 * solved) / total}%`;
    document.querySelector(".progress").setAttribute("aria-valuenow", solved);
  };
  const setHearts = () => {
    if (!safe) document.getElementById("hearts").textContent = stats.hearts;
  };
  const courseBack = course?.id ? `#/learn/course/${course.id}` : "#/learn";
  document.getElementById("quit").onclick = () => {
    if (solved === 0 || confirm(review ? "Stop reviewing? Words you've answered are saved." : "Quit the lesson? Words you've finished are saved.")) location.hash = courseBack;
  };

  let challenge = null;
  let mode2 = "check"; // check | continue
  let answer = null; // () => request body fields, or null when nothing is entered yet

  const outOfHearts = () => {
    const d = document.createElement("div");
    d.className = "modal-back";
    d.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-labelledby="oh-title">
      <span class="modal-icon">${I.heart}</span>
      <h2 id="oh-title">You ran out of hearts</h2>
      <p class="muted">Review your words or practise a lesson you've finished to earn hearts back, or wait: the next one comes back in ${fmtMinutes(stats.nextHeartMs)}.</p>
      <div class="row" style="justify-content:center">${stats.due ? `<a class="btn outline" href="#/learn/review">Review words</a>` : ""}<a class="btn" href="${courseBack}">Back to course</a></div>
    </div>`;
    document.body.append(d);
    addEventListener("hashchange", () => d.remove(), { once: true });
  };

  const ready = (ok) => (action.disabled = !ok);

  const show = () => {
    challenge = queue[0];
    answer = null;
    mode2 = "check";
    foot.className = "lesson-foot";
    feedback.innerHTML = "";
    action.textContent = "Check";
    ready(false);
    const c = challenge;
    if (c.kind === "pick_en" || c.kind === "pick_lt") {
      stage.innerHTML = promptHtml(c) + optionsHtml(c, null);
      for (const b of stage.querySelectorAll(".option")) {
        b.onclick = () => {
          if (mode2 !== "check") return;
          const id = Number(b.dataset.id);
          answer = () => ({ optionId: id });
          for (const x of stage.querySelectorAll(".option")) x.setAttribute("aria-pressed", String(x === b));
          ready(true);
        };
      }
    } else if (c.kind === "type_lt") {
      stage.innerHTML = `${promptHtml(c)}
        <input type="text" class="type-box" id="typed"${L()} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type in ${esc(toLang())}" aria-label="Your answer in ${esc(toLang())}">
        ${lettersHtml()}`;
      const input = document.getElementById("typed");
      input.oninput = () => {
        answer = input.value.trim() ? () => ({ text: input.value }) : null;
        ready(!!answer);
      };
      for (const k of stage.querySelectorAll(".lt-key")) {
        k.onmousedown = (e) => e.preventDefault(); // keep the caret in the box
        k.onclick = (e) => {
          if (mode2 !== "check") return;
          const ch = e.shiftKey ? k.dataset.ch.toUpperCase() : k.dataset.ch;
          const [s, t] = [input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length];
          input.value = input.value.slice(0, s) + ch + input.value.slice(t);
          input.setSelectionRange(s + 1, s + 1);
          input.focus();
          input.oninput();
        };
      }
      input.focus();
    } else if (c.kind === "build") {
      const tiles = c.tiles ?? [];
      const chosen = [];
      stage.innerHTML = `${promptHtml(c)}
        <div class="build-answer" id="built" aria-label="Your sentence"></div>
        <div class="build-bank" id="bank">${tiles.map((t, i) => `<button type="button" class="word-tile" data-i="${i}"${L()}>${esc(t)}</button>`).join("")}</div>`;
      const built = document.getElementById("built");
      const paint = () => {
        built.innerHTML = chosen.map((i, at) => `<button type="button" class="word-tile" data-at="${at}"${L()}>${esc(tiles[i])}</button>`).join("") || `<span class="muted small">Tap the words in order</span>`;
        for (const b of stage.querySelectorAll("#bank .word-tile")) b.classList.toggle("used", chosen.includes(Number(b.dataset.i)));
        for (const b of built.querySelectorAll(".word-tile")) b.onclick = () => mode2 === "check" && (chosen.splice(Number(b.dataset.at), 1), paint());
        answer = chosen.length ? () => ({ text: chosen.map((i) => tiles[i]).join(" ") }) : null;
        ready(!!answer);
      };
      for (const b of stage.querySelectorAll("#bank .word-tile")) {
        b.onclick = () => {
          const i = Number(b.dataset.i);
          if (mode2 === "check" && !chosen.includes(i)) chosen.push(i), paint();
        };
      }
      show.undo = () => chosen.length && mode2 === "check" && (chosen.pop(), paint());
      paint();
    }
  };

  const finish = () => {
    sfx.done();
    launchConfetti();
    document.body.classList.remove("focus");
    const accuracy = Math.round((100 * total) / (total + mistakes));
    $app.innerHTML = `<section class="card finish">
      <span class="finish-icon">${review ? I.cards : I.cup}</span>
      <h1>${review ? "Review complete!" : mode === "practice" ? "Practice complete!" : "Lesson complete!"}</h1>
      <p class="muted">${review ? `${total} word${total === 1 ? "" : "s"} reviewed` : `${esc(lesson.unitTitle)} · ${esc(lesson.title)}`}</p>
      <div class="finish-stats">
        <div class="fstat xp"><span>Total XP</span><b>${I.bolt}${xpEarned}</b></div>
        <div class="fstat acc"><span>Accuracy</span><b>${accuracy}%</b></div>
        ${review ? `<div class="fstat hp"><span>Still due</span><b>${stats.due}</b></div>` : `<div class="fstat hp"><span>Hearts</span><b>${I.heart}${stats.hearts}</b></div>`}
      </div>
      <div id="unit-feedback"></div>
      <div class="row" style="justify-content:center">${review && stats.due ? `<a class="btn big outline" href="#/learn/review" id="more">Review more</a>` : ""}<a class="btn big" href="${courseBack}">Continue</a></div>
    </section>`;
    document.getElementById("more")?.addEventListener("click", (e) => (e.preventDefault(), renderReview()));
    if (review) return;
    // Finished the whole deck? Ask how it was (once).
    api("/learn")
      .then(({ units }) => {
        const u = units.find((x) => x.id === lesson.unitId);
        const done = u && u.lessons.length > 0 && u.lessons.every((l) => l.total > 0 && l.done >= l.total);
        const slot = document.getElementById("unit-feedback");
        if (!done || u.feedbackSent || !slot) return;
        slot.innerHTML = `<div class="unit-done compact"><div><b>You finished the deck “${esc(u.title)}”!</b><p class="muted small">Is there anything we should change? Your suggestion goes straight to the people who write the lessons.</p></div><button class="btn outline small" id="finish-fb">Suggest an improvement</button></div>`;
        document.getElementById("finish-fb").onclick = () => openFeedback(u, 0, () => (slot.innerHTML = `<p class="unit-thanks">${I.check} Thanks for your feedback!</p>`));
      })
      .catch(() => {});
  };

  /** "knyga = book" with the word's note, for the feedback footer. */
  const pairHtml = (w) => `<span class="pair"><b${L()}>${esc(w.lt)}</b> = ${esc(w.en)}${w.note ? `<br><span class="note">${esc(w.note)}</span>` : ""}</span>`;

  action.onclick = async () => {
    if (mode2 === "continue") {
      const c = queue.shift();
      if (c.retry) queue.push(c);
      if (!queue.length) return finish();
      return show();
    }
    if (!answer) return;
    action.disabled = true;
    let res;
    try {
      res = await api(`/learn/words/${challenge.wordId}/answer`, { method: "POST", body: { kind: challenge.kind, review, ...answer() } });
    } catch (x) {
      action.disabled = false;
      if (x.status === 403) {
        stats.hearts = 0;
        setHearts();
        return outOfHearts();
      }
      return toast(x.message);
    }
    stats = res.stats;
    setHearts();
    mode2 = "continue";
    action.textContent = "Continue";
    const input = document.getElementById("typed");
    if (input) input.readOnly = true;
    const isPick = challenge.kind.startsWith("pick");
    if (isPick) {
      for (const o of stage.querySelectorAll(".option")) {
        if (Number(o.dataset.id) === res.correctOptionId) o.classList.add("right");
        else if (o.getAttribute("aria-pressed") === "true") o.classList.add("wrong");
        o.setAttribute("aria-pressed", "false"); // the right/wrong colours replace the "selected" one
      }
    }
    if (res.correct) {
      sfx.right();
      solved++;
      xpEarned += res.xp;
      challenge.retry = false;
      setProgress();
      foot.className = "lesson-foot right";
      const head = { accents: "Correct! Mind the accents:", typo: "Correct! Watch the spelling:" }[res.verdict];
      const extra = res.xp ? `+${res.xp} XP${res.practice ? " · +1 heart" : ""}` : review ? "Not due yet, so no XP" : "";
      feedback.innerHTML = `<span class="fb-icon">${I.tick}</span><div><b>${head ? `${head} <span${L()}>${esc(res.expected)}</span>` : "Nicely done!"}</b>${pairHtml(res.word)}${extra ? `<span>${extra}</span>` : ""}</div>`;
    } else {
      sfx.wrong();
      mistakes++;
      challenge.retry = true; // comes back at the end of the queue
      foot.className = "lesson-foot wrong";
      const right = challenge.kind === "pick_en" ? esc(res.word.en) : `<span${L()}>${esc(res.word.lt)}</span>`;
      const mixup = res.confused ? `<span>You wrote <b${L()}>${esc(res.confused.lt)}</b>, which means “${esc(res.confused.en)}”.</span>` : "";
      feedback.innerHTML = `<span class="fb-icon">${I.close}</span><div><b>Correct answer: ${right}</b>${mixup}${pairHtml(res.word)}<span>${safe ? "It'll come back at the end." : "You lost a heart. It'll come back at the end."}</span></div>`;
      if (!safe && stats.hearts <= 0) {
        action.disabled = true;
        return outOfHearts();
      }
    }
    action.disabled = false;
    action.focus();
  };

  // Keyboard: Enter = Check/Continue, 1-9 = pick an option, Backspace = take back the last tile.
  const onKey = (e) => {
    if (!document.getElementById("stage")) return removeEventListener("keydown", onKey);
    const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
    if (e.key === "Enter" && !action.disabled) {
      e.preventDefault();
      action.click();
    } else if (!typing && challenge?.kind.startsWith("pick") && /^[1-9]$/.test(e.key)) {
      stage.querySelectorAll(".option")[Number(e.key) - 1]?.click();
    } else if (!typing && challenge?.kind === "build" && e.key === "Backspace") {
      e.preventDefault();
      show.undo?.();
    }
  };
  addEventListener("keydown", onKey);

  setProgress();
  show();
}

// ---------------------------------------------------------------- your words

async function renderWords() {
  $app.innerHTML = `<p class="muted loading">Loading your words…</p>`;
  let data;
  try {
    data = await api("/learn/words");
  } catch (x) {
    $app.innerHTML = errorCard(x.message);
    return;
  }
  const { units, stats, now } = data;
  course = data.course;
  const allWords = units.flatMap((u) => u.lessons.flatMap((l) => l.words));
  let filter = "all";
  let query = "";
  const status = (w) => (!w.learned ? "new" : w.dueAt <= now ? "due" : "later");
  const matches = (w) => (filter === "all" || status(w) === filter || (filter === "learned" && w.learned)) && (!query || `${w.lt} ${w.en}`.toLowerCase().includes(query));

  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><a class="back" href="#/learn">${I.back} Learn</a><h1>Your words${course ? ` <span class="muted">· ${esc(course.title)}</span>` : ""}</h1><p class="muted">${stats.learned} of ${allWords.length} learned · ${stats.due} due for review</p></div>
      <div class="toolbar-actions">${stats.due ? `<a class="btn" href="#/learn/review">${I.refresh} Review ${stats.due} now</a>` : ""}</div>
    </div>
    <section class="card words-filter">
      <div class="segmented" role="radiogroup" aria-label="Show">
        ${[["all", "All"], ["learned", "Learned"], ["due", "Due"], ["new", "Not yet"]].map(([k, l]) => `<button role="radio" data-f="${k}" aria-checked="${k === filter}">${l}</button>`).join("")}
      </div>
      <input type="text" id="w-search" placeholder="Search ${esc(toLang())} or English…" aria-label="Search words">
    </section>
    <div id="w-list" class="words-units"></div>`;

  const draw = () => {
    const html = units
      .map((u) => {
        const words = u.lessons.flatMap((l) => l.words).filter(matches);
        if (!words.length) return "";
        const learned = u.lessons.flatMap((l) => l.words).filter((w) => w.learned).length;
        const total = u.lessons.reduce((n, l) => n + l.words.length, 0);
        return `<section class="card words-unit">
          <div class="list-head"><h3>${levelChip(u.level)} ${esc(u.title)}</h3><span class="muted small">${learned}/${total} learned</span></div>
          <ul class="word-list">${words
            .map((w) => {
              const s = status(w);
              const badge = s === "new" ? `<span class="pill">not yet</span>` : s === "due" ? `<span class="pill due">due</span>` : `<span class="pill ok" title="Next review">${fmtUntil(w.dueAt, now)}</span>`;
              return `<li class="${s}"><span class="w-lt"${L()}><button type="button" class="icon-btn w-speak" data-text="${esc(w.lt)}" title="Listen to pronunciation" aria-label="Listen to pronunciation">${FC_ICONS.speaker}</button>${esc(w.lt)}</span><span class="w-en">${esc(w.en)}${w.note ? `<small>${esc(w.note)}</small>` : ""}</span>${w.pos !== "phrase" ? wordTag(w) : "<span></span>"}${badge}</li>`;
            })
            .join("")}</ul>
        </section>`;
      })
      .join("");
    const listEl = document.getElementById("w-list");
    listEl.innerHTML = html || `<section class="card picker"><p class="muted center">No words match.</p></section>`;
    listEl.querySelectorAll(".w-speak").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        speakWord(btn.dataset.text, "lt-LT", btn);
      };
    });
  };
  for (const b of $app.querySelectorAll("[data-f]")) {
    b.onclick = () => {
      filter = b.dataset.f;
      for (const x of $app.querySelectorAll("[data-f]")) x.setAttribute("aria-checked", String(x === b));
      draw();
    };
  }
  document.getElementById("w-search").oninput = (e) => {
    query = e.target.value.trim().toLowerCase();
    draw();
  };
  draw();
}

// ---------------------------------------------------------------- leaderboard

async function renderLeaderboard() {
  const period = location.hash.includes("all") ? "all" : "week";
  $app.innerHTML = `<p class="muted loading">Loading leaderboard…</p>`;
  let data;
  try {
    data = await api(`/leaderboard?period=${period}`);
  } catch (x) {
    $app.innerHTML = errorCard(x.message);
    return;
  }
  $app.innerHTML = `
    <section class="card board-page">
      <header class="picker-head"><h2>${period === "week" ? "This week's top learners" : "All-time top learners"}</h2><p class="muted">Earn XP in lessons and reviews, in any course. ${period === "week" ? "Resets every Monday." : ""}</p></header>
      <div class="segmented" role="tablist" style="margin:0 auto">
        <a role="tab" href="#/leaderboard" aria-selected="${period === "week"}">Weekly</a>
        <a role="tab" href="#/leaderboard/all" aria-selected="${period === "all"}">All time</a>
      </div>
      ${boardHtml(data.rows, 20)}
      ${data.me && !data.rows.some((r) => r.isYou) ? `<p class="muted center">You're #${data.me.rank} with ${data.me.xp} XP.</p>` : ""}
      ${!data.me ? `<div class="row" style="justify-content:center"><a class="btn" href="#/learn">Start learning</a></div>` : ""}
    </section>`;
}

// ---------------------------------------------------------------- accounts and courses: links, cards, follow buttons

I.verified = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.2 1.6 2.7-.2.9 2.6 2.3 1.5-.9 2.6.9 2.6-2.3 1.5-.9 2.6-2.7-.2L10 18.5l-2.2-1.6-2.7.2-.9-2.6-2.3-1.5.9-2.6-.9-2.6 2.3-1.5.9-2.6 2.7.2z" fill="#3b82f6"/><path d="M6.6 10.2l2.2 2.2 4.6-4.8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.upload = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m-4 4 4-4 4 4M4 13v3h12v-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.download = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m-4-4 4 4 4-4M4 13v3h12v-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const officialBadge = (u) => (u?.official ? `<span class="official" title="Official account">${I.verified}</span>` : "");
const userLink = (u) => (u?.username ? `<a class="user-link" href="#/u/${esc(u.username)}">${esc(u.name)}${officialBadge(u)}</a>` : esc(u?.name ?? ""));
/** Two letters for a course's badge: its language code, or the start of its language. */
const flag = (c) => (c.toCode || c.toLang || "?").slice(0, 2).toUpperCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why a course matched a search, when it wasn't its title. */
const matchLabel = (m) =>
  !m || m.in === "title"
    ? null
    : { language: "Matches the language", creator: "Matches the creator", description: "Matches the description", deck: `Deck: ${m.text ?? ""}`, word: `Has “${m.text ?? ""}”` }[m.in];

function courseCard(c) {
  const locked = c.locked && !c.hasAccess;
  const empty = !c.words && !c.mine;
  const tag = matchLabel(c.match) ?? (empty ? "No lessons yet" : locked ? "🔒 Locked" : c.isCurrent ? "Learning now" : c.enrolled ? "Enrolled" : c.creator.official ? "Official" : c.learners >= 3 ? "Popular" : "New");
  const pct = c.words ? Math.round((100 * (c.learned ?? 0)) / c.words) : 0;
  const button = empty
    ? `<a class="btn small outline" href="#/course/${c.id}">View</a>`
    : locked
    ? `<a class="btn small" href="#/course/${c.id}">${ICON.lock} Unlock</a>`
    : c.enrolled
    ? `<button class="btn small" data-continue="${c.id}">${c.isCurrent ? "Continue" : "Switch to it"}</button>`
    : `<button class="btn small" data-enroll="${c.id}">Start</button>`;
  return `<article class="pcard">
    <div class="tile-art ${tint(c.id)}">
      <span class="tag-chip">${tag}</span>
      <span class="lang-orb">${esc(flag(c))}</span>
      <h3 title="${esc(c.title)}"><a href="#/course/${c.id}">${esc(c.title)}</a></h3>
      <p>${esc(c.description)}</p>
      <div class="meta"><span>${esc(c.fromLang)} → ${esc(c.toLang)}</span><span>${plural(c.words, "word")}</span><span>${plural(c.learners, "learner")}</span></div>
      ${c.enrolled ? `<div class="progress-line"><div class="row spread"><span>Progress</span><span>${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>` : `<div class="progress-line" aria-hidden="true"></div>`}
    </div>
    <div class="pcard-foot"><span>by ${userLink(c.creator)}${c.hidden ? ` <span class="pill due">hidden</span>` : ""}</span>${button}</div>
  </article>`;
}

/** Redeems an access code; on success the course opens on the Learn page. */
async function redeemCode(code, errEl) {
  try {
    const { course: c } = await api("/redeem", { method: "POST", body: { code } });
    toast(`Unlocked “${c.title}”. Enjoy!`);
    location.hash = "#/learn";
  } catch (x) {
    if (errEl) {
      errEl.textContent = x.message;
      errEl.hidden = false;
    } else toast(x.message);
  }
}

const codeFormHtml = (id, label = "Access code") => `<form class="code-form" id="${id}">
    <input type="text" placeholder="XXXXX-XXXXX-XXXXX" aria-label="${label}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40">
    <button class="btn">Unlock</button>
    <p class="error" hidden></p>
  </form>`;

function wireCodeForm(id) {
  const f = document.getElementById(id);
  if (!f) return;
  f.onsubmit = (e) => {
    e.preventDefault();
    const code = f.querySelector("input").value.trim();
    if (code) redeemCode(code, f.querySelector(".error"));
  };
}

function wireCourseCards(root = $app) {
  for (const b of root.querySelectorAll("[data-enroll]")) {
    b.onclick = async () => {
      try {
        await api(`/courses/${b.dataset.enroll}/enroll`, { method: "POST", body: {} });
        toast("You're in! Your path is ready.");
        location.hash = `#/learn/course/${b.dataset.enroll}`;
      } catch (x) {
        toast(x.message);
      }
    };
  }
  for (const b of root.querySelectorAll("[data-continue]")) {
    b.onclick = async () => {
      try {
        await api("/learn/current", { method: "POST", body: { courseId: Number(b.dataset.continue) } });
        location.hash = `#/learn/course/${b.dataset.continue}`;
      } catch (x) {
        toast(x.message);
      }
    };
  }
}

const followBtn = (u) =>
  u.isYou ? "" : `<button class="btn small ${u.youFollow ? "outline" : ""}" data-follow="${esc(u.username)}" data-on="${u.youFollow}">${u.youFollow ? "Following" : "Follow"}</button>`;

/** Follow/unfollow buttons; updates every follower count shown for that account. */
function wireFollow(root = $app) {
  for (const b of root.querySelectorAll("[data-follow]")) {
    b.onclick = async () => {
      const on = b.dataset.on === "true";
      b.disabled = true;
      try {
        const u = await api(`/users/${encodeURIComponent(b.dataset.follow)}/follow`, { method: on ? "DELETE" : "POST", body: on ? undefined : {} });
        for (const x of document.querySelectorAll(`[data-follow="${CSS.escape(u.username)}"]`)) {
          x.dataset.on = String(u.youFollow);
          x.textContent = u.youFollow ? "Following" : "Follow";
          x.classList.toggle("outline", u.youFollow);
        }
        for (const x of document.querySelectorAll(`[data-followers="${CSS.escape(u.username)}"]`)) x.textContent = u.followers;
        if (u.youFollow) toast(`You'll see new courses from ${u.name} on your Learn page`);
      } catch (x) {
        toast(x.message);
      } finally {
        b.disabled = false;
      }
    };
  }
}

function profileMini(u) {
  return `<div class="profile-mini">
    <a href="#/u/${esc(u.username)}" class="profile-mini-head">${avatar(u)}<span><b>${esc(u.name)}${officialBadge(u)}</b><br><span class="muted small">@${esc(u.username)}</span></span></a>
    ${u.bio ? `<p class="muted small">${esc(u.bio)}</p>` : ""}
    <div class="row spread"><span class="muted small"><b data-followers="${esc(u.username)}">${u.followers}</b> followers</span>${followBtn(u)}</div>
  </div>`;
}

// ---------------------------------------------------------------- Discover

async function renderDiscover() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const f = { tab: params.get("tab") ?? "popular", q: params.get("q") ?? "", langs: new Set(), official: false, sort: "learners" };
  let courses = [];
  $app.innerHTML = `
    <div class="discover">
      <div class="discover-main">
        <section class="discover-hero">
          <h2>Find your next course</h2>
          <p>Courses by us and by learners like you. Follow creators to see their new courses first, or <a href="#/studio">make your own</a>.</p>
          <form class="discover-search" id="d-form" role="search">
            <div class="search-input-wrap">
              <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m13.2 13.2 3.3 3.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              <input type="search" id="d-q" value="${esc(f.q)}" placeholder="Search by course, language, creator…" aria-label="Search courses" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
              <button type="button" class="search-clear-btn" id="d-clear" aria-label="Clear search" ${f.q ? "" : "hidden"}>${I.close}</button>
            </div>
            <button class="btn search-btn">Search</button>
          </form>
        </section>
        <section class="people-row" id="d-people" hidden></section>
        <div class="course-grid pastel" id="d-list"><p class="muted loading">Loading…</p></div>
      </div>
      <aside class="card filters" aria-label="Filters">
        <div class="widget-head"><h3>Filters</h3><button type="button" class="linkbtn small" id="f-clear">Clear</button></div>
        <div class="active-filters" id="f-active"></div>
        <div class="filter-group"><span>Show</span>
          ${[["popular", "All courses"], ["following", "From people I follow"], ["enrolled", "My courses"]].map(([k, l]) => `<label><input type="radio" name="f-tab" value="${k}" ${k === f.tab ? "checked" : ""}> ${l}</label>`).join("")}
        </div>
        <div class="filter-group" id="f-langs"><span>Language</span></div>
        <div class="filter-group"><span>Made by</span><label><input type="checkbox" id="f-official"> Official courses only</label></div>
        <div class="filter-group"><span>Sort by</span>
          ${[["learners", "Most learners"], ["updatedAt", "Recently updated"], ["words", "Most words"]].map(([k, l]) => `<label><input type="radio" name="f-sort" value="${k}" ${k === f.sort ? "checked" : ""}> ${l}</label>`).join("")}
        </div>
        <details class="code-callout-collapsible">
          <summary class="small muted">${ICON.lock} Have an access code?</summary>
          <div class="code-callout-inner">
            <p class="muted small">Enter your invite code to unlock a private course.</p>
            ${codeFormHtml("discover-code")}
          </div>
        </details>
      </aside>
    </div>`;
  const list = document.getElementById("d-list");
  const empty = {
    popular: "No courses match. Try fewer words, or another spelling.",
    following: `Follow creators to see their courses here. Start with the official account: <a href="#/u/vokab">@vokab</a>.`,
    enrolled: "You haven't started a course yet.",
  };
  let people = [];
  const drawPeople = () => {
    const box = document.getElementById("d-people");
    box.hidden = !people.length;
    box.innerHTML = people.length
      ? `<h3>People</h3><div class="people-cards">${people
          .map(
            (u) => `<div class="card person-card"><a href="#/u/${esc(u.username)}" class="profile-mini-head">${avatar(u)}<span><b>${esc(u.name)}${officialBadge(u)}</b><br><span class="muted small">@${esc(u.username)} · <span data-followers="${esc(u.username)}">${u.followers}</span> followers</span></span></a>${followBtn(u)}</div>`,
          )
          .join("")}</div>`
      : "";
    wireFollow(box);
  };
  const draw = () => {
    const shown = courses
      .filter((c) => (!f.langs.size || f.langs.has(c.toLang)) && (!f.official || c.creator.official))
      .sort((a, b) => (f.sort === "learners" ? (b.creator.official - a.creator.official) * 1e9 : 0) + (b[f.sort] - a[f.sort]));
    list.innerHTML = shown.length ? shown.map(courseCard).join("") : `<section class="card picker"><p class="muted center">${empty[f.tab]}</p></section>`;
    wireCourseCards(list);
    const chips = [...f.langs].map((l) => ["lang", l, l]);
    if (f.official) chips.push(["official", "", "Official"]);
    if (f.q) chips.push(["q", "", `“${f.q}”`]);
    document.getElementById("f-active").innerHTML = chips.map(([k, v, l]) => `<button type="button" data-off="${k}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} ✕</button>`).join("");
    for (const b of document.querySelectorAll("[data-off]")) {
      b.onclick = () => {
        if (b.dataset.off === "lang") f.langs.delete(b.dataset.v);
        if (b.dataset.off === "official") f.official = document.getElementById("f-official").checked = false;
        if (b.dataset.off === "q") return ((document.getElementById("d-q").value = ""), (f.q = ""), load());
        syncLangBoxes();
        draw();
      };
    }
  };
  const syncLangBoxes = () => {
    for (const cb of document.querySelectorAll("#f-langs input")) cb.checked = f.langs.has(cb.value);
  };
  const load = async () => {
    list.innerHTML = `<p class="muted loading">Loading…</p>`;
    try {
      const asked = f.q;
      const res = await api(`/courses?tab=${f.tab}&q=${encodeURIComponent(asked)}`);
      if (asked !== f.q) return; // a newer search is on its way
      ({ courses, people } = res);
      history.replaceState(null, "", `#/discover?${new URLSearchParams({ ...(f.tab !== "popular" ? { tab: f.tab } : {}), ...(f.q ? { q: f.q } : {}) })}`);
    } catch (x) {
      return toast(x.message);
    }
    drawPeople();
    const langs = [...new Set(courses.map((c) => c.toLang))].sort();
    document.getElementById("f-langs").innerHTML =
      `<span>Language</span>` + (langs.map((l) => `<label><input type="checkbox" value="${esc(l)}" ${f.langs.has(l) ? "checked" : ""}> ${esc(l)}</label>`).join("") || `<span class="muted small">—</span>`);
    for (const cb of document.querySelectorAll("#f-langs input")) cb.onchange = () => ((cb.checked ? f.langs.add(cb.value) : f.langs.delete(cb.value)), draw());
    draw();
  };
  wireCodeForm("discover-code");
  const qInput = document.getElementById("d-q");
  const clearBtn = document.getElementById("d-clear");
  const syncClear = () => {
    if (clearBtn) clearBtn.hidden = !qInput.value;
  };

  if (clearBtn) {
    clearBtn.onclick = () => {
      qInput.value = "";
      f.q = "";
      syncClear();
      qInput.focus();
      load();
    };
  }

  document.getElementById("d-form").onsubmit = (e) => {
    e.preventDefault();
    f.q = qInput.value.trim();
    syncClear();
    load();
  };
  // Search as you type (after a short pause).
  let typing;
  qInput.oninput = (e) => {
    syncClear();
    clearTimeout(typing);
    typing = setTimeout(() => {
      if (e.target.value.trim() === f.q) return;
      f.q = e.target.value.trim();
      load();
    }, 280);
  };
  for (const r of document.querySelectorAll('input[name="f-tab"]')) r.onchange = () => ((f.tab = r.value), load());
  for (const r of document.querySelectorAll('input[name="f-sort"]')) r.onchange = () => ((f.sort = r.value), draw());
  document.getElementById("f-official").onchange = (e) => ((f.official = e.target.checked), draw());
  document.getElementById("f-clear").onclick = () => {
    f.langs.clear();
    f.official = document.getElementById("f-official").checked = false;
    f.q = qInput.value = "";
    syncClear();
    load();
  };
  load();
}

// ---------------------------------------------------------------- a course's page

async function renderCourse(id) {
  $app.innerHTML = `<p class="muted loading">Loading course…</p>`;
  let d;
  try {
    d = await api(`/courses/${id}`);
  } catch (x) {
    $app.innerHTML = errorCard(x.message, ["#/discover", "Back to Discover"]);
    return;
  }
  const c = d.course;
  $app.innerHTML = `
    <div class="toolbar">
      <a class="back" href="#/discover">${I.back} Discover</a>
      <div class="toolbar-actions">
        ${d.canEdit ? `<a class="btn outline" href="#/studio/${c.id}">${I.edit} Edit course</a>` : ""}
        ${
          c.locked && !c.hasAccess
            ? ""
            : c.enrolled
              ? `<button class="btn outline" id="leave">Leave course</button><button class="btn" data-continue="${c.id}">Continue learning</button>`
              : `<button class="btn" data-enroll="${c.id}">Start learning</button>`
        }
      </div>
    </div>
    <div class="course-page">
      <div class="course-page-main">
        <section class="card course-hero">
          <span class="course-flag big">${esc(flag(c))}</span>
          <div><h1>${esc(c.title)}${c.hidden ? ` <span class="pill due">hidden</span>` : ""}${c.locked ? ` <span class="pill">${ICON.lock} locked</span>` : ""}</h1>
            <p class="muted">${esc(c.fromLang)} → ${esc(c.toLang)} · ${plural(c.units, "deck")} · ${plural(c.words, "word")} · ${plural(c.learners, "learner")}</p>
            ${c.description ? `<p>${esc(c.description)}</p>` : ""}</div>
        </section>
        ${
          c.locked && !c.hasAccess
            ? `<section class="card unlock-card"><div><h3>${ICON.lock} This course is locked</h3><p class="muted small">Enter the access code you got from ${userLink(c.creator)}. Each code works once, for one person.</p></div>${codeFormHtml("unlock-form")}</section>`
            : ""
        }
        <section class="card list-card">
          <div class="list-head"><h3>Decks</h3></div>
          <ul class="rows">${
            d.units
              .map(
                (u, i) => `<li class="deck-row">${levelChip(u.level) || `<span class="level-chip">${i + 1}</span>`}<div><b>${esc(u.title)}</b>${u.description ? `<p class="muted small">${esc(u.description)}</p>` : ""}</div>
                  <span class="muted small">${u.learned ? `${u.learned}/` : ""}${plural(u.words, "word")}</span></li>`,
              )
              .join("") || `<li class="empty-row">No decks yet.</li>`
          }</ul>
        </section>
      </div>
      <aside class="card side-card">${d.creator ? `<h3>Made by</h3>${profileMini(d.creator)}` : ""}</aside>
    </div>`;
  wireCourseCards();
  wireFollow();
  wireCodeForm("unlock-form");
  document.getElementById("leave")?.addEventListener("click", async () => {
    if (!confirm("Leave this course? Your progress is kept if you come back.")) return;
    try {
      await api(`/courses/${c.id}/enroll`, { method: "DELETE" });
      renderCourse(c.id);
    } catch (x) {
      toast(x.message);
    }
  });
}

// ---------------------------------------------------------------- profiles

async function renderProfile(name) {
  $app.innerHTML = `<p class="muted loading">Loading profile…</p>`;
  let d;
  try {
    d = await api(`/users/${encodeURIComponent(name)}`);
  } catch (x) {
    $app.innerHTML = errorCard(x.message, ["#/discover", "Discover courses"]);
    return;
  }
  const u = d.user;
  $app.innerHTML = `
    <div class="profile">
      <section class="card profile-head">
        ${avatar(u).replace('class="avatar"', 'class="avatar big"')}
        <div class="profile-text">
          <h1>${esc(u.name)}${officialBadge(u)}</h1>
          <p class="muted">@${esc(u.username)}${u.official ? " · Official account" : ""}</p>
          ${u.bio ? `<p>${esc(u.bio)}</p>` : ""}
          <div class="row"><button class="linkbtn" data-list="followers"><b data-followers="${esc(u.username)}">${u.followers}</b> followers</button><button class="linkbtn" data-list="following"><b>${u.following}</b> following</button></div>
        </div>
        <div class="profile-actions">${u.isYou ? `<button class="btn outline" id="edit-profile">${I.edit} Edit profile</button>` : followBtn(u)}</div>
      </section>
      <form class="card form profile-edit" id="pf" hidden>
        <div class="form-two">
          <label class="field">Username <input type="text" id="pf-user" maxlength="20" value="${esc(u.username)}" autocomplete="off"></label>
          <label class="field">Bio <input type="text" id="pf-bio" maxlength="200" value="${esc(u.bio)}" placeholder="What you teach, what you're learning…"></label>
        </div>
        <p class="error" id="pf-err" hidden></p>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn outline" id="pf-cancel">Cancel</button><button class="btn">Save</button></div>
      </form>
      <div class="row spread section-row"><h2>${u.isYou ? "Your courses" : "Courses"}</h2>${u.isYou ? `<a class="btn small outline" href="#/studio">${I.plus} New course</a>` : ""}</div>
      <div class="course-grid">${d.courses.length ? d.courses.map(courseCard).join("") : `<section class="card picker"><p class="muted center">${u.isYou ? `You haven't made a course yet. <a href="#/studio">Open the Studio</a> to start one.` : "No courses yet."}</p></section>`}</div>
    </div>`;
  wireCourseCards();
  wireFollow();
  for (const b of $app.querySelectorAll("[data-list]")) b.onclick = () => openUserList(u, b.dataset.list);
  const form = document.getElementById("pf");
  document.getElementById("edit-profile")?.addEventListener("click", () => ((form.hidden = false), document.getElementById("pf-user").focus()));
  document.getElementById("pf-cancel").onclick = () => (form.hidden = true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById("pf-err");
    try {
      const p = await api("/me", { method: "PUT", body: { username: document.getElementById("pf-user").value.trim(), bio: document.getElementById("pf-bio").value } });
      me.username = p.username;
      me.bio = p.bio;
      toast("Profile saved");
      if (location.hash === `#/u/${p.username}`) renderProfile(p.username);
      else location.hash = `#/u/${p.username}`;
      renderNav();
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
    }
  };
}

async function openUserList(u, which) {
  let list;
  try {
    ({ users: list } = await api(`/users/${encodeURIComponent(u.username)}/${which}`));
  } catch (x) {
    return toast(x.message);
  }
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal card user-list" role="dialog" aria-modal="true" aria-labelledby="ul-title">
    <button type="button" class="icon-btn modal-close" aria-label="Close">${I.close}</button>
    <h2 id="ul-title">${which === "followers" ? `Following ${esc(u.name)}` : `${esc(u.name)} follows`}</h2>
    <ul class="people">${list.map((p) => `<li>${avatar(p)}<a href="#/u/${esc(p.username)}">${esc(p.name)}${officialBadge(p)}<br><span class="muted small">@${esc(p.username)}</span></a>${followBtn(p)}</li>`).join("") || `<li class="muted">Nobody yet.</li>`}</ul>
  </div>`;
  document.body.append(back);
  const close = () => back.remove();
  back.onclick = (e) => e.target === back && close();
  back.querySelector(".modal-close").onclick = close;
  addEventListener("hashchange", close, { once: true });
  wireFollow(back);
}

// ---------------------------------------------------------------- the Studio: your courses, and the course editor

const LANG_HINT = "Letters learners need that aren't on an English keyboard, separated by spaces (they become buttons under the answer box).";

function courseFormHtml(c = { title: "", description: "", fromLang: "English", toLang: "", toCode: "", letters: "" }) {
  return `
    <div class="form-two">
      <label class="field">Title <input type="text" id="c-title" maxlength="80" value="${esc(c.title)}" placeholder="Spanish for travellers" required></label>
      <label class="field">Teaches <input type="text" id="c-to" maxlength="30" value="${esc(c.toLang)}" placeholder="Spanish" required></label>
    </div>
    <div class="form-two">
      <label class="field">For speakers of <input type="text" id="c-from" maxlength="30" value="${esc(c.fromLang)}"></label>
      <label class="field">Language code <span class="muted small">(optional, e.g. es, lt, pt-br)</span><input type="text" id="c-code" maxlength="8" value="${esc(c.toCode)}" placeholder="es"></label>
    </div>
    <label class="field">Special letters <span class="muted small">${LANG_HINT}</span><input type="text" id="c-letters" maxlength="80" value="${esc(c.letters)}" placeholder="á é í ó ú ñ ¿ ¡"></label>
    <label class="field">Description <textarea id="c-desc" maxlength="300" placeholder="Who it's for and what they'll learn">${esc(c.description)}</textarea></label>`;
}

const courseFormValues = () => ({
  title: document.getElementById("c-title").value,
  toLang: document.getElementById("c-to").value,
  fromLang: document.getElementById("c-from").value,
  toCode: document.getElementById("c-code").value.trim(),
  letters: document.getElementById("c-letters").value,
  description: document.getElementById("c-desc").value,
});

async function renderStudioHome() {
  $app.innerHTML = `<p class="muted loading">Loading your courses…</p>`;
  let courses;
  let official = [];
  try {
    ({ courses } = await api("/courses?tab=mine"));
    // Admins edit the official account's courses too.
    if (me.isAdmin) official = (await api("/courses?tab=popular")).courses.filter((c) => c.creator.official && !c.mine);
  } catch (x) {
    $app.innerHTML = errorCard(x.message);
    return;
  }
  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><h1>Studio</h1><p class="muted">Make your own course: decks, lessons and words. Learners get the same lessons, review and duels as the official course, and your followers see it on their Learn page.</p></div>
      <div class="toolbar-actions">
        <label class="btn outline" title="Upload a course file exported from Vokab">${I.upload} Import .db<input type="file" id="import" accept=".db,.sqlite,application/vnd.sqlite3" hidden></label>
        <button class="btn" id="new-course">${I.plus} New course</button>
      </div>
    </div>
    <form class="card form new-course" id="nc" hidden>
      <h2>New course</h2>
      ${courseFormHtml()}
      <p class="error" id="nc-err" hidden></p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn outline" id="nc-cancel">Cancel</button><button class="btn">Create course</button></div>
    </form>
    <div class="course-grid">${
      courses.length
        ? courses
            .map(
              (c) => `<article class="card course-card">
                <a class="course-main" href="#/studio/${c.id}"><span class="course-flag">${esc(flag(c))}</span><div><h3>${esc(c.title)}</h3><p class="muted small">${esc(c.toLang)} · ${plural(c.units, "deck")} · ${plural(c.words, "word")} · ${plural(c.learners, "learner")}</p></div></a>
                <div class="course-foot">${c.hidden ? `<span class="pill due">hidden by an admin</span>` : `<a class="small" href="#/course/${c.id}">View as a learner</a>`}<a class="btn small" href="#/studio/${c.id}">${I.edit} Edit</a></div>
              </article>`,
            )
            .join("")
        : `<section class="card picker"><header class="picker-head"><span class="board-icon">${I.decks}</span><h2>No courses yet</h2><p class="muted">Create one from scratch, or import a course file someone shared with you.</p></header></section>`
    }</div>
    ${
      official.length
        ? `<div class="row spread section-row"><h2>Official courses</h2><span class="muted small">You can edit these as an admin</span></div>
          <div class="course-grid">${official
            .map(
              (c) => `<article class="card course-card">
                <a class="course-main" href="#/studio/${c.id}"><span class="course-flag">${esc(flag(c))}</span><div><h3>${esc(c.title)}</h3><p class="muted small">${esc(c.toLang)} · ${plural(c.units, "deck")} · ${plural(c.words, "word")} · ${plural(c.learners, "learner")}</p></div></a>
                <div class="course-foot"><span class="muted small">by ${userLink(c.creator)}</span><a class="btn small" href="#/studio/${c.id}">${I.edit} Edit</a></div>
              </article>`,
            )
            .join("")}</div>`
        : ""
    }`;
  const form = document.getElementById("nc");
  document.getElementById("new-course").onclick = () => ((form.hidden = false), document.getElementById("c-title").focus());
  document.getElementById("nc-cancel").onclick = () => (form.hidden = true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { course: c } = await api("/courses", { method: "POST", body: courseFormValues() });
      toast("Course created. Add your first deck!");
      location.hash = `#/studio/${c.id}`;
    } catch (x) {
      const err = document.getElementById("nc-err");
      err.textContent = x.message;
      err.hidden = false;
    }
  };
  document.getElementById("import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = await fetch("/api/courses/import", { method: "POST", headers: { "Content-Type": "application/vnd.sqlite3", "X-Requested-With": "labas" }, body: file, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      toast("Course imported");
      location.hash = `#/studio/${data.id}`;
    } catch (x) {
      toast(x.message);
    }
  };
}

const cms = { cid: null, content: null, lessonId: null, editing: null };

async function renderStudio(cid) {
  if (cms.cid !== cid) Object.assign(cms, { cid, lessonId: null, editing: null });
  $app.innerHTML = `<p class="muted loading">Loading course…</p>`;
  try {
    cms.content = await api(`/studio/${cid}/content`);
  } catch (x) {
    $app.innerHTML = errorCard(x.message, ["#/studio", "Back to Studio"]);
    return;
  }
  drawStudio();
}

/** Runs a content change; the server answers with the whole course. */
async function cmsDo(method, path, body) {
  try {
    cms.content = await api(`/studio/${cms.cid}${path}`, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
    return true;
  } catch (x) {
    toast(x.message);
    return false;
  }
}

function allLessons() {
  return cms.content.units.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u })));
}

/** Asks for a deck's title, level and description. Returns null when cancelled. */
function promptDeck(u = { title: "", level: "A1", description: "" }) {
  const title = prompt("Deck title:", u.title);
  if (!title) return null;
  const level = (prompt("Level (A1, A2, B1, B2…, or leave empty):", u.level) ?? u.level).trim().toUpperCase();
  const description = prompt("Short description (optional):", u.description) ?? u.description;
  return { title, level, description };
}

function studioToolbar(view) {
  const c = cms.content.course;
  return `
    <div class="toolbar">
      <div class="page-head"><a class="back" href="#/studio">${I.back} Studio</a><h1>${esc(c.title)}</h1><p class="muted">${esc(c.toLang)} · ${plural(c.units, "deck")} · ${plural(c.words, "word")} · ${plural(c.learners, "learner")}${c.mine ? "" : ` · by ${userLink(c.creator)}`}</p></div>
      <div class="toolbar-actions">
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected="${view === "content"}" data-view="content">Content</button>
          <button role="tab" aria-selected="${view === "arrange"}" data-view="arrange">Arrange</button>
          <button role="tab" aria-selected="${view === "feedback"}" data-view="feedback">Suggestions${cms.content.newFeedback ? ` <span class="count">${cms.content.newFeedback}</span>` : ""}</button>
          <button role="tab" aria-selected="${view === "settings"}" data-view="settings">Settings</button>
        </div>
        <a class="btn outline" href="#/course/${c.id}">View</a>
        ${view === "content" ? `<button class="btn" id="add-unit">${I.plus} New deck</button>` : ""}
      </div>
    </div>`;
}

function wireStudioTabs() {
  for (const b of $app.querySelectorAll("[data-view]")) b.onclick = () => ({ content: drawStudio, arrange: drawArrange, feedback: drawFeedback, settings: drawSettings })[b.dataset.view]();
}

function drawStudio() {
  course = cms.content.course;
  const units = cms.content.units;
  if (!allLessons().some((l) => l.id === cms.lessonId)) cms.lessonId = allLessons()[0]?.id ?? null;
  const tools = (kind, id) => `<span class="tools">
      <button class="icon-btn sm" data-move="${kind}:${id}:-1" title="Move up">${I.up}</button>
      <button class="icon-btn sm" data-move="${kind}:${id}:1" title="Move down">${I.down}</button>
      <button class="icon-btn sm" data-edit="${kind}:${id}" title="Edit">${I.edit}</button>
      <button class="icon-btn sm danger" data-del="${kind}:${id}" title="Delete">${I.trash}</button></span>`;
  const tree = units
    .map(
      (u, ui) => `<li class="tree-unit"><div class="tree-row unit-row"><span><span class="muted small">${u.level ? `${esc(u.level)} · ` : ""}Deck ${ui + 1}</span>${u.newFeedback ? ` <button class="count" data-goto-feedback title="New suggestions for this deck">${u.newFeedback} new</button>` : ""}<br><b>${esc(u.title)}</b></span>${tools("unit", u.id)}</div>
        <ul>${u.lessons
          .map((l) => `<li><div class="tree-row lesson-row ${l.id === cms.lessonId ? "active" : ""}" data-pick="${l.id}"><span>${esc(l.title)} <span class="muted small">(${l.words.length})</span></span>${tools("lesson", l.id)}</div></li>`)
          .join("")}
          <li><button class="linkbtn small" data-add-lesson="${u.id}">${I.plus} Add lesson</button></li></ul></li>`,
    )
    .join("");
  const lesson = allLessons().find((l) => l.id === cms.lessonId);

  $app.innerHTML = `${studioToolbar("content")}
    <div class="cms">
      <aside class="card cms-tree"><ul class="tree">${tree || `<li class="muted small">No decks yet. Add one with “New deck”!</li>`}</ul></aside>
      <section class="card cms-main" id="cms-main"></section>
    </div>`;
  wireStudioTabs();

  const main = document.getElementById("cms-main");
  if (cms.editing) drawWordForm(main, cms.editing);
  else if (lesson) {
    main.innerHTML = `
      <div class="list-head"><div><span class="muted small">${esc(lesson.unit.title)}</span><h2>${esc(lesson.title)}</h2></div>
        <button class="btn" id="add-word">${I.plus} Add word</button></div>
      <p class="muted small">Each word becomes four exercises: pick its meaning, pick the ${esc(toLang())}, type it, or (for phrases) build it from tiles.</p>
      <ul class="rows">${
        lesson.words
          .map(
            (w, i) => `<li class="ch-row"><span class="badge ${w.pos}">${esc(POS_LABELS[w.pos] ?? w.pos)}</span>
              <div><b${L()}>${i + 1}. ${esc(w.lt)}</b> <span class="muted">= ${esc(w.en)}</span> ${GENDERS[w.gender] ? `<span class="pill">${GENDERS[w.gender]}</span>` : ""}
                ${w.also || w.note ? `<p class="muted small">${w.also ? `Also accepted: <span${L()}>${esc(w.also.split(";").map((s) => s.trim()).join(", "))}</span>` : ""}${w.also && w.note ? " · " : ""}${esc(w.note)}</p>` : ""}</div>${tools("word", w.id)}</li>`,
          )
          .join("") || `<li class="empty-row">No words yet. Add the first one!</li>`
      }</ul>`;
    document.getElementById("add-word").onclick = () => {
      cms.editing = { lessonId: lesson.id, lt: "", en: "", pos: "noun", gender: "", also: "", note: "" };
      drawStudio();
    };
  } else main.innerHTML = `<p class="empty-row">${units.length ? "Add a lesson to a deck to start adding words." : "Start with a deck (a topic, like “At the café”), then add lessons and words to it."}</p>`;

  for (const b of $app.querySelectorAll("[data-goto-feedback]")) b.onclick = () => drawFeedback();
  document.getElementById("add-unit").onclick = async () => {
    const d = promptDeck();
    if (d && (await cmsDo("POST", "/units", d))) drawStudio();
  };
  for (const b of $app.querySelectorAll("[data-add-lesson]")) {
    b.onclick = async () => {
      const title = prompt("Lesson title:");
      if (title && (await cmsDo("POST", "/lessons", { unitId: Number(b.dataset.addLesson), title }))) {
        cms.lessonId = cms.content.units.find((u) => u.id === Number(b.dataset.addLesson))?.lessons.at(-1)?.id ?? cms.lessonId;
        drawStudio();
      }
    };
  }
  for (const r of $app.querySelectorAll("[data-pick]")) {
    r.onclick = (e) => {
      if (e.target.closest("button")) return;
      cms.lessonId = Number(r.dataset.pick);
      cms.editing = null;
      drawStudio();
    };
  }
  for (const b of $app.querySelectorAll("[data-move]")) {
    b.onclick = async () => {
      const [kind, id, dir] = b.dataset.move.split(":");
      if (await cmsDo("POST", "/move", { kind, id: Number(id), dir: Number(dir) })) drawStudio();
    };
  }
  for (const b of $app.querySelectorAll("[data-del]")) {
    b.onclick = async () => {
      const [kind, id] = b.dataset.del.split(":");
      const what = { unit: "this deck and all its lessons and words", lesson: "this lesson and its words", word: "this word" }[kind];
      if (confirm(`Delete ${what}? Learners' progress on it is deleted too.`) && (await cmsDo("DELETE", `/${kind}s/${id}`))) {
        cms.editing = null;
        drawStudio();
      }
    };
  }
  for (const b of $app.querySelectorAll("[data-edit]")) {
    b.onclick = async () => {
      const [kind, idStr] = b.dataset.edit.split(":");
      const id = Number(idStr);
      if (kind === "unit") {
        const d = promptDeck(units.find((x) => x.id === id));
        if (d && (await cmsDo("PUT", `/units/${id}`, d))) drawStudio();
      } else if (kind === "lesson") {
        const l = allLessons().find((x) => x.id === id);
        const title = prompt("Lesson title:", l.title);
        if (title != null && (await cmsDo("PUT", `/lessons/${id}`, { title }))) drawStudio();
      } else {
        const w = allLessons().flatMap((l) => l.words.map((x) => ({ ...x, lessonId: l.id }))).find((x) => x.id === id);
        cms.editing = { ...w };
        drawStudio();
      }
    };
  }
}

/** The course's details, locking and access codes, export, and deleting it. */
function drawSettings() {
  const c = cms.content.course;
  $app.innerHTML = `${studioToolbar("settings")}
    <div class="settings-grid">
      <form class="card form" id="cs">
        <h2>Course details</h2>
        ${courseFormHtml(c)}
        <label class="check"><input type="checkbox" id="c-locked" ${c.locked ? "checked" : ""}> <span><b>Locked</b>: learners need an access code to start the course. People already taking it keep access.</span></label>
        ${c.hidden ? `<p class="error">An admin has hidden this course: it isn't on Discover, and only you can open it.</p>` : ""}
        <p class="error" id="cs-err" hidden></p>
        <div class="row" style="justify-content:flex-end"><button class="btn">Save details</button></div>
      </form>
      <aside class="stack-sm">
        <section class="card side-card codes-card" id="codes-card">
          <div class="widget-head"><h3>Access codes</h3>${c.locked ? `<span class="pill">${ICON.lock} locked</span>` : `<span class="pill">open</span>`}</div>
          <p class="muted small">${c.locked ? "Give or sell a code to each learner. Each code opens the course once, for one person." : "Lock the course (on the left) so only people with a code can start it. You can create codes any time."}</p>
          <div class="stat-row two"><div><span>Unused</span><b id="t-unused">…</b></div><div><span>Used</span><b id="t-used">…</b></div></div>
          <form class="code-make" id="t-form"><label class="field">How many? <input type="number" id="t-count" min="1" max="500" value="10"></label><button class="btn small">Create codes</button></form>
          <p class="muted small">New codes download as a .txt file, one per line.</p>
          <div class="row"><a class="btn outline small" href="/api/studio/${c.id}/tokens.txt" download>${I.download} All unused (.txt)</a><button type="button" class="linkbtn small" id="t-revoke">Revoke unused</button></div>
          <details><summary class="small">Recently used</summary><ul class="rank-list" id="t-recent"><li class="muted small">Loading…</li></ul></details>
        </section>
        <section class="card side-card"><h3>Share or back up</h3><p class="muted small">Download the whole course as one SQLite file. Anyone can import it in their Studio as a new course of their own.</p><a class="btn outline small" href="/api/courses/${c.id}/export" download>${I.download} Export .db</a></section>
        <section class="card side-card danger-zone"><h3>Delete course</h3><p class="muted small">Deletes every deck, lesson and word, and learners' progress on them. This can't be undone.</p><button class="btn danger small" id="del-course">${I.trash} Delete course</button></section>
      </aside>
    </div>`;
  wireStudioTabs();
  document.getElementById("cs").onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...courseFormValues(), locked: document.getElementById("c-locked").checked };
    try {
      await api(`/courses/${c.id}`, { method: "PUT", body });
      cms.content = await api(`/studio/${c.id}/content`);
      toast("Saved");
      drawSettings();
    } catch (x) {
      const err = document.getElementById("cs-err");
      err.textContent = x.message;
      err.hidden = false;
    }
  };
  // Access codes.
  const showTokens = (t) => {
    document.getElementById("t-unused").textContent = t.unused;
    document.getElementById("t-used").textContent = t.used;
    if (t.recent)
      document.getElementById("t-recent").innerHTML =
        t.recent.map((r) => `<li><span class="n">${ICON.lock}</span>${r.user ? avatar(r.user) : "<span></span>"}<span>${r.user ? `<a href="#/u/${esc(r.user.username)}">${esc(r.user.name)}</a>` : "(deleted account)"}<br><code class="small">${esc(r.code)}</code></span><span class="xp">${fmtDate(r.usedAt)}</span></li>`).join("") ||
        `<li class="muted small">No codes used yet.</li>`;
  };
  api(`/studio/${c.id}/tokens`).then(showTokens).catch((x) => toast(x.message));
  document.getElementById("t-form").onsubmit = async (e) => {
    e.preventDefault();
    const count = Number(document.getElementById("t-count").value);
    try {
      const { codes, stats } = await api(`/studio/${c.id}/tokens`, { method: "POST", body: { count } });
      // Download this batch straight away.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([codes.join("\n") + "\n"], { type: "text/plain" }));
      a.download = `${c.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "course"}-codes-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`${plural(codes.length, "code")} created and downloaded`);
      showTokens(stats);
    } catch (x) {
      toast(x.message);
    }
  };
  document.getElementById("t-revoke").onclick = async () => {
    if (!confirm("Revoke every unused code? Anyone holding one won't be able to use it. Codes already used keep working.")) return;
    try {
      showTokens(await api(`/studio/${c.id}/tokens`, { method: "DELETE" }));
      toast("Unused codes revoked");
    } catch (x) {
      toast(x.message);
    }
  };
  document.getElementById("del-course").onclick = async () => {
    if (prompt(`Type the course title to delete it:\n${c.title}`) !== c.title) return toast("Not deleted");
    try {
      await api(`/courses/${c.id}`, { method: "DELETE" });
      toast("Course deleted");
      location.hash = "#/studio";
    } catch (x) {
      toast(x.message);
    }
  };
}

/** SortableJS (vendored, MIT), loaded the first time someone opens the Arrange tab. */
function loadSortable() {
  if (window.Sortable) return Promise.resolve(window.Sortable);
  return (loadSortable.p ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/sortable.min.js";
    s.onload = () => resolve(window.Sortable);
    s.onerror = () => reject(new Error("Couldn't load the drag-and-drop helper"));
    document.head.append(s);
  }));
}

I.grip = `<svg viewBox="0 0 20 20" aria-hidden="true"><g fill="currentColor"><circle cx="7.5" cy="5" r="1.4"/><circle cx="12.5" cy="5" r="1.4"/><circle cx="7.5" cy="10" r="1.4"/><circle cx="12.5" cy="10" r="1.4"/><circle cx="7.5" cy="15" r="1.4"/><circle cx="12.5" cy="15" r="1.4"/></g></svg>`;

/**
 * The Arrange view: decks as columns, lessons as cards. Drag a deck by its handle to reorder decks; drag a lesson
 * to reorder it or move it to another deck. Click a name to rename it; add decks and lessons in place.
 * (Keyboard users can also reorder with the up/down buttons in the Content view.)
 */
async function drawArrange() {
  const units = cms.content.units;
  const words = (l) => l.words.length;
  $app.innerHTML = `${studioToolbar("arrange")}
    <p class="muted arrange-help">Drag lessons to reorder them or move them to another deck. Drag a deck by ${I.grip.replace("<svg", '<svg class="inline-grip"')} to reorder decks. Click a name to rename it.</p>
    <div class="board" id="board">
      ${units
        .map(
          (u, ui) => `<section class="board-col card" data-unit="${u.id}">
            <header class="board-col-head">
              <span class="drag-handle deck-handle" title="Drag to reorder decks" aria-label="Drag to reorder decks">${I.grip}</span>
              <span class="module-no">${ui + 1}</span>
              <button class="rename" data-rename="unit:${u.id}" title="Rename">${esc(u.title)}</button>
              ${u.level ? `<span class="pill">${esc(u.level)}</span>` : ""}
              <button class="icon-btn sm danger" data-del-unit="${u.id}" title="Delete deck">${I.trash}</button>
            </header>
            <ul class="board-cards" data-unit="${u.id}">${u.lessons
              .map(
                (l) => `<li class="board-card" data-lesson="${l.id}">
                  <span class="drag-handle" aria-hidden="true">${I.grip}</span>
                  <button class="rename" data-rename="lesson:${l.id}" title="Rename">${esc(l.title)}</button>
                  <span class="muted small">${plural(words(l), "word")}</span>
                  <button class="icon-btn sm" data-open="${l.id}" title="Edit its words">${I.arrow}</button>
                </li>`,
              )
              .join("")}</ul>
            <form class="board-add" data-add-lesson-in="${u.id}"><input type="text" maxlength="80" placeholder="+ Add a lesson" aria-label="New lesson in ${esc(u.title)}"></form>
          </section>`,
        )
        .join("")}
      <form class="board-col board-new card" id="board-new-deck"><input type="text" maxlength="80" placeholder="+ New deck" aria-label="New deck"></form>
    </div>`;
  wireStudioTabs();

  const save = async (method, path, body) => {
    if (await cmsDo(method, path, body)) drawArrange();
    else drawArrange(); // put things back where the server has them
  };

  // Rename in place.
  for (const b of $app.querySelectorAll("[data-rename]")) {
    b.onclick = () => {
      const [kind, idStr] = b.dataset.rename.split(":");
      const id = Number(idStr);
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 80;
      input.value = b.textContent;
      input.className = "rename-input";
      b.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        const title = input.value.trim();
        if (!keep || !title || title === b.textContent) return input.replaceWith(b);
        if (kind === "unit") {
          const u = units.find((x) => x.id === id);
          save("PUT", `/units/${id}`, { title, level: u.level, description: u.description });
        } else save("PUT", `/lessons/${id}`, { title });
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      };
      input.onblur = () => finish(true);
    };
  }
  for (const f of $app.querySelectorAll("[data-add-lesson-in]")) {
    f.onsubmit = (e) => {
      e.preventDefault();
      const title = f.querySelector("input").value.trim();
      if (title) save("POST", "/lessons", { unitId: Number(f.dataset.addLessonIn), title });
    };
  }
  document.getElementById("board-new-deck").onsubmit = (e) => {
    e.preventDefault();
    const title = e.target.querySelector("input").value.trim();
    if (title) save("POST", "/units", { title, level: "", description: "" });
  };
  for (const b of $app.querySelectorAll("[data-del-unit]")) {
    b.onclick = () => {
      const u = units.find((x) => x.id === Number(b.dataset.delUnit));
      if (confirm(`Delete the deck “${u.title}” with all its lessons and words? Learners' progress on it is deleted too.`)) save("DELETE", `/units/${u.id}`);
    };
  }
  for (const b of $app.querySelectorAll("[data-open]")) {
    b.onclick = () => {
      cms.lessonId = Number(b.dataset.open);
      cms.editing = null;
      drawStudio();
    };
  }

  // Drag and drop.
  let Sortable;
  try {
    Sortable = await loadSortable();
  } catch (x) {
    return toast(x.message);
  }
  const board = document.getElementById("board");
  if (!board) return;
  Sortable.create(board, {
    draggable: ".board-col[data-unit]",
    handle: ".deck-handle",
    animation: 150,
    ghostClass: "drag-ghost",
    onEnd: (e) => {
      if (e.oldDraggableIndex === e.newDraggableIndex) return;
      save("POST", "/arrange", { kind: "unit", id: Number(e.item.dataset.unit), index: e.newDraggableIndex });
    },
  });
  for (const list of board.querySelectorAll(".board-cards")) {
    Sortable.create(list, {
      group: "lessons",
      draggable: ".board-card",
      filter: "button, input",
      preventOnFilter: false,
      animation: 150,
      ghostClass: "drag-ghost",
      emptyInsertThreshold: 24,
      onEnd: (e) => {
        if (e.from === e.to && e.oldIndex === e.newIndex) return;
        save("POST", "/arrange", { kind: "lesson", id: Number(e.item.dataset.lesson), unitId: Number(e.to.dataset.unit), index: e.newIndex });
      },
    });
  }
}

/** The "Suggestions" view: learners' deck feedback, newest first. */
async function drawFeedback(filter = "new") {
  let data;
  try {
    data = await api(`/studio/${cms.cid}/feedback?status=${filter}`);
  } catch (x) {
    return toast(x.message);
  }
  const catLabel = Object.fromEntries(FEEDBACK_CATEGORIES);
  $app.innerHTML = `${studioToolbar("feedback")}
    <section class="card cms-main">
      <div class="list-head"><div class="segmented" role="tablist" aria-label="Filter">
        ${["new", "done", "all"].map((f) => `<button role="tab" data-filter="${f}" aria-selected="${f === filter}">${{ new: "New", done: "Done", all: "All" }[f]}</button>`).join("")}
      </div><span class="muted small">${data.newCount} new</span></div>
      <ul class="rows">${
        data.items
          .map(
            (f) => `<li class="fb-row ${f.status}">${avatar({ name: f.user, picture: f.picture })}
              <div><div class="row"><a href="#/u/${esc(f.username)}"><b>${esc(f.user)}</b></a><span class="muted small">on <b>${esc(f.unitTitle)}</b> · ${fmtDate(f.createdAt)}</span>
                ${f.rating ? `<span class="mini-stars" aria-label="${f.rating} of 5 stars">${"★".repeat(f.rating)}<span>${"★".repeat(5 - f.rating)}</span></span>` : ""}
                ${f.category ? `<span class="pill">${esc(catLabel[f.category] ?? f.category)}</span>` : ""}</div>
                <p>${esc(f.text)}</p></div>
              <span class="tools">
                <button class="btn outline small" data-mark="${f.id}:${f.status === "new" ? "done" : "new"}">${f.status === "new" ? `${I.check} Mark done` : "Reopen"}</button>
                <button class="icon-btn sm danger" data-del-fb="${f.id}" title="Delete">${I.trash}</button>
              </span></li>`,
          )
          .join("") || `<li class="empty-row">${filter === "new" ? "No new suggestions. Learners can send one from any deck on their Learn page." : "Nothing here."}</li>`
      }</ul>
    </section>`;
  wireStudioTabs();
  for (const b of $app.querySelectorAll("[data-filter]")) b.onclick = () => drawFeedback(b.dataset.filter);
  for (const b of $app.querySelectorAll("[data-mark]")) {
    b.onclick = async () => {
      const [id, status] = b.dataset.mark.split(":");
      try {
        await api(`/studio/${cms.cid}/feedback/${id}`, { method: "PUT", body: { status } });
        drawFeedback(filter);
      } catch (x) {
        toast(x.message);
      }
    };
  }
  for (const b of $app.querySelectorAll("[data-del-fb]")) {
    b.onclick = async () => {
      if (!confirm("Delete this suggestion?")) return;
      try {
        await api(`/studio/${cms.cid}/feedback/${b.dataset.delFb}`, { method: "DELETE" });
        drawFeedback(filter);
      } catch (x) {
        toast(x.message);
      }
    };
  }
}

function drawWordForm(main, w) {
  main.innerHTML = `
    <div class="list-head"><h2>${w.id ? "Edit word" : "New word"}</h2><button class="btn outline small" id="cancel">Cancel</button></div>
    <form class="form" id="word-form">
      <div class="segmented" role="radiogroup" aria-label="Part of speech">
        ${Object.entries(POS_LABELS).map(([k, l]) => `<button type="button" role="radio" aria-checked="${w.pos === k}" data-pos="${k}">${l[0].toUpperCase() + l.slice(1)}</button>`).join("")}
      </div>
      <div class="form-two">
        <label class="field">${esc(toLang())} <input type="text" id="f-lt"${L()} maxlength="100" value="${esc(w.lt)}" required></label>
        <label class="field">English <input type="text" id="f-en" maxlength="100" value="${esc(w.en)}" placeholder="${w.pos === "phrase" ? "Where is the library?" : "book"}" required></label>
      </div>
      ${lettersHtml(course, "")}
      <label class="field" ${w.pos === "noun" ? "" : "hidden"}>Gender
        <select id="f-gender">${[["", "(none)"], ...Object.entries(GENDERS)].map(([k, l]) => `<option value="${k}" ${w.gender === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field">Also accepted <span class="muted small">(other correct answers, separated by ;)</span><input type="text" id="f-also"${L()} maxlength="200" value="${esc(w.also)}"></label>
      <label class="field">Note <span class="muted small">(shown after the answer: a second meaning, a usage tip…)</span><input type="text" id="f-note" maxlength="200" value="${esc(w.note)}"></label>
      <p class="error" id="f-err" hidden></p>
      <div class="pane-actions"><span class="muted small">Matching ignores capitals and punctuation. Missing accents still count, with a hint.</span><button class="btn" id="f-save">Save word</button></div>
    </form>`;
  const collect = () => {
    w.lt = document.getElementById("f-lt").value;
    w.en = document.getElementById("f-en").value;
    w.gender = document.getElementById("f-gender").value;
    w.also = document.getElementById("f-also").value;
    w.note = document.getElementById("f-note").value;
    return w;
  };
  let lastInput = document.getElementById("f-lt");
  for (const id of ["f-lt", "f-also"]) document.getElementById(id).onfocus = (e) => (lastInput = e.target);
  for (const k of main.querySelectorAll(".lt-key")) {
    k.onmousedown = (e) => e.preventDefault();
    k.onclick = () => {
      const s = lastInput.selectionStart ?? lastInput.value.length;
      lastInput.value = lastInput.value.slice(0, s) + k.dataset.ch + lastInput.value.slice(lastInput.selectionEnd ?? s);
      lastInput.setSelectionRange(s + k.dataset.ch.length, s + k.dataset.ch.length);
      lastInput.focus();
    };
  }
  document.getElementById("cancel").onclick = () => {
    cms.editing = null;
    drawStudio();
  };
  for (const b of main.querySelectorAll("[data-pos]")) {
    b.onclick = () => {
      collect().pos = b.dataset.pos;
      if (w.pos !== "noun") w.gender = "";
      drawWordForm(main, w);
    };
  }
  document.getElementById("word-form").onsubmit = async (e) => {
    e.preventDefault();
    collect();
    const body = { lessonId: w.lessonId, lt: w.lt, en: w.en, pos: w.pos, gender: w.gender, also: w.also, note: w.note };
    try {
      cms.content = await api(`/studio/${cms.cid}${w.id ? `/words/${w.id}` : "/words"}`, { method: w.id ? "PUT" : "POST", body });
      cms.editing = null;
      cms.lessonId = w.lessonId;
      toast("Saved");
      drawStudio();
    } catch (x) {
      const err = document.getElementById("f-err");
      err.textContent = x.message;
      err.hidden = false;
    }
  };
}

// ---------------------------------------------------------------- admins: every course, to moderate

async function renderAdmin() {
  if (!me.isAdmin) {
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Admins only</h2><p class="muted">Ask the site owner to add your email to ADMINS.</p></header></section>`;
    return;
  }
  $app.innerHTML = `<p class="muted loading">Loading courses…</p>`;
  let d;
  try {
    d = await api("/admin/courses");
  } catch (x) {
    $app.innerHTML = errorCard(x.message);
    return;
  }
  $app.innerHTML = `
    <div class="toolbar"><div class="page-head"><h1>Admin</h1><p class="muted">${plural(d.courses.length, "course")} · ${plural(d.players, "player")} · ${d.xpToday} XP earned today. Hide a course to take it off Discover; its creator still sees it. You can edit only the official courses.</p></div></div>
    <section class="card list-card">
      <ul class="rows">${d.courses
        .map(
          (c) => `<li class="admin-course ${c.hidden ? "is-hidden" : ""}"><span class="course-flag">${esc(flag(c))}</span>
            <div><a href="#/course/${c.id}"><b>${esc(c.title)}</b></a> ${c.hidden ? `<span class="pill due">hidden</span>` : ""}<br><span class="muted small">by ${userLink(c.creator)} · ${esc(c.toLang)} · ${plural(c.words, "word")} · ${plural(c.learners, "learner")} · updated ${fmtDate(c.updatedAt)}</span></div>
            <span class="tools">${c.creator.official ? `<a class="btn outline small" href="#/studio/${c.id}">${I.edit} Edit</a>` : `<a class="btn outline small" href="#/course/${c.id}">View</a>`}<button class="btn small ${c.hidden ? "" : "danger"}" data-hide="${c.id}">${c.hidden ? "Unhide" : "Hide"}</button></span></li>`,
        )
        .join("")}</ul>
    </section>`;
  for (const b of $app.querySelectorAll("[data-hide]")) {
    b.onclick = async () => {
      const c = d.courses.find((x) => x.id === Number(b.dataset.hide));
      try {
        await api(`/admin/courses/${c.id}`, { method: "PUT", body: { hidden: !c.hidden } });
        renderAdmin();
      } catch (x) {
        toast(x.message);
      }
    };
  }
}

// ---------------------------------------------------------------- theme switch (Light ⇄ Dark)

const SUN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function isDark() {
  return currentTheme() === "dark";
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {}
  drawThemeButton();
}

function drawThemeButton() {
  const btn = document.getElementById("theme");
  if (!btn) return;
  const dark = isDark();
  btn.innerHTML = dark ? SUN_ICON : MOON_ICON;
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

document.getElementById("theme").onclick = () => {
  setTheme(isDark() ? "light" : "dark");
  // Redraw the Google button in the matching style.
  if (!me && document.getElementById("gsi") && window.google?.accounts?.id && config.googleClientId) {
    document.getElementById("gsi").innerHTML = "";
    google.accounts.id.renderButton(document.getElementById("gsi"), { theme: isDark() ? "filled_black" : "outline", size: "large", shape: "rectangular", text: "signin_with", width: 260 });
  }
};
drawThemeButton();

// ---------------------------------------------------------------- routing

function route() {
  stopTimers();
  document.body.classList.remove("focus");
  document.querySelector(".modal-back")?.remove();
  renderNav();
  window.scrollTo(0, 0);
  if (!me) return renderLanding();
  const code = duelCodeFromHash();
  if (code) return renderDuel(code);
  const learnCourseId = /^#\/learn\/course\/(\d+)$/.exec(location.hash)?.[1];
  if (learnCourseId) return renderCoursePath(Number(learnCourseId));
  const lessonId = /^#\/learn\/lesson\/(\d+)$/.exec(location.hash)?.[1];
  if (lessonId) return renderLesson(Number(lessonId));
  if (location.hash.startsWith("#/learn/review")) return renderReview();
  if (location.hash.startsWith("#/learn/words")) return renderWords();
  const courseId = /^#\/course\/(\d+)$/.exec(location.hash)?.[1];
  if (courseId) return renderCourse(Number(courseId));
  const studioId = /^#\/studio\/(\d+)$/.exec(location.hash)?.[1];
  if (studioId) return renderStudio(Number(studioId));
  if (location.hash.startsWith("#/studio")) return renderStudioHome();
  const username = /^#\/u\/([A-Za-z0-9_]{1,40})$/.exec(location.hash)?.[1];
  if (username) return renderProfile(username);
  if (page() === "discover") return renderDiscover();
  if (page() === "learn") return renderEnrolledCourses();
  if (page() === "leaderboard") return renderLeaderboard();
  if (page() === "admin") return renderAdmin();
  if (page() !== "play") {
    history.replaceState(null, "", "#/learn");
    renderNav();
    return renderEnrolledCourses();
  }
  return renderPlayHub();
}

async function start() {
  try {
    [config, { user: me }] = await Promise.all([api("/config"), api("/me")]);
  } catch {
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Can't reach the server</h2><p class="muted">Is it running? Try again in a moment.</p></header></section>`;
    return;
  }
  route();
  addEventListener("hashchange", route);
  if (me) refreshTopStats();
}

start();
