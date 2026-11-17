// Labas front end: learn Lithuanian words, for English speakers. Signed out: a landing page with Google sign-in.
// Signed in: Learn (a path of decks and lessons, spaced-repetition review, your word list), Play (word duels with
// a friend), the leaderboard and, for admins, the content editor.
// Routes: #/ (landing), #/learn, #/learn/lesson/ID, #/learn/review, #/learn/words, #/play, #/duel/CODE,
// #/leaderboard, #/admin. No frameworks.

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
  B2: ["Upper intermediate", "Confident everyday Lithuanian"],
};
const GENDERS = { m: "masc.", f: "fem.", mpl: "masc. pl.", fpl: "fem. pl." };
const POS_LABELS = { noun: "noun", verb: "verb", phrase: "phrase", other: "word" };
const LT_LETTERS = ["ą", "č", "ę", "ė", "į", "š", "ų", "ū", "ž"];

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
  const head = { pick_en: "What does this mean?", pick_lt: "How do you say this in Lithuanian?", type_lt: "Write this in Lithuanian", build: "Translate this into Lithuanian" }[c.kind];
  return `<h1 class="q">${head}</h1>
    <div class="prompt-card"><span class="prompt-word"${lt ? ' lang="lt"' : ""}>${esc(c.prompt)}</span>${c.pos && c.pos !== "phrase" ? wordTag(c) : ""}</div>`;
}

function optionsHtml(c, picked) {
  return `<div class="options">${c.options
    .map((o, i) => `<button class="option" data-id="${o.id}" aria-pressed="${o.id === picked}"${c.kind === "pick_lt" ? ' lang="lt"' : ""}><span class="key">${i + 1}</span><span>${esc(o.text)}</span></button>`)
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
            (k) => `<li class="answer">${k.right ? I.ok : I.miss}<div><span class="found"${k.kind === "pick_en" ? ' lang="lt"' : ""}>${esc(k.prompt)}</span> → <b${k.kind === "pick_lt" ? ' lang="lt"' : ""}>${esc(k.answer)}</b>
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
  if (h.startsWith("#/play") || duelCodeFromHash()) return "play";
  return "home";
};

function renderNav() {
  const links = document.querySelector(".links");
  links.innerHTML = me
    ? `<a href="#/learn" data-nav="learn">Learn</a><a href="#/learn/review" data-nav="review">Review</a><a href="#/play" data-nav="play">Play</a><a href="#/leaderboard" data-nav="leaderboard">Leaderboard</a>${me.isAdmin ? `<a href="#/admin" data-nav="admin">Admin</a>` : ""}`
    : "";
  for (const a of links.querySelectorAll("a")) if (a.dataset.nav === page()) a.setAttribute("aria-current", "page");
  if (!me) {
    $account.innerHTML = `<a class="btn small" href="#signin" id="nav-signin">Sign in</a>`;
    document.getElementById("nav-signin").onclick = (e) => {
      e.preventDefault();
      document.getElementById("signin")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    return;
  }
  $account.innerHTML = `<span class="who">${avatar(me)}<span>${esc(me.name)}</span></span><button class="linkbtn" id="logout">Sign out</button>`;
  document.getElementById("logout").onclick = async () => {
    await api("/auth/logout", { method: "POST", body: {} });
    window.google?.accounts?.id?.disableAutoSelect?.();
    me = null;
    location.hash = "#/";
    route();
  };
}

// ---------------------------------------------------------------- landing page (signed out)

const EXAMPLES = [
  ["Kur yra biblioteka?", "Where is the library?"],
  ["Aš nesuprantu.", "I don't understand."],
  ["Vieną kavą išsinešti, prašau.", "One coffee to go, please."],
  ["Ar galiu mokėti kortele?", "Can I pay by card?"],
  ["Kuris autobusas važiuoja į centrą?", "Which bus goes to the city centre?"],
  ["Kiek tai kainuoja?", "How much does this cost?"],
  ["Man skauda galvą.", "I have a headache."],
  ["Skanaus!", "Enjoy your meal!"],
];

const FAQ = [
  ["Is it free?", "Yes. Sign in with Google and start learning. There's nothing to buy."],
  ["Do I need a Lithuanian keyboard?", "No. When you type an answer, buttons for ą, č, ę, ė, į, š, ų, ū and ž appear under the box. If you leave the accents off, the answer still counts, and we show you the right spelling."],
  ["What will I learn?", "Twelve themed decks of about 15–25 words each, from A1 (campus, dorm, café, buses, groceries) through A2 (doctor, part-time jobs, travel, food) to B1 (presentations, tech, careers). Each deck ends with phrases you can use straight away."],
  ["How does review work?", "Once you've learned a word, it comes back for review a day later, then after 3 days, then at longer and longer gaps. Get it wrong and it starts again. A few minutes a day keeps everything fresh."],
  ["How do hearts work?", "You start with 5 hearts and lose one for each wrong answer in a new lesson. A heart comes back every 30 minutes, and practising a finished lesson earns them back too. Review never costs hearts."],
  ["What's the difference between Learn and Play?", "Learn is your own path of short lessons, with review, XP and streaks. Play is a duel: you and a friend answer the same 10 words once, and whoever gets more right wins."],
  ["What do you store about me?", "Your Google name and profile picture (for the leaderboard), your email, the words you've learned and your XP, and your duel answers."],
];

const FEATURES = [
  ["learn", "12 themed decks", "Words for real student life in Lithuania, from your first lecture to your first job interview. A1 to B1."],
  ["cards", "Review that sticks", "Spaced repetition brings each word back just before you'd forget it."],
  ["heart", "Hearts keep you sharp", "Each wrong answer in a new lesson costs a heart. Practise finished lessons to earn them back."],
  ["fire", "Streaks and quests", "Learn a little every day to grow your streak, and hit XP goals along the way."],
  ["cup", "Weekly leaderboard", "Earn XP to climb the board. It resets every Monday, so anyone can win the week."],
  ["room", "Duel your friends", "Same 10 words, one try each. Whoever gets more right wins."],
];

function landingHtml() {
  const challenged = duelCodeFromHash();
  const node = (state, icon, label, x) => `<div class="mini-node ${state}" style="--x:${x}px"><span>${icon}</span><small>${esc(label)}</small></div>`;
  return `
    <div class="landing">
      ${challenged ? `<div class="notice">You've been challenged to word duel <b>${esc(challenged)}</b>. Sign in to play.</div>` : ""}
      <section class="card hero">
        <div>
          <span class="eyebrow">Free · No ads · For English speakers</span>
          <h1>Learn Lithuanian words, <em>one lesson at a time.</em></h1>
          <p class="lede">Short, game-like lessons built around student life in Lithuania: campus, dorm, café, bus and beyond. Keep your streak, review words before you forget them, and challenge friends to a word duel.</p>
          <div class="signin" id="signin"><div id="gsi" class="gsi-slot"></div><p id="signin-error" class="error" hidden></p>${
            config.devLogin
              ? `<form id="dev-login" class="dev-login"><input type="text" id="dev-name" placeholder="Your name (guest login)" maxlength="40" required><button class="btn outline">Play as guest</button></form>`
              : ""
          }<p class="fine">Sign in with Google to save your progress. We only use your name and picture.</p></div>
        </div>
        <div class="hero-demo" aria-hidden="true">
          <div class="demo-card">
            <div class="demo-top"><span class="demo-x">${I.close}</span><span class="demo-bar"><i></i></span><span class="demo-hearts">${I.heart}<b>4</b></span></div>
            <p class="demo-q">What does this mean?</p>
            <p class="demo-word" lang="lt">knyga <span class="wtag">noun · fem.</span></p>
            <div class="demo-opt"><span class="key">1</span>pencil</div>
            <div class="demo-opt picked"><span class="key">2</span>book</div>
            <div class="demo-opt"><span class="key">3</span>notebook</div>
            <div class="demo-foot"><span class="demo-ok">${I.tick}</span><div><b>Nicely done!</b><span>+10 XP</span></div></div>
          </div>
          <div class="float-chip streak">${I.fire}<b>7</b><span>day streak</span></div>
          <div class="float-chip xp">${I.bolt}<b>+10</b><span>XP</span></div>
        </div>
      </section>

      <section class="card section">
        <div class="section-head"><h2>Why it works</h2><p>Little and often beats cramming. Labas keeps you coming back, and keeps it fun.</p></div>
        <div class="features">${FEATURES.map(([icon, title, text]) => `<div class="feature"><span class="feature-icon fi-${icon}">${I[icon]}</span><h3>${title}</h3><p>${text}</p></div>`).join("")}</div>
      </section>

      <section class="card section path-section">
        <div class="path-copy">
          <span class="eyebrow">Learn</span>
          <h2>Follow your path</h2>
          <p class="muted">Work through decks like <b>University & Classroom</b>, <b>Student Housing</b> and <b>City Transit</b>. Each lesson first shows you the words, then asks you to type them in Lithuanian or build whole phrases from word tiles.</p>
          <ul class="checks">
            <li>${I.check} Lessons unlock as you go</li>
            <li>${I.check} Gender and part of speech for every word</li>
            <li>${I.check} On-screen ą č ę ė į š ų ū ž keys</li>
            <li>${I.check} 10 XP for every correct answer</li>
          </ul>
        </div>
        <div class="mini-path" aria-hidden="true">
          <div class="mini-banner"><small>A1 · Deck 1</small><b>University & Classroom</b></div>
          ${node("done", I.tick, "On campus", 0)}
          ${node("done", I.tick, "In class", 46)}
          ${node("current", I.star, "Study verbs", 0)}
          ${node("locked", I.lock, "Classroom phrases", -46)}
        </div>
      </section>

      <section class="card section">
        <div class="section-head"><span class="eyebrow">Play a friend</span><h2>Word duels</h2><p>Pick the decks, answer 10 words and send your friend the link. They get exactly the same questions.</p></div>
        <div class="duel-grid">
          <div class="hero-sheet duel-demo" aria-hidden="true">
            <div class="sheet">
              <div class="sheet-head"><span><b>Name :</b> You</span><span><b>Date :</b> ${fmtDate()}</span></div>
              <p class="muted small">Question 4 of 10 · A1 · Campus Cafeteria</p>
              <p class="demo-word" lang="lt">kava <span class="wtag">noun · fem.</span></p>
              <div class="demo-opt"><span class="key">1</span>tea</div>
              <div class="demo-opt picked"><span class="key">2</span>coffee</div>
            </div>
            <div class="hero-score">
              <div class="lead"><span>You</span><b>90 pts</b></div>
              <div><span>Sam</span><b>80 pts</b></div>
            </div>
          </div>
          <div class="duel-steps">
            <div class="step-row"><span class="tile-icon">${I.decks}</span><div><h3>1. Pick your decks</h3><p class="muted">Ten random words from the decks you choose, A1 to B1.</p></div></div>
            <div class="step-row"><span class="tile-icon">${I.answer}</span><div><h3>2. Answer them all</h3><p class="muted">Multiple choice, both ways round. One try, and the clock is running.</p></div></div>
            <div class="step-row"><span class="tile-icon">${I.share}</span><div><h3>3. Send the link</h3><p class="muted">Your friend answers the same 10 words. Most right answers wins.</p></div></div>
            <div class="points compact">
              <div class="point plus"><b>+10</b><span>per right answer</span></div>
              <div class="point"><b>1</b><span>try each</span></div>
              <div class="point"><b>⏱</b><span>ties: faster wins</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="card section">
        <div class="section-head"><h2>Phrases you'll use from day one</h2><p>Every deck ends with phrases you'll actually need on campus and around town.</p></div>
        <ul class="examples">
          ${EXAMPLES.map(([lt, en]) => `<li><span class="lt" lang="lt">${esc(lt)}</span>${I.arrow}<span class="en">${esc(en)}</span></li>`).join("")}
        </ul>
      </section>

      <section class="card section">
        <div class="section-head"><h2>Questions</h2></div>
        <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
      </section>

      <section class="card cta">
        <span class="cta-icon">${I.cup}</span>
        <h2>Start your streak today</h2>
        <p class="muted">Your first lesson takes about three minutes. Sėkmės! (Good luck!)</p>
        <a class="btn big" href="#signin" id="cta-signin">Get started</a>
      </section>
    </div>`;
}

function renderLanding() {
  $app.innerHTML = landingHtml();
  const err = (msg) => {
    const e = document.getElementById("signin-error");
    e.textContent = msg;
    e.hidden = !msg;
  };
  if (config.googleClientId) mountGoogleButton(err);
  else document.getElementById("gsi").innerHTML = `<p class="muted small">Google sign-in isn't set up on this server yet (set <code>GOOGLE_CLIENT_ID</code>).</p>`;
  document.getElementById("cta-signin").onclick = (e) => {
    e.preventDefault();
    document.getElementById("signin").scrollIntoView({ behavior: "smooth", block: "center" });
  };
  document.getElementById("dev-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      ({ user: me } = await api("/auth/dev", { method: "POST", body: { name: document.getElementById("dev-name").value } }));
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
  const decks = document.getElementById("decks");
  const countPicked = (units) => {
    const words = units.filter((u) => picked.has(u.id)).reduce((n, u) => n + unitWords(u), 0);
    document.getElementById("deck-count").textContent = picked.size ? `${picked.size} deck${picked.size > 1 ? "s" : ""} · ${words} words` : "Pick at least one";
  };
  api("/learn")
    .then(({ units }) => {
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
    })
    .catch((x) => (decks.innerHTML = `<p class="error">${esc(x.message)}</p>`));

  document.getElementById("create").onclick = async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("create-error");
    errEl.hidden = true;
    btn.disabled = true;
    try {
      const { code } = await api("/duels", { method: "POST", body: { unitIds: [...picked] } });
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

async function renderLearnPath() {
  $app.innerHTML = `<p class="muted loading">Loading your path…</p>`;
  let data;
  let board = { rows: [] };
  try {
    [data, board] = await Promise.all([api("/learn"), api("/leaderboard?period=week").catch(() => board)]);
  } catch (x) {
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Hmm.</h2><p class="muted">${esc(x.message)}</p></header></section>`;
    return;
  }
  const { units, stats } = data;
  const current = currentLessonId(units);
  let reached = true; // lessons up to the current one are open; later ones are locked
  const OFFSETS = [0, 52, 84, 52, 0, -52, -84, -52];
  let n = 0;
  let deckNo = 0;
  const unitHtml = (u) => {
    deckNo++;
    const nodes = u.lessons
      .map((l, li) => {
        const done = l.total > 0 && l.done >= l.total;
        const isCurrent = l.id === current;
        const locked = !done && !isCurrent && !reached;
        if (isCurrent) reached = false;
        const last = li === u.lessons.length - 1;
        const state = done ? "done" : isCurrent ? "current" : locked ? "locked" : "open";
        const icon = done ? I.tick : locked ? I.lock : last ? I.cup.replace('viewBox="0 0 80 80"', 'viewBox="8 6 64 66"') : I.star;
        const pct = l.total ? Math.round((100 * l.done) / l.total) : 0;
        const x = OFFSETS[n++ % OFFSETS.length];
        return `<div class="node-row" style="--x:${x}px">
          ${isCurrent ? `<span class="start-bubble">${l.done ? "CONTINUE" : "START"}</span>` : ""}
          <a class="node ${state}" ${locked ? 'aria-disabled="true" tabindex="-1"' : `href="#/learn/lesson/${l.id}"`} title="${esc(l.title)} (${l.done}/${l.total} words)${locked ? " (locked)" : ""}" style="--pct:${pct}">
            ${icon}
          </a>
          <span class="node-label">${esc(l.title)}</span>
        </div>`;
      })
      .join("");
    const unitCurrent = u.lessons.some((l) => l.id === current);
    const unitDone = u.lessons.length > 0 && u.lessons.every((l) => l.total > 0 && l.done >= l.total);
    return `<section class="unit">
      <header class="unit-banner ${deckNo % 2 ? "" : "alt"}">
        <div><span class="unit-no">${u.level ? `${esc(u.level)} · ` : ""}Deck ${deckNo} · ${unitLearned(u)}/${unitWords(u)} words</span><h2>${esc(u.title)}</h2><p>${esc(u.description)}</p></div>
        <div class="banner-actions">
          ${unitCurrent ? `<a class="btn light" href="#/learn/lesson/${current}">Continue</a>` : ""}
          <button class="banner-link" data-feedback="${u.id}" title="Suggest an improvement to this deck">${I.chat} Suggest a change</button>
        </div>
      </header>
      <div class="path">${nodes || `<p class="muted">No lessons yet.</p>`}</div>
      ${
        unitDone && !u.feedbackSent
          ? `<div class="card unit-done"><span class="unit-done-icon">${I.cup}</span><div><b>Deck complete! How was “${esc(u.title)}”?</b><p class="muted small">Tell us what to improve: too easy, too hard, a mistake in a word, or an idea.</p></div>
              <div class="stars" role="group" aria-label="Rate this deck">${[1, 2, 3, 4, 5].map((n) => `<button class="star" data-feedback="${u.id}" data-rating="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${I.star}</button>`).join("")}</div>
              <button class="btn outline small" data-feedback="${u.id}">Suggest an improvement</button></div>`
          : unitDone
            ? `<p class="unit-thanks">${I.check} Thanks for your feedback on this deck!</p>`
            : ""
      }
    </section>`;
  };
  const pathHtml = byLevel(units)
    .map(
      ([level, us]) => `${level ? `<div class="level-head">${levelChip(level)}<div><h2>${esc(LEVELS[level]?.[0] ?? `Level ${level}`)}</h2><p class="muted small">${esc(LEVELS[level]?.[1] ?? "")}</p></div></div>` : ""}
        ${us.map(unitHtml).join("")}`,
    )
    .join("");

  const quests = QUESTS.map((q) => {
    const pct = Math.min(100, Math.round((100 * stats.xp) / q));
    return `<li><div class="row spread"><span>Earn ${q} XP</span><span class="muted small">${Math.min(stats.xp, q)}/${q}</span></div><div class="bar"><i style="width:${pct}%"></i></div></li>`;
  }).join("");

  $app.innerHTML = `
    <div class="learn">
      <div class="learn-main">${pathHtml || `<section class="card picker"><header class="picker-head"><h2>No lessons yet</h2><p class="muted">An admin can add decks and words in the content editor.</p></header></section>`}</div>
      <aside class="learn-side">
        <section class="card side-card">${statChips(stats)}
          ${stats.hearts < stats.maxHearts ? `<p class="muted small">Next heart in ${fmtMinutes(stats.nextHeartMs)}. Practising a finished lesson also earns hearts.</p>` : `<p class="muted small">Full hearts. You lose one for each wrong answer in a new lesson.</p>`}
        </section>
        ${reviewCardHtml(stats)}
        <section class="card side-card"><div class="row spread"><h3>Leaderboard</h3><a href="#/leaderboard" class="small">View all</a></div>
          <ol class="mini-board">${
            board.rows.length
              ? board.rows.slice(0, 5).map((r) => `<li class="${r.isYou ? "you" : ""}"><span class="rank">${r.rank}</span>${avatar(r)}<span class="name">${esc(r.name)}</span><b>${r.xp} XP</b></li>`).join("")
              : `<li class="muted small">No XP this week yet. Finish a lesson to get on the board!</li>`
          }</ol>
        </section>
        <section class="card side-card"><h3>Quests</h3><ul class="quests">${quests}</ul></section>
      </aside>
    </div>`;
  for (const b of $app.querySelectorAll("[data-feedback]")) {
    b.onclick = () => {
      const u = units.find((x) => x.id === Number(b.dataset.feedback));
      openFeedback(u, Number(b.dataset.rating ?? 0), () => {
        u.feedbackSent = true;
        if (page() === "learn") renderLearnPath();
      });
    };
  }
  document.querySelector(".node.current")?.scrollIntoView({ block: "center" });
}

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

async function renderReview() {
  document.body.classList.add("focus");
  $app.innerHTML = `<p class="muted loading">Loading your review…</p>`;
  let data;
  try {
    data = await api("/learn/review");
  } catch (x) {
    document.body.classList.remove("focus");
    $app.innerHTML = errorCard(x.message);
    return;
  }
  if (!data.challenges.length) {
    document.body.classList.remove("focus");
    const s = data.stats;
    $app.innerHTML = `<section class="card finish">
      <span class="finish-icon">${I.cards}</span>
      <h1>${s.learned ? "All caught up!" : "Nothing to review yet"}</h1>
      <p class="muted">${s.learned ? `You've reviewed everything that's due. Next review ${fmtUntil(s.nextDueAt)}.` : "Finish a lesson first. The words you learn come back here a day later, then at longer and longer gaps."}</p>
      <div class="row" style="justify-content:center"><a class="btn outline" href="#/learn/words">${I.list} Your words</a><a class="btn" href="#/learn">Back to Learn</a></div>
    </section>`;
    return;
  }
  runPlayer({ mode: "review", queue: data.challenges, stats: data.stats });
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
  document.getElementById("quit").onclick = () => {
    if (solved === 0 || confirm(review ? "Stop reviewing? Words you've answered are saved." : "Quit the lesson? Words you've finished are saved.")) location.hash = "#/learn";
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
      <div class="row" style="justify-content:center">${stats.due ? `<a class="btn outline" href="#/learn/review">Review words</a>` : ""}<a class="btn" href="#/learn">Back to Learn</a></div>
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
        <input type="text" class="type-box" id="typed" lang="lt" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type in Lithuanian" aria-label="Your answer in Lithuanian">
        <div class="lt-keys" role="group" aria-label="Lithuanian letters">${LT_LETTERS.map((l) => `<button type="button" class="lt-key" data-ch="${l}" title="Shift-click for capital">${l}</button>`).join("")}</div>`;
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
        <div class="build-bank" id="bank">${tiles.map((t, i) => `<button type="button" class="word-tile" data-i="${i}" lang="lt">${esc(t)}</button>`).join("")}</div>`;
      const built = document.getElementById("built");
      const paint = () => {
        built.innerHTML = chosen.map((i, at) => `<button type="button" class="word-tile" data-at="${at}" lang="lt">${esc(tiles[i])}</button>`).join("") || `<span class="muted small">Tap the words in order</span>`;
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
      <div class="row" style="justify-content:center">${review && stats.due ? `<a class="btn big outline" href="#/learn/review" id="more">Review more</a>` : ""}<a class="btn big" href="#/learn">Continue</a></div>
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
  const pairHtml = (w) => `<span class="pair"><b lang="lt">${esc(w.lt)}</b> = ${esc(w.en)}${w.note ? `<br><span class="note">${esc(w.note)}</span>` : ""}</span>`;

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
      feedback.innerHTML = `<span class="fb-icon">${I.tick}</span><div><b>${head ? `${head} <span lang="lt">${esc(res.expected)}</span>` : "Nicely done!"}</b>${pairHtml(res.word)}${extra ? `<span>${extra}</span>` : ""}</div>`;
    } else {
      sfx.wrong();
      mistakes++;
      challenge.retry = true; // comes back at the end of the queue
      foot.className = "lesson-foot wrong";
      const right = challenge.kind === "pick_en" ? esc(res.word.en) : `<span lang="lt">${esc(res.word.lt)}</span>`;
      const mixup = res.confused ? `<span>You wrote <b lang="lt">${esc(res.confused.lt)}</b>, which means “${esc(res.confused.en)}”.</span>` : "";
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
  const allWords = units.flatMap((u) => u.lessons.flatMap((l) => l.words));
  let filter = "all";
  let query = "";
  const status = (w) => (!w.learned ? "new" : w.dueAt <= now ? "due" : "later");
  const matches = (w) => (filter === "all" || status(w) === filter || (filter === "learned" && w.learned)) && (!query || `${w.lt} ${w.en}`.toLowerCase().includes(query));

  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><a class="back" href="#/learn">${I.back} Learn</a><h1>Your words</h1><p class="muted">${stats.learned} of ${allWords.length} learned · ${stats.due} due for review</p></div>
      <div class="toolbar-actions">${stats.due ? `<a class="btn" href="#/learn/review">${I.refresh} Review ${stats.due} now</a>` : ""}</div>
    </div>
    <section class="card words-filter">
      <div class="segmented" role="radiogroup" aria-label="Show">
        ${[["all", "All"], ["learned", "Learned"], ["due", "Due"], ["new", "Not yet"]].map(([k, l]) => `<button role="radio" data-f="${k}" aria-checked="${k === filter}">${l}</button>`).join("")}
      </div>
      <input type="text" id="w-search" placeholder="Search Lithuanian or English…" aria-label="Search words">
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
              return `<li class="${s}"><span class="w-lt" lang="lt">${esc(w.lt)}</span><span class="w-en">${esc(w.en)}${w.note ? `<small>${esc(w.note)}</small>` : ""}</span>${w.pos !== "phrase" ? wordTag(w) : "<span></span>"}${badge}</li>`;
            })
            .join("")}</ul>
        </section>`;
      })
      .join("");
    document.getElementById("w-list").innerHTML = html || `<section class="card picker"><p class="muted center">No words match.</p></section>`;
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
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Hmm.</h2><p class="muted">${esc(x.message)}</p></header></section>`;
    return;
  }
  $app.innerHTML = `
    <section class="card board-page">
      <header class="picker-head"><span class="board-icon">${I.cup}</span><h2>Leaderboard</h2><p class="muted">Earn XP in lessons and reviews to climb. ${period === "week" ? "Resets every Monday." : ""}</p></header>
      <div class="segmented" role="tablist" style="margin:0 auto">
        <a role="tab" href="#/leaderboard" aria-selected="${period === "week"}">This week</a>
        <a role="tab" href="#/leaderboard/all" aria-selected="${period === "all"}">All time</a>
      </div>
      <ol class="board">${
        data.rows.length
          ? data.rows
              .map((r) => `<li class="${r.isYou ? "you" : ""}"><span class="rank r${r.rank}">${r.rank}</span>${avatar(r)}<span class="name">${esc(r.name)}${r.isYou ? " (you)" : ""}</span><b>${r.xp} XP</b></li>`)
              .join("")
          : `<li class="empty-row">Nobody has earned XP ${period === "week" ? "this week" : ""} yet. Be the first!</li>`
      }</ol>
      ${data.me && !data.rows.some((r) => r.isYou) ? `<p class="muted center">You're #${data.me.rank} with ${data.me.xp} XP.</p>` : ""}
      ${!data.me ? `<div class="row" style="justify-content:center"><a class="btn" href="#/learn">Start learning</a></div>` : ""}
    </section>`;
}

// ---------------------------------------------------------------- CMS (admins)

const cms = { content: null, lessonId: null, editing: null };

async function renderAdmin() {
  if (!me.isAdmin) {
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Admins only</h2><p class="muted">Ask the site owner to add your email to ADMINS.</p></header></section>`;
    return;
  }
  $app.innerHTML = `<p class="muted loading">Loading content…</p>`;
  try {
    cms.content = await api("/admin/content");
  } catch (x) {
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Hmm.</h2><p class="muted">${esc(x.message)}</p></header></section>`;
    return;
  }
  drawAdmin();
}

/** Runs a CMS change; the server answers with the whole content tree. */
async function cmsDo(method, path, body) {
  try {
    cms.content = await api(`/admin${path}`, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
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
  const level = (prompt("Level (A1, A2, B1 or B2):", u.level) ?? u.level).trim().toUpperCase();
  const description = prompt("Short description (optional):", u.description) ?? u.description;
  return { title, level, description };
}

function drawAdmin() {
  const units = cms.content.units;
  if (!allLessons().some((l) => l.id === cms.lessonId)) cms.lessonId = allLessons()[0]?.id ?? null;
  const counts = { units: units.length, lessons: allLessons().length, words: allLessons().reduce((n, l) => n + l.words.length, 0) };
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

  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><h1>Content editor</h1><p class="muted">${counts.units} decks · ${counts.lessons} lessons · ${counts.words} words · ${cms.content.players} players · ${cms.content.xpToday} XP earned today</p></div>
      <div class="toolbar-actions">
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected="true" data-view="content">Content</button>
          <button role="tab" aria-selected="false" data-view="feedback">Suggestions${cms.content.newFeedback ? ` <span class="count">${cms.content.newFeedback}</span>` : ""}</button>
        </div>
        <button class="btn" id="add-unit">${I.plus} New deck</button>
      </div>
    </div>
    <div class="cms">
      <aside class="card cms-tree"><ul class="tree">${tree || `<li class="muted small">No decks yet. Add one!</li>`}</ul></aside>
      <section class="card cms-main" id="cms-main"></section>
    </div>`;

  const main = document.getElementById("cms-main");
  if (cms.editing) drawWordForm(main, cms.editing);
  else if (lesson) {
    main.innerHTML = `
      <div class="list-head"><div><span class="muted small">${esc(lesson.unit.title)}</span><h2>${esc(lesson.title)}</h2></div>
        <button class="btn" id="add-word">${I.plus} Add word</button></div>
      <p class="muted small">Each word becomes four exercises: pick its meaning, pick the Lithuanian, type it, or (for phrases) build it from tiles.</p>
      <ul class="rows">${
        lesson.words
          .map(
            (w, i) => `<li class="ch-row"><span class="badge ${w.pos}">${esc(POS_LABELS[w.pos] ?? w.pos)}</span>
              <div><b lang="lt">${i + 1}. ${esc(w.lt)}</b> <span class="muted">= ${esc(w.en)}</span> ${GENDERS[w.gender] ? `<span class="pill">${GENDERS[w.gender]}</span>` : ""}
                ${w.also || w.note ? `<p class="muted small">${w.also ? `Also accepted: <span lang="lt">${esc(w.also.split(";").map((s) => s.trim()).join(", "))}</span>` : ""}${w.also && w.note ? " · " : ""}${esc(w.note)}</p>` : ""}</div>${tools("word", w.id)}</li>`,
          )
          .join("") || `<li class="empty-row">No words yet. Add the first one!</li>`
      }</ul>`;
    document.getElementById("add-word").onclick = () => {
      cms.editing = { lessonId: lesson.id, lt: "", en: "", pos: "noun", gender: "", also: "", note: "" };
      drawAdmin();
    };
  } else main.innerHTML = `<p class="empty-row">Add a deck and a lesson to start.</p>`;

  for (const b of $app.querySelectorAll("[data-view]")) b.onclick = () => b.dataset.view === "feedback" && drawFeedback();
  for (const b of $app.querySelectorAll("[data-goto-feedback]")) b.onclick = () => drawFeedback();
  document.getElementById("add-unit").onclick = async () => {
    const d = promptDeck();
    if (d && (await cmsDo("POST", "/units", d))) drawAdmin();
  };
  for (const b of $app.querySelectorAll("[data-add-lesson]")) {
    b.onclick = async () => {
      const title = prompt("Lesson title:");
      if (title && (await cmsDo("POST", "/lessons", { unitId: Number(b.dataset.addLesson), title }))) {
        cms.lessonId = cms.content.units.find((u) => u.id === Number(b.dataset.addLesson))?.lessons.at(-1)?.id ?? cms.lessonId;
        drawAdmin();
      }
    };
  }
  for (const r of $app.querySelectorAll("[data-pick]")) {
    r.onclick = (e) => {
      if (e.target.closest("button")) return;
      cms.lessonId = Number(r.dataset.pick);
      cms.editing = null;
      drawAdmin();
    };
  }
  for (const b of $app.querySelectorAll("[data-move]")) {
    b.onclick = async () => {
      const [kind, id, dir] = b.dataset.move.split(":");
      if (await cmsDo("POST", "/move", { kind, id: Number(id), dir: Number(dir) })) drawAdmin();
    };
  }
  for (const b of $app.querySelectorAll("[data-del]")) {
    b.onclick = async () => {
      const [kind, id] = b.dataset.del.split(":");
      const what = { unit: "this deck and all its lessons and words", lesson: "this lesson and its words", word: "this word" }[kind];
      if (confirm(`Delete ${what}? Players' progress on it is deleted too.`) && (await cmsDo("DELETE", `/${kind}s/${id}`))) {
        cms.editing = null;
        drawAdmin();
      }
    };
  }
  for (const b of $app.querySelectorAll("[data-edit]")) {
    b.onclick = async () => {
      const [kind, idStr] = b.dataset.edit.split(":");
      const id = Number(idStr);
      if (kind === "unit") {
        const d = promptDeck(units.find((x) => x.id === id));
        if (d && (await cmsDo("PUT", `/units/${id}`, d))) drawAdmin();
      } else if (kind === "lesson") {
        const l = allLessons().find((x) => x.id === id);
        const title = prompt("Lesson title:", l.title);
        if (title != null && (await cmsDo("PUT", `/lessons/${id}`, { title }))) drawAdmin();
      } else {
        const w = allLessons().flatMap((l) => l.words.map((x) => ({ ...x, lessonId: l.id }))).find((x) => x.id === id);
        cms.editing = { ...w };
        drawAdmin();
      }
    };
  }
}

/** The "Suggestions" view: players' deck feedback, newest first. */
async function drawFeedback(filter = "new") {
  let data;
  try {
    data = await api(`/admin/feedback?status=${filter}`);
  } catch (x) {
    return toast(x.message);
  }
  const catLabel = Object.fromEntries(FEEDBACK_CATEGORIES);
  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><h1>Suggestions</h1><p class="muted">What players think should change in each deck. ${data.newCount} new.</p></div>
      <div class="toolbar-actions">
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected="false" data-view="content">Content</button>
          <button role="tab" aria-selected="true" data-view="feedback">Suggestions${data.newCount ? ` <span class="count">${data.newCount}</span>` : ""}</button>
        </div>
      </div>
    </div>
    <section class="card cms-main">
      <div class="list-head"><div class="segmented" role="tablist" aria-label="Filter">
        ${["new", "done", "all"].map((f) => `<button role="tab" data-filter="${f}" aria-selected="${f === filter}">${{ new: "New", done: "Done", all: "All" }[f]}</button>`).join("")}
      </div></div>
      <ul class="rows">${
        data.items
          .map(
            (f) => `<li class="fb-row ${f.status}">${avatar({ name: f.user, picture: f.picture })}
              <div><div class="row"><b>${esc(f.user)}</b><span class="muted small">on <b>${esc(f.unitTitle)}</b> · ${fmtDate(f.createdAt)}</span>
                ${f.rating ? `<span class="mini-stars" aria-label="${f.rating} of 5 stars">${"★".repeat(f.rating)}<span>${"★".repeat(5 - f.rating)}</span></span>` : ""}
                ${f.category ? `<span class="pill">${esc(catLabel[f.category] ?? f.category)}</span>` : ""}</div>
                <p>${esc(f.text)}</p></div>
              <span class="tools">
                <button class="btn outline small" data-mark="${f.id}:${f.status === "new" ? "done" : "new"}">${f.status === "new" ? `${I.check} Mark done` : "Reopen"}</button>
                <button class="icon-btn sm danger" data-del-fb="${f.id}" title="Delete">${I.trash}</button>
              </span></li>`,
          )
          .join("") || `<li class="empty-row">${filter === "new" ? "No new suggestions. Players can send one from any deck on the Learn page." : "Nothing here."}</li>`
      }</ul>
    </section>`;
  for (const b of $app.querySelectorAll("[data-view]")) b.onclick = () => (b.dataset.view === "content" ? renderAdmin() : drawFeedback());
  for (const b of $app.querySelectorAll("[data-filter]")) b.onclick = () => drawFeedback(b.dataset.filter);
  for (const b of $app.querySelectorAll("[data-mark]")) {
    b.onclick = async () => {
      const [id, status] = b.dataset.mark.split(":");
      try {
        await api(`/admin/feedback/${id}`, { method: "PUT", body: { status } });
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
        await api(`/admin/feedback/${b.dataset.delFb}`, { method: "DELETE" });
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
        <label class="field">Lithuanian <input type="text" id="f-lt" lang="lt" maxlength="100" value="${esc(w.lt)}" placeholder="${w.pos === "phrase" ? "Kur yra biblioteka?" : "knyga"}" required></label>
        <label class="field">English <input type="text" id="f-en" maxlength="100" value="${esc(w.en)}" placeholder="${w.pos === "phrase" ? "Where is the library?" : "book"}" required></label>
      </div>
      <div class="lt-keys" role="group" aria-label="Lithuanian letters">${LT_LETTERS.map((l) => `<button type="button" class="lt-key" data-ch="${l}">${l}</button>`).join("")}</div>
      <label class="field" ${w.pos === "noun" ? "" : "hidden"}>Gender
        <select id="f-gender">${[["", "(none)"], ...Object.entries(GENDERS)].map(([k, l]) => `<option value="${k}" ${w.gender === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field">Also accepted <span class="muted small">(other correct Lithuanian answers, separated by ;)</span><input type="text" id="f-also" lang="lt" maxlength="200" value="${esc(w.also)}" placeholder="dalintis; kambariokas"></label>
      <label class="field">Note <span class="muted small">(shown after the answer: a second meaning, a usage tip…)</span><input type="text" id="f-note" maxlength="200" value="${esc(w.note)}" placeholder="Feminine, even though it ends in -is."></label>
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
      lastInput.setSelectionRange(s + 1, s + 1);
      lastInput.focus();
    };
  }
  document.getElementById("cancel").onclick = () => {
    cms.editing = null;
    drawAdmin();
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
    const err = document.getElementById("f-err");
    try {
      cms.content = await api(w.id ? `/admin/words/${w.id}` : "/admin/words", { method: w.id ? "PUT" : "POST", body });
      cms.editing = null;
      cms.lessonId = w.lessonId;
      toast("Saved");
      drawAdmin();
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
    }
  };
}

// ---------------------------------------------------------------- theme switch (System → Light → Dark)

const THEMES = {
  system: { next: "light", label: "Theme: system (click for light)", icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>` },
  light: { next: "dark", label: "Theme: light (click for dark)", icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>` },
  dark: { next: "system", label: "Theme: dark (click for system)", icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/></svg>` },
};

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function isDark() {
  const t = currentTheme();
  return t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

function setTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {}
  drawThemeButton();
}

function drawThemeButton() {
  const btn = document.getElementById("theme");
  const t = THEMES[currentTheme()];
  btn.innerHTML = t.icon;
  btn.title = t.label;
  btn.setAttribute("aria-label", t.label);
}

document.getElementById("theme").onclick = () => {
  setTheme(THEMES[currentTheme()].next);
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
  const lessonId = /^#\/learn\/lesson\/(\d+)$/.exec(location.hash)?.[1];
  if (lessonId) return renderLesson(Number(lessonId));
  if (location.hash.startsWith("#/learn/review")) return renderReview();
  if (location.hash.startsWith("#/learn/words")) return renderWords();
  if (page() === "learn") return renderLearnPath();
  if (page() === "leaderboard") return renderLeaderboard();
  if (page() === "admin") return renderAdmin();
  if (page() !== "play") {
    history.replaceState(null, "", "#/learn");
    renderNav();
    return renderLearnPath();
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
}

start();
