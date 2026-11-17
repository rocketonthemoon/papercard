// Grammar Duel front end. Signed out: a landing page that explains the game, with Google sign-in.
// Signed in: "Learn grammar" (solo practice with hints) and "Play" (create or join a duel room).
// Routes: #/ (landing), #/learn, #/play, #/duel/CODE. No frameworks.

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

/** `text` with the given UTF-16 ranges wrapped in <mark>. */
function markedHtml(text, ranges, cls = () => "") {
  let out = "";
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start16 - b.start16)) {
    if (r.start16 < at || r.end16 > text.length) continue;
    out += esc(text.slice(at, r.start16)) + `<mark class="${cls(r)}"${r.message ? ` title="${esc(r.message)}"` : ""}>${esc(text.slice(r.start16, r.end16))}</mark>`;
    at = r.end16;
  }
  return out + esc(text.slice(at));
}

// ---------------------------------------------------------------- icons (inline SVG, gradients defined in index.html)

const I = {
  random: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="8" width="28" height="28" rx="3" fill="url(#gGreen)"/><rect x="44" y="8" width="28" height="28" rx="3" fill="url(#gNavy)"/><rect x="8" y="44" width="28" height="28" rx="3" fill="url(#gNavy)"/><rect x="44" y="44" width="28" height="28" rx="3" fill="url(#gGreen)"/><text x="22" y="28" font-size="15" font-weight="800" text-anchor="middle" fill="#fff" font-family="Mulish,sans-serif">T</text><text x="58" y="28" font-size="15" font-weight="800" text-anchor="middle" fill="#7ff0c6" font-family="Mulish,sans-serif">X</text><text x="22" y="64" font-size="15" font-weight="800" text-anchor="middle" fill="#7ff0c6" font-family="Mulish,sans-serif">E</text><text x="58" y="64" font-size="15" font-weight="800" text-anchor="middle" fill="#fff" font-family="Mulish,sans-serif">T</text></svg>`,
  write: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="10" y="8" width="60" height="64" rx="4" fill="url(#gGreen)"/><rect x="18" y="20" width="10" height="10" rx="2" fill="url(#gNavy)"/><rect x="34" y="23" width="28" height="4" rx="2" fill="#fff"/><rect x="18" y="36" width="10" height="10" rx="2" fill="url(#gNavy)"/><rect x="34" y="39" width="28" height="4" rx="2" fill="#fff"/><rect x="18" y="52" width="10" height="10" rx="2" fill="url(#gNavy)"/><rect x="34" y="55" width="20" height="4" rx="2" fill="#fff"/><path d="M20.5 25l2 2 3.5-4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  join: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="10" width="40" height="40" rx="3" fill="url(#gGreen)"/><rect x="32" y="30" width="40" height="40" rx="3" fill="url(#gNavy)"/><text x="22" y="37" font-size="18" font-weight="800" text-anchor="middle" fill="#2c3860" font-family="Mulish,sans-serif">A</text><text x="52" y="58" font-size="18" font-weight="800" text-anchor="middle" fill="#fff" font-family="Mulish,sans-serif">B</text></svg>`,
  fix: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="10" width="64" height="60" rx="4" fill="url(#gGreen)"/><rect x="16" y="22" width="48" height="5" rx="2.5" fill="#fff"/><rect x="16" y="34" width="34" height="5" rx="2.5" fill="#fff"/><path d="M16 50q4-4 8 0t8 0 8 0" stroke="url(#gNavy)" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="58" cy="54" r="11" fill="url(#gNavy)"/><path d="M53 54l3.5 3.5L63 51" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="16" width="44" height="44" rx="4" fill="url(#gNavy)"/><rect x="28" y="28" width="44" height="40" rx="4" fill="url(#gGreen)"/><path d="M38 48h18m-6-6 6 6-6 6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="4" fill="var(--green)"/><path d="M5.5 10.5l3 3 6-7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ok: `<svg viewBox="0 0 20 20" class="mark-ok" aria-label="fixed"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  miss: `<svg viewBox="0 0 20 20" class="mark-miss" aria-label="missed"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  back: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  copy: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M13 4H5a1 1 0 0 0-1 1v8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  send: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10 17 3l-4 14-3-6z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>`,
  refresh: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v4h-4" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  undo: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5 3 9l4 4M3.5 9H12a5 5 0 0 1 0 10h-2" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trophy: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3h8v4a4 4 0 0 1-8 0zM6 5H3a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3M10 11v4m-3 2h6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
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
    const dark = isDark();
    google.accounts.id.renderButton(slot, { theme: dark ? "filled_black" : "outline", size: "large", shape: "rectangular", text: "signin_with", width: 260 });
  } catch (x) {
    err(x.message);
  }
}


// ---------------------------------------------------------------- duel

async function renderDuel(code) {
  $app.innerHTML = `<p class="muted loading">Loading duel ${esc(code)}…</p>`;
  let duel;
  try {
    duel = await api(`/duels/${code}`);
  } catch (x) {
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Hmm.</h2><p class="muted">${esc(x.message)}</p></header><div class="row" style="justify-content:center"><a class="btn" href="#/play">Back to Play</a></div></section>`;
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

/**
 * A textarea that underlines `marks` (UTF-16 ranges into `original`). Edits shift the marks;
 * a mark disappears once the player changes the text inside it.
 */
function mountEditor(textarea, layer, original, marks) {
  // Each mark remembers its words, so it can be found again after bigger edits (paste, restored drafts).
  const withWords = (text, ms) => ms.map((m) => ({ ...m, word: text.slice(m.start16, m.end16) }));
  const isWordChar = (ch) => !!ch && /[\p{L}\p{N}'’]/u.test(ch);
  let base = original;
  let baseMarks = withWords(original, marks);
  let live = baseMarks.map((m) => ({ ...m }));
  let prev = original;
  const shift = (before, after) => {
    let p = 0;
    while (p < before.length && p < after.length && before[p] === after[p]) p++;
    let s = 0;
    while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
    const oldEnd = before.length - s;
    const newEnd = after.length - s;
    const delta = after.length - before.length;
    let cursor = p;
    const next = [];
    for (const m of [...live].sort((x, y) => x.start16 - y.start16)) {
      if (m.end16 <= p) next.push(m);
      else if (m.start16 >= oldEnd) next.push({ ...m, start16: m.start16 + delta, end16: m.end16 + delta });
      else {
        // Inside the edited stretch: keep it only if its exact words are still there, as whole words.
        let at = after.indexOf(m.word, cursor);
        while (at >= 0 && at + m.word.length <= newEnd && (isWordChar(after[at - 1]) || isWordChar(after[at + m.word.length]))) at = after.indexOf(m.word, at + 1);
        // A single small edit inside the mark itself means the player changed that word: drop it.
        const touched = m.start16 < oldEnd && m.end16 > p && oldEnd - p <= m.word.length && after.length - before.length + (oldEnd - p) <= m.word.length + 4;
        if (!touched && at >= 0 && at + m.word.length <= newEnd) {
          next.push({ ...m, start16: at, end16: at + m.word.length });
          cursor = at + m.word.length;
        }
      }
    }
    live = next;
  };
  const paint = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    layer.innerHTML = `${markedHtml(textarea.value, live)}
`;
  };
  const sync = () => {
    shift(prev, textarea.value);
    prev = textarea.value;
    paint();
  };
  textarea.addEventListener("input", sync);
  addEventListener("resize", paint);
  return {
    set(value) {
      textarea.value = value;
      sync();
    },
    /** Back to the starting text and marks. */
    reset() {
      live = baseMarks.map((m) => ({ ...m }));
      prev = base;
      textarea.value = base;
      paint();
    },
    /** New marks for the text as it is now (after a re-check). */
    rebase(newMarks) {
      base = textarea.value;
      baseMarks = withWords(base, newMarks);
      live = baseMarks.map((m) => ({ ...m }));
      prev = base;
      paint();
    },
    /** Start over with a different text. */
    load(text, newMarks) {
      textarea.value = text;
      this.rebase(newMarks);
    },
    remaining: () => live.length,
  };
}

function renderDuelPlay(duel) {
  const started = Date.now();
  const draftKey = `duel-draft-${duel.code}`;
  let draft = null;
  try {
    draft = localStorage.getItem(draftKey);
  } catch {}
  const marks = duel.marks ?? [];
  $app.innerHTML = `
    <div class="toolbar">
      <a class="back" href="#/play">${I.back} Play</a>
      <div class="toolbar-actions">
        <button class="btn outline" data-copy="${esc(shareLink(duel.code))}">${I.copy} Invite link</button>
        <button class="btn outline" id="reset">${I.undo} Start over</button>
        <button class="btn" id="submit">${I.send} Submit answer</button>
      </div>
    </div>
    <div class="workspace two">
      <aside class="card side">
        <section><h3>Duel</h3><div class="row"><span class="code-chip">${esc(duel.code)}</span></div><p class="muted small">${duel.source === "random" ? "Random text" : "Custom text"} · set by ${esc(duel.creator.name)}</p></section>
        <section><h3>Mistakes</h3><p class="big-num"><b id="left">${marks.length}</b> <small>of ${duel.issueCount} still underlined</small></p></section>
        <section><h3>Time</h3><p class="timer" id="clock" title="Time since you first opened this duel">0:00</p></section>
        <section><h3>Scoring</h3><ul class="checks"><li>${I.check} +10 per mistake fixed</li><li>${I.check} −5 per new mistake</li><li>${I.check} −3 per extra word changed</li><li>${I.check} One try; ties go to the faster player</li></ul></section>
        <section><h3>Players (${duel.players.length})</h3>${
          duel.players.length
            ? `<ul class="people">${duel.players.map((p) => `<li>${avatar(p)}<span>${esc(p.name)}</span><span class="played">played</span></li>`).join("")}</ul>`
            : `<p class="muted small">Nobody has played yet. Be the first, then send the link.</p>`
        }</section>
      </aside>
      <div class="sheet-wrap">
        <div class="sheet">
          <div class="sheet-head"><span><b>Name :</b> ${esc(me.name)}</span><span><b>Date :</b> ${fmtDate(duel.createdAt)}</span></div>
          <h1 class="sheet-title">${esc(duel.title)}</h1>
          <div class="editor">
            <div class="editor-marks" id="marks" aria-hidden="true"></div>
            <textarea id="answer" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Your corrected text"></textarea>
          </div>
          <div class="editor-hint"><i></i>Underlined words contain a mistake. An underline disappears once you change that word.</div>
          <p id="submit-error" class="error" hidden></p>
        </div>
      </div>
    </div>`;
  wireCopy();

  const answer = document.getElementById("answer");
  const editor = mountEditor(answer, document.getElementById("marks"), duel.text, marks);
  const left = document.getElementById("left");
  editor.reset();
  if (draft && draft !== duel.text) editor.set(draft);
  left.textContent = editor.remaining();
  answer.addEventListener("input", () => {
    left.textContent = editor.remaining();
    try {
      localStorage.setItem(draftKey, answer.value);
    } catch {}
  });
  document.getElementById("reset").onclick = () => {
    editor.reset();
    left.textContent = editor.remaining();
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    answer.focus();
  };

  // The server keeps the real clock; this one is only a guide.
  const clock = document.getElementById("clock");
  clockTimer = setInterval(() => (clock.textContent = fmtTime(Date.now() - started)), 1000);

  document.getElementById("submit").onclick = async (e) => {
    if (answer.value.trim() === duel.text.trim() && !confirm("You haven't changed anything. Submit anyway?")) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api(`/duels/${duel.code}/submit`, { method: "POST", body: { text: answer.value } });
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      stopTimers();
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
  const r = duel.you.result;
  const others = duel.players.filter((p) => !p.isYou);
  const youWon = duel.winner && duel.players[0]?.isYou;
  const remainingKeys = new Set(r.remaining.map((l) => `${l.rule}|${l.text.toLowerCase()}`));
  const fixedCount = duel.answers.filter((l) => !remainingKeys.has(`${l.rule}|${l.text.toLowerCase()}`)).length;
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
    <div class="workspace three">
      <aside class="card side">
        <section><h3>${justSubmitted ? "Your score" : "Your result"}</h3><p class="score"><b>${duel.you.points}</b><span class="muted">/ ${duel.maxPoints} points</span></p></section>
        <section><ul class="kv">
          <li><span>Fixed</span><b class="good">${r.fixed}/${r.total}</b></li>
          <li><span>New mistakes</span><b class="${r.introduced.length ? "bad" : ""}">${r.introduced.length}</b></li>
          <li><span>Extra edits</span><b class="${r.overEdits ? "bad" : ""}">${r.overEdits}</b></li>
          <li><span>Time</span><b>${fmtTime(duel.you.elapsedMs)}</b></li>
        </ul></section>
        <section><h3>Scoreboard</h3>${verdict}
          <ul class="people">${duel.players
            .map(
              (p) => `<li class="${p.isYou ? "you" : ""}"><span class="muted small">#${p.rank}</span>${avatar(p)}<span>${esc(p.name)}${p.isYou ? " (you)" : ""}<br><span class="muted small">fixed ${p.fixed} · ${fmtTime(p.elapsedMs)}</span></span><span class="pts">${p.points}</span></li>`,
            )
            .join("")}</ul>
          ${others.length ? "" : `<button class="btn dashed block" data-copy="${esc(shareLink(duel.code))}">${I.copy} Copy invite link</button>`}
        </section>
      </aside>
      <section class="card list-card">
        <div class="list-head"><h3>Answer key (${duel.answers.length})</h3><span class="muted small">${fixedCount} fixed</span></div>
        <ul class="rows">${duel.answers
          .map((l) => {
            const missed = remainingKeys.has(`${l.rule}|${l.text.toLowerCase()}`);
            const fix = l.suggestions?.[0]?.text;
            return `<li class="answer">${missed ? I.miss : I.ok}<div><span class="found">${esc(l.text)}</span>${fix != null ? ` → <b>${esc(fix || "(remove)")}</b>` : ""}<p class="muted small">${esc(l.message)}</p></div><span class="tag ${missed ? "miss" : "ok"}">${missed ? "missed" : "fixed"}</span></li>`;
          })
          .join("")}</ul>
      </section>
      <div class="sheet-wrap">
        <div class="sheet">
          <div class="sheet-head"><span><b>Name :</b> ${esc(me.name)}</span><span><b>Date :</b> ${fmtDate(duel.createdAt)}</span></div>
          <h1 class="sheet-title">${esc(duel.title)}</h1>
          <div class="sheet-text">${markedHtml(duel.you.text, [...r.remaining, ...r.introduced.map((l) => ({ ...l, isNew: true }))], (l) => (l.isNew ? "new" : ""))}</div>
          <p class="editor-hint">${
            r.remaining.length + r.introduced.length
              ? `<i></i>Still flagged by Harper. Hover an underline for details.${r.introduced.length ? " Orange underlines are mistakes you added." : ""}`
              : "Harper finds nothing wrong. Clean!"
          }</p>
        </div>
      </div>
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


I.learn = `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M10 18c10-4 20-4 30 2v46c-10-6-20-6-30-2z" fill="url(#gGreen)"/><path d="M70 18c-10-4-20-4-30 2v46c10-6 20-6 30-2z" fill="url(#gNavy)"/><path d="M18 30q4-3 8 0t8 0M18 40h14M48 30h14M48 40h14M48 50h10" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`;
I.room = `<svg viewBox="0 0 80 80" aria-hidden="true"><rect x="8" y="8" width="28" height="28" rx="3" fill="url(#gGreen)"/><rect x="44" y="8" width="28" height="28" rx="3" fill="url(#gNavy)"/><rect x="8" y="44" width="28" height="28" rx="3" fill="url(#gNavy)"/><rect x="44" y="44" width="28" height="28" rx="3" fill="url(#gGreen)"/><path d="M58 52v12M52 58h12" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`;
I.bulb = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 16h4" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.eye = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" stroke="currentColor" stroke-width="1.7" fill="none"/><circle cx="10" cy="10" r="2.3" fill="currentColor"/></svg>`;
I.dot = `<svg viewBox="0 0 20 20" class="mark-open" aria-label="to fix"><circle cx="10" cy="10" r="4.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;

// ---------------------------------------------------------------- top bar

const page = () => {
  const h = location.hash;
  if (h.startsWith("#/learn")) return "learn";
  if (h.startsWith("#/leaderboard")) return "leaderboard";
  if (h.startsWith("#/admin")) return "admin";
  if (h.startsWith("#/play") || duelCodeFromHash()) return "play";
  return "home";
};

function renderNav() {
  const links = document.querySelector(".links");
  links.innerHTML = me
    ? `<a href="#/learn" data-nav="learn">Learn grammar</a><a href="#/play" data-nav="play">Play</a><a href="#/leaderboard" data-nav="leaderboard">Leaderboard</a>${me.isAdmin ? `<a href="#/admin" data-nav="admin">Admin</a>` : ""}`
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

const SAMPLE = "Me and him went camping last weekend. We was hoping for sun, but it rained alot. Their was mud everywhere.";
const sampleMarks = ["Me and him", "was", "alot", "Their"].map((t) => {
  const start16 = SAMPLE.indexOf(t);
  return { start16, end16: start16 + t.length };
});

const EXAMPLES = [
  ["Me and him went", "He and I went"],
  ["between you and I", "between you and me"],
  ["We was late", "We were late"],
  ["I could of stayed", "I could have stayed"],
  ["less people", "fewer people"],
  ["Your welcome!", "You're welcome!"],
  ["tow the line", "toe the line"],
  ["It rained alot", "It rained a lot"],
];

const FAQ = [
  ["Is it free?", "Yes. Sign in with Google and start learning. There's nothing to buy."],
  ["What is Harper?", "Harper is an open-source grammar checker. It runs on our own server, with no AI model and nothing sent to anyone else. It checks every answer, so it judges everyone the same way."],
  ["How do hearts work?", "You start each lesson with up to 5 hearts and lose one for each wrong answer. A heart comes back every 30 minutes, and practising a lesson you've already finished earns hearts too."],
  ["What's the difference between Learn and Play?", "Learn is your own path of short lessons with hints, XP and streaks. Play is a duel: you and a friend fix the same paragraph once, and Harper scores you both."],
  ["Do I see where the mistakes are?", "Yes. Mistakes are underlined, but not what's wrong with them. In lessons you get a hint and can reveal the answer if you're stuck."],
  ["What do you store about me?", "Your Google name and profile picture (for the leaderboard), your email, your progress and XP, and your duel answers."],
];

const FEATURES = [
  ["learn", "Bite-sized lessons", "Units of short lessons on the mistakes people really make: there and their, who and whom, less and fewer."],
  ["heart", "Hearts keep you sharp", "Each wrong answer costs a heart. Practise finished lessons to earn them back."],
  ["fire", "Streaks and quests", "Learn a little every day to grow your streak, and hit XP goals along the way."],
  ["cup", "Weekly leaderboard", "Earn XP to climb the board. It resets every Monday, so anyone can win the week."],
  ["room", "Duel your friends", "Send a friend a paragraph full of mistakes. Whoever fixes more, wins."],
  ["fix", "Checked by Harper", "A real grammar checker grades every answer, instantly and the same for everyone."],
];

function landingHtml() {
  const challenged = duelCodeFromHash();
  const node = (state, icon, label, x) =>
    `<div class="mini-node ${state}" style="--x:${x}px"><span>${icon}</span><small>${esc(label)}</small></div>`;
  return `
    <div class="landing">
      ${challenged ? `<div class="notice">You've been challenged to duel <b>${esc(challenged)}</b>. Sign in to play.</div>` : ""}
      <section class="card hero">
        <div>
          <span class="eyebrow">Free · No ads · Checked by Harper</span>
          <h1>Get better at grammar, <em>one lesson at a time.</em></h1>
          <p class="lede">Short, game-like lessons on the mistakes people really make. Keep your streak going, climb the leaderboard, and challenge your friends to a grammar duel.</p>
          <div class="signin" id="signin"><div id="gsi" class="gsi-slot"></div><p id="signin-error" class="error" hidden></p>${
            config.devLogin
              ? `<form id="dev-login" class="dev-login"><input type="text" id="dev-name" placeholder="Your name (guest login)" maxlength="40" required><button class="btn outline">Play as guest</button></form>`
              : ""
          }<p class="fine">Sign in with Google to save your progress. We only use your name and picture.</p></div>
        </div>
        <div class="hero-demo" aria-hidden="true">
          <div class="demo-card">
            <div class="demo-top"><span class="demo-x">${I.close}</span><span class="demo-bar"><i></i></span><span class="demo-hearts">${I.heart}<b>4</b></span></div>
            <p class="demo-q">Which sentence is correct?</p>
            <div class="demo-opt"><span class="key">1</span>Their going to the park.</div>
            <div class="demo-opt picked"><span class="key">2</span>They're going to the park.</div>
            <div class="demo-opt"><span class="key">3</span>There going to the park.</div>
            <div class="demo-foot"><span class="demo-ok">${I.tick}</span><div><b>Nicely done!</b><span>+10 XP</span></div></div>
          </div>
          <div class="float-chip streak">${I.fire}<b>7</b><span>day streak</span></div>
          <div class="float-chip xp">${I.bolt}<b>+10</b><span>XP</span></div>
        </div>
      </section>

      <section class="card section">
        <div class="section-head"><h2>Why it works</h2><p>Little and often beats cramming. Grammar Duel keeps you coming back, and keeps it fun.</p></div>
        <div class="features">${FEATURES.map(([icon, title, text]) => `<div class="feature"><span class="feature-icon fi-${icon}">${I[icon]}</span><h3>${title}</h3><p>${text}</p></div>`).join("")}</div>
      </section>

      <section class="card section path-section">
        <div class="path-copy">
          <span class="eyebrow">Learn grammar</span>
          <h2>Follow your path</h2>
          <p class="muted">Work through units like <b>Everyday mix-ups</b>, <b>Verbs</b> and <b>Pronouns</b>. Each lesson mixes multiple-choice questions with real texts to fix, where Harper underlines the mistakes and checks your answer.</p>
          <ul class="checks">
            <li>${I.check} Lessons unlock as you go</li>
            <li>${I.check} Hints and answers when you're stuck</li>
            <li>${I.check} 10 XP for every correct answer</li>
            <li>${I.check} Free practice with any text you paste in</li>
          </ul>
        </div>
        <div class="mini-path" aria-hidden="true">
          <div class="mini-banner"><small>Unit 1</small><b>Everyday mix-ups</b></div>
          ${node("done", I.tick, "There, their, they're", 0)}
          ${node("done", I.tick, "Your, you're, its, it's", 46)}
          ${node("current", I.star, "Then, than and a lot", 0)}
          ${node("locked", I.lock, "Was and were", -46)}
        </div>
      </section>

      <section class="card section">
        <div class="section-head"><span class="eyebrow">Play a friend</span><h2>Grammar duels</h2><p>Create a room with a random paragraph or your own text, fix it, and send your friend the link. Harper scores you both.</p></div>
        <div class="duel-grid">
          <div class="hero-sheet duel-demo" aria-hidden="true">
            <div class="sheet">
              <div class="sheet-head"><span><b>Name :</b> You</span><span><b>Date :</b> ${fmtDate()}</span></div>
              <div class="sheet-title">The camping trip</div>
              <div class="sheet-text">${markedHtml(SAMPLE, sampleMarks)}</div>
            </div>
            <div class="hero-score">
              <div class="lead"><span>You</span><b>40 pts</b></div>
              <div><span>Sam</span><b>30 pts</b></div>
            </div>
          </div>
          <div class="duel-steps">
            <div class="step-row"><span class="tile-icon">${I.random}</span><div><h3>1. Create a room</h3><p class="muted">A random paragraph with 4–6 hidden mistakes, or your own.</p></div></div>
            <div class="step-row"><span class="tile-icon">${I.fix}</span><div><h3>2. Fix the text</h3><p class="muted">Mistakes are underlined. One try, and the clock is running.</p></div></div>
            <div class="step-row"><span class="tile-icon">${I.share}</span><div><h3>3. Send the link</h3><p class="muted">Your friend fixes the same text, and Harper crowns the winner.</p></div></div>
            <div class="points compact">
              <div class="point plus"><b>+10</b><span>per fix</span></div>
              <div class="point minus"><b>−5</b><span>per new mistake</span></div>
              <div class="point minus"><b>−3</b><span>per extra edit</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="card section">
        <div class="section-head"><h2>Mistakes you'll never make again</h2><p>Spelling, grammar, word choice and the mix-ups people really make.</p></div>
        <ul class="examples">
          ${EXAMPLES.map(([bad, good]) => `<li><span class="bad">${esc(bad)}</span>${I.arrow}<span class="good">${esc(good)}</span></li>`).join("")}
        </ul>
      </section>

      <section class="card section">
        <div class="section-head"><h2>Questions</h2></div>
        <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
      </section>

      <section class="card cta">
        <span class="cta-icon">${I.cup}</span>
        <h2>Start your streak today</h2>
        <p class="muted">Your first lesson takes about two minutes.</p>
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

/** After signing in, go where the visitor was headed (a duel link) or to Play. */
function afterSignIn() {
  if (!duelCodeFromHash() && page() === "home") location.hash = "#/learn";
  route();
}

// ---------------------------------------------------------------- Play: create or join a room

async function renderPlayHub() {
  $app.innerHTML = `
    <div class="lobby">
      <section class="card picker">
        <header class="picker-head"><h2>Play a friend</h2><p class="muted">Create a room and send the link, or join one with a code</p></header>
        <div class="tiles two" role="tablist">
          <button class="tile" role="tab" data-mode="create" aria-selected="true"><span class="tip">You play first, then send the link</span><span class="tile-icon">${I.room}</span><span class="tile-name">Create a room</span></button>
          <button class="tile" role="tab" data-mode="join" aria-selected="false"><span class="tip">Got a code from a friend?</span><span class="tile-icon">${I.join}</span><span class="tile-name">Join a room</span></button>
        </div>
        <div class="pane" id="pane-create">
          <div class="segmented" role="radiogroup" aria-label="Text for the room">
            <button role="radio" aria-checked="true" data-src="random">Random text</button>
            <button role="radio" aria-checked="false" data-src="custom">Write your own</button>
          </div>
          <div class="preview" id="src-random">
            <div class="row spread"><h3 id="r-title">…</h3><button class="btn outline small" id="shuffle">${I.refresh} Shuffle</button></div>
            <p id="r-text" class="muted">Loading…</p>
          </div>
          <div class="pane" id="src-custom" hidden>
            <label class="field">Title <input type="text" id="c-title" maxlength="60" placeholder="My tricky paragraph"></label>
            <label class="field">Text with mistakes in it <textarea id="c-text" maxlength="2000" placeholder="Their going to the park tomorow, me and him…"></textarea></label>
          </div>
          <p id="create-error" class="error" hidden></p>
          <div class="pane-actions"><span class="muted">You play first, then send the link.</span><button class="btn" id="create">Create room ${I.arrow}</button></div>
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

  let src = "random";
  let passage = null;
  for (const b of $app.querySelectorAll(".tile")) {
    b.onclick = () => {
      for (const x of $app.querySelectorAll(".tile")) x.setAttribute("aria-selected", String(x === b));
      document.getElementById("pane-create").hidden = b.dataset.mode !== "create";
      document.getElementById("pane-join").hidden = b.dataset.mode !== "join";
      if (b.dataset.mode === "join") document.getElementById("join-code").focus();
    };
  }
  for (const b of $app.querySelectorAll(".segmented button")) {
    b.onclick = () => {
      src = b.dataset.src;
      for (const x of $app.querySelectorAll(".segmented button")) x.setAttribute("aria-checked", String(x === b));
      document.getElementById("src-random").hidden = src !== "random";
      document.getElementById("src-custom").hidden = src !== "custom";
    };
  }
  const shuffle = async () => {
    passage = await api(`/random${passage ? `?not=${passage.id}` : ""}`);
    document.getElementById("r-title").textContent = passage.title;
    const t = document.getElementById("r-text");
    t.textContent = passage.text;
    t.classList.remove("muted");
  };
  document.getElementById("shuffle").onclick = shuffle;
  shuffle().catch(() => {});

  document.getElementById("create").onclick = async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("create-error");
    errEl.hidden = true;
    btn.disabled = true;
    try {
      const body =
        src === "random"
          ? { source: "random", passageId: passage?.id }
          : { source: "custom", title: document.getElementById("c-title").value, text: document.getElementById("c-text").value };
      const { code } = await api("/duels", { method: "POST", body });
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

// ---------------------------------------------------------------- Learn: solo practice with hints

const issueKey = (l) => `${l.rule}|${l.text.toLowerCase()}`;

async function renderFreePractice() {
  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><a class="back" href="#/learn">${I.back} Learn</a><h1>Free practice</h1><p class="muted">Fix the underlined mistakes, then check your work. Use a hint if you're stuck. Nothing is scored.</p></div>
      <div class="toolbar-actions">
        <button class="btn outline" id="l-reset">${I.undo} Start over</button>
        <button class="btn" id="l-check">${I.check.replace('fill="var(--green)"', 'fill="none"')} Check my text</button>
      </div>
    </div>
    <div class="workspace three">
      <aside class="card side">
        <section><h3>Progress</h3><p class="big-num"><b id="l-fixed">0</b> <small>of <span id="l-total">0</span> fixed</small></p><div class="bar"><i id="l-bar"></i></div></section>
        <section><h3>Text</h3>
          <div class="segmented" role="radiogroup" aria-label="Text to practise on">
            <button role="radio" aria-checked="true" data-src="premade">Ready-made</button>
            <button role="radio" aria-checked="false" data-src="own">My own</button>
          </div>
          <div id="l-premade" class="stack-sm"><p class="muted small" id="l-ptitle">…</p><button class="btn outline small block" id="l-shuffle">${I.refresh} Shuffle text</button></div>
          <div id="l-own" class="stack-sm" hidden>
            <textarea id="l-owntext" maxlength="2000" placeholder="Paste or type any English text…" style="min-height:120px"></textarea>
            <button class="btn small block" id="l-useown">Practise on this text</button>
          </div>
        </section>
        <section><h3>How it works</h3><ul class="checks"><li>${I.check} Underlined words contain a mistake</li><li>${I.check} Fix them in the text</li><li>${I.check} Stuck? Open a hint or the answer</li><li>${I.check} “Check my text” rescans your edits</li></ul></section>
      </aside>
      <section class="card list-card">
        <div class="list-head"><h3>Mistakes <span class="muted" id="l-count"></span></h3></div>
        <ul class="rows" id="l-list"><li class="empty-row">Loading…</li></ul>
      </section>
      <div class="sheet-wrap">
        <div class="sheet">
          <div class="sheet-head"><span><b>Name :</b> ${esc(me.name)}</span><span><b>Date :</b> ${fmtDate()}</span></div>
          <h1 class="sheet-title" id="l-title">…</h1>
          <div class="editor">
            <div class="editor-marks" id="l-marks" aria-hidden="true"></div>
            <textarea id="l-answer" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Text to correct"></textarea>
          </div>
          <div class="editor-hint" id="l-status"><i></i>Underlined words contain a mistake. An underline disappears once you change that word.</div>
        </div>
      </div>
    </div>`;

  const answer = document.getElementById("l-answer");
  const editor = mountEditor(answer, document.getElementById("l-marks"), "", []);
  const list = document.getElementById("l-list");
  const status = document.getElementById("l-status");
  // `original`: the lints of the text as loaded (what the player is fixing).
  // `current`: lints from the latest check (null until the first check).
  const state = { original: [], current: null, passageId: null, loading: false };

  const withIds = (lints) => lints.map((l, i) => ({ ...l, id: i }));
  const fixedSet = () => {
    if (!state.current) return new Set();
    const pool = new Map();
    for (const l of state.current) pool.set(issueKey(l), (pool.get(issueKey(l)) ?? 0) + 1);
    const fixed = new Set();
    for (const l of state.original) {
      const k = issueKey(l);
      if (pool.get(k) > 0) pool.set(k, pool.get(k) - 1);
      else fixed.add(l.id);
    }
    return fixed;
  };

  const renderList = () => {
    const fixed = fixedSet();
    const origKeys = new Set(state.original.map(issueKey));
    const added = state.current ? state.current.filter((l) => !origKeys.has(issueKey(l))) : [];
    const item = (l, kind) => {
      const fix = l.suggestions?.[0]?.text;
      const icon = kind === "fixed" ? I.ok : kind === "new" ? I.miss : I.dot;
      const tag = kind === "fixed" ? `<span class="tag ok">fixed</span>` : kind === "new" ? `<span class="tag miss">new</span>` : "";
      return `<li class="answer ${kind}">${icon}<div><span class="found">${esc(l.text)}</span>
        <div class="reveal" hidden data-hint><span>${I.bulb}</span><p>${esc(l.message)}</p></div>
        <div class="reveal" hidden data-sol><span>${I.eye}</span><p>${fix != null ? `Answer: <b>${esc(fix || "(remove it)")}</b>` : "No automatic fix. Read the hint."}</p></div>
        ${kind === "fixed" ? "" : `<div class="reveal-btns"><button class="linkbtn small" data-show="hint">${I.bulb} Hint</button><button class="linkbtn small" data-show="sol">${I.eye} Answer</button></div>`}
        </div>${tag}</li>`;
    };
    const rows = [...state.original.map((l) => item(l, fixed.has(l.id) ? "fixed" : "open")), ...added.map((l) => item(l, "new"))];
    list.innerHTML = rows.join("") || `<li class="empty-row">No mistakes found.</li>`;
    for (const b of list.querySelectorAll("[data-show]")) {
      b.onclick = () => {
        const box = b.closest("li").querySelector(b.dataset.show === "hint" ? "[data-hint]" : "[data-sol]");
        box.hidden = !box.hidden;
      };
    }
    document.getElementById("l-count").textContent = `(${state.original.length})`;
    document.getElementById("l-fixed").textContent = fixed.size;
    document.getElementById("l-total").textContent = state.original.length;
    document.getElementById("l-bar").style.width = `${state.original.length ? (100 * fixed.size) / state.original.length : 0}%`;
  };

  const load = async (title, text) => {
    state.loading = true;
    list.innerHTML = `<li class="empty-row">Checking the text…</li>`;
    try {
      const { lints } = await api("/check", { method: "POST", body: { text } });
      state.original = withIds(lints);
      state.current = null;
      document.getElementById("l-title").textContent = title;
      editor.load(text, state.original);
      status.innerHTML = lints.length ? `<i></i>Underlined words contain a mistake. An underline disappears once you change that word.` : "Harper finds no mistakes in this text. Try another one!";
      renderList();
    } catch (x) {
      list.innerHTML = `<li class="empty-row error">${esc(x.message)}</li>`;
    } finally {
      state.loading = false;
    }
  };

  const shuffle = async () => {
    const p = await api(`/random${state.passageId != null ? `?not=${state.passageId}` : ""}`);
    state.passageId = p.id;
    document.getElementById("l-ptitle").textContent = p.title;
    await load(p.title, p.text);
  };

  for (const b of $app.querySelectorAll(".segmented button")) {
    b.onclick = () => {
      for (const x of $app.querySelectorAll(".segmented button")) x.setAttribute("aria-checked", String(x === b));
      document.getElementById("l-premade").hidden = b.dataset.src !== "premade";
      document.getElementById("l-own").hidden = b.dataset.src !== "own";
    };
  }
  document.getElementById("l-shuffle").onclick = () => !state.loading && shuffle();
  document.getElementById("l-useown").onclick = () => {
    const text = document.getElementById("l-owntext").value.trim();
    if (text.length < 3) return toast("Type or paste some text first");
    load("Your text", text);
  };
  document.getElementById("l-reset").onclick = () => {
    editor.reset();
    state.current = null;
    renderList();
  };
  document.getElementById("l-check").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { lints } = await api("/check", { method: "POST", body: { text: answer.value } });
      state.current = lints;
      editor.rebase(lints);
      renderList();
      const fixed = fixedSet().size;
      const added = lints.filter((l) => !new Set(state.original.map(issueKey)).has(issueKey(l))).length;
      status.innerHTML =
        fixed === state.original.length && !added
          ? `<b class="good">All fixed. Nice work!</b>&nbsp;Shuffle for another text.`
          : `<i></i>${fixed} of ${state.original.length} fixed${added ? `, ${added} new` : ""}. Underlines show what Harper still flags.`;
    } catch (x) {
      toast(x.message);
    } finally {
      btn.disabled = false;
    }
  };

  shuffle().catch((x) => (list.innerHTML = `<li class="empty-row error">${esc(x.message)}</li>`));
}


// ================================================================ Learn: Duolingo-style path, lessons, leaderboard, CMS

I.heart = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1.1 8.3 3.2 4.5 7 4.5c2.1 0 3.6 1.1 5 2.9 1.4-1.8 2.9-2.9 5-2.9 3.8 0 5.9 3.8 4.5 7.2C19.5 16.4 12 21 12 21z" fill="#ff4b62"/></svg>`;
I.fire = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 5.5 5 10.5A5 5 0 0 1 7 13c0-2 1-3.5 2-4.5.3 1.7 1.2 2.7 2.2 3C10.6 8.5 11 5 12 2z" fill="#ff9a1f"/><path d="M12 13c.6 1.6 2 2.2 2 4a2 2 0 0 1-4 0c0-1 .5-1.6 1-2 .1.8.5 1.2 1 1.3-.2-1.3-.3-2.3 0-3.3z" fill="#ffd56b"/></svg>`;
I.bolt = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7z" fill="#ffc21a"/></svg>`;
I.star = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z" fill="currentColor"/></svg>`;
I.lock = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="2.2" fill="none"/></svg>`;
I.tick = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.close = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
I.cup = `<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M24 12h32v18a16 16 0 0 1-32 0z" fill="url(#gGreen)"/><path d="M24 18H14a10 10 0 0 0 10 12M56 18h10a10 10 0 0 1-10 12" stroke="url(#gNavy)" stroke-width="5" fill="none"/><rect x="36" y="44" width="8" height="12" fill="url(#gNavy)"/><rect x="26" y="56" width="28" height="10" rx="3" fill="url(#gNavy)"/><path d="m40 19 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff"/></svg>`;
I.edit = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>`;
I.trash = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.up = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12l5-5 5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.down = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
I.plus = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
I.chat = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h13v9H9l-4 3v-3H3.5z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M7 8.2h6M7 10.8h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const QUESTS = [20, 50, 100, 250, 500, 1000];
const fmtMinutes = (ms) => `${Math.max(1, Math.ceil(ms / 60000))} min`;

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
  const unitHtml = units
    .map((u, ui) => {
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
            <a class="node ${state}" ${locked ? 'aria-disabled="true" tabindex="-1"' : `href="#/learn/lesson/${l.id}"`} title="${esc(l.title)}${locked ? " (locked)" : ""}" style="--pct:${pct}">
              ${icon}
            </a>
            <span class="node-label">${esc(l.title)}</span>
          </div>`;
        })
        .join("");
      const unitCurrent = u.lessons.some((l) => l.id === current);
      const unitDone = u.lessons.length > 0 && u.lessons.every((l) => l.total > 0 && l.done >= l.total);
      return `<section class="unit">
        <header class="unit-banner ${ui % 2 ? "alt" : ""}">
          <div><span class="unit-no">Unit ${ui + 1}</span><h2>${esc(u.title)}</h2><p>${esc(u.description)}</p></div>
          <div class="banner-actions">
            ${unitCurrent ? `<a class="btn light" href="#/learn/lesson/${current}">Continue</a>` : ""}
            <button class="banner-link" data-feedback="${u.id}" title="Suggest an improvement to this unit">${I.chat} Suggest a change</button>
          </div>
        </header>
        <div class="path">${nodes || `<p class="muted">No lessons yet.</p>`}</div>
        ${
          unitDone && !u.feedbackSent
            ? `<div class="card unit-done"><span class="unit-done-icon">${I.cup}</span><div><b>Unit complete! How was “${esc(u.title)}”?</b><p class="muted small">Tell us what to improve: too easy, too hard, a mistake in a lesson, or an idea.</p></div>
                <div class="stars" role="group" aria-label="Rate this unit">${[1, 2, 3, 4, 5].map((n) => `<button class="star" data-feedback="${u.id}" data-rating="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${I.star}</button>`).join("")}</div>
                <button class="btn outline small" data-feedback="${u.id}">Suggest an improvement</button></div>`
            : unitDone
              ? `<p class="unit-thanks">${I.check} Thanks for your feedback on this unit!</p>`
              : ""
        }
      </section>`;
    })
    .join("");

  const quests = QUESTS.map((q) => {
    const pct = Math.min(100, Math.round((100 * stats.xp) / q));
    return `<li><div class="row spread"><span>Earn ${q} XP</span><span class="muted small">${Math.min(stats.xp, q)}/${q}</span></div><div class="bar"><i style="width:${pct}%"></i></div></li>`;
  }).join("");

  $app.innerHTML = `
    <div class="learn">
      <div class="learn-main">${unitHtml || `<section class="card picker"><header class="picker-head"><h2>No lessons yet</h2><p class="muted">An admin can add units and lessons in the content editor.</p></header></section>`}</div>
      <aside class="learn-side">
        <section class="card side-card">${statChips(stats)}
          ${stats.hearts < stats.maxHearts ? `<p class="muted small">Next heart in ${fmtMinutes(stats.nextHeartMs)}. Practising a finished lesson also earns hearts.</p>` : `<p class="muted small">Full hearts. You lose one for each wrong answer.</p>`}
        </section>
        <section class="card side-card"><div class="row spread"><h3>Leaderboard</h3><a href="#/leaderboard" class="small">View all</a></div>
          <ol class="mini-board">${
            board.rows.length
              ? board.rows.slice(0, 5).map((r) => `<li class="${r.isYou ? "you" : ""}"><span class="rank">${r.rank}</span>${avatar(r)}<span class="name">${esc(r.name)}</span><b>${r.xp} XP</b></li>`).join("")
              : `<li class="muted small">No XP this week yet. Finish a lesson to get on the board!</li>`
          }</ol>
        </section>
        <section class="card side-card"><h3>Quests</h3><ul class="quests">${quests}</ul></section>
        <section class="card side-card practice-card"><h3>Free practice</h3><p class="muted small">Shuffle through texts or paste your own, with hints from Harper.</p><a class="btn outline small" href="#/learn/free">Open free practice</a></section>
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
}

// ---------------------------------------------------------------- unit feedback ("suggest an improvement")

const FEEDBACK_CATEGORIES = [
  ["too-easy", "Too easy"],
  ["too-hard", "Too hard"],
  ["mistake", "Mistake in a lesson"],
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
    <p class="muted small">Unit: <b>${esc(unit.title)}</b></p>
    <div class="stars big" role="group" aria-label="How was this unit?">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-n="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${I.star}</button>`).join("")}</div>
    <div class="fb-cats" role="group" aria-label="What kind of suggestion?">${FEEDBACK_CATEGORIES.map(([k, label]) => `<button type="button" class="fb-cat" data-cat="${k}" aria-pressed="false">${label}</button>`).join("")}</div>
    <label class="field">What should change? <textarea id="fb-text" maxlength="1000" required placeholder="For example: the second lesson's question about “than” was confusing because…"></textarea></label>
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

// ---------------------------------------------------------------- the lesson player

async function renderLesson(id) {
  document.body.classList.add("focus");
  $app.innerHTML = `<p class="muted loading">Loading lesson…</p>`;
  let data;
  try {
    data = await api(`/learn/lessons/${id}`);
  } catch (x) {
    document.body.classList.remove("focus");
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>Hmm.</h2><p class="muted">${esc(x.message)}</p></header><div class="row" style="justify-content:center"><a class="btn" href="#/learn">Back to Learn</a></div></section>`;
    return;
  }
  const { lesson } = data;
  let stats = data.stats;
  const all = lesson.challenges;
  const practice = all.length > 0 && all.every((c) => c.completed);
  // New challenges first; when practising a finished lesson, all of them.
  const queue = practice ? [...all] : all.filter((c) => !c.completed);
  const total = queue.length;
  let solved = 0;
  let mistakes = 0;
  let xpEarned = 0;

  if (!total) {
    document.body.classList.remove("focus");
    $app.innerHTML = `<section class="card picker"><header class="picker-head"><h2>This lesson is empty</h2><p class="muted">An admin can add challenges in the content editor.</p></header><div class="row" style="justify-content:center"><a class="btn" href="#/learn">Back to Learn</a></div></section>`;
    return;
  }

  $app.innerHTML = `
    <div class="lesson">
      <header class="lesson-top">
        <button class="icon-btn" id="quit" aria-label="Quit lesson">${I.close}</button>
        <div class="progress" role="progressbar" aria-label="Lesson progress" aria-valuemin="0" aria-valuemax="${total}"><i id="prog"></i></div>
        <span class="hearts" title="${practice ? "Practice: no hearts lost" : "Hearts"}">${I.heart}<b id="hearts">${practice ? "∞" : stats.hearts}</b></span>
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
    if (!practice) document.getElementById("hearts").textContent = stats.hearts;
  };
  document.getElementById("quit").onclick = () => {
    if (solved === 0 || confirm("Quit the lesson? Your progress on finished challenges is saved.")) location.hash = "#/learn";
  };

  let challenge = null;
  let mode = "check"; // check | continue | retry
  let selected = null;
  let editor = null;

  const outOfHearts = () => {
    const d = document.createElement("div");
    d.className = "modal-back";
    d.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-labelledby="oh-title">
      <span class="modal-icon">${I.heart}</span>
      <h2 id="oh-title">You ran out of hearts</h2>
      <p class="muted">Practise a lesson you've finished to earn hearts back, or wait: the next one comes back in ${fmtMinutes(stats.nextHeartMs)}.</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#/learn">Back to Learn</a></div>
    </div>`;
    document.body.append(d);
    addEventListener("hashchange", () => d.remove(), { once: true });
  };

  const show = () => {
    challenge = queue[0];
    selected = null;
    editor = null;
    mode = "check";
    foot.className = "lesson-foot";
    feedback.innerHTML = "";
    action.textContent = "Check";
    action.disabled = true;
    if (challenge.type === "choose") {
      stage.innerHTML = `<h1 class="q">${esc(challenge.question)}</h1>
        <div class="options">${challenge.options
          .map((o, i) => `<button class="option" data-id="${o.id}" aria-pressed="false"><span class="key">${i + 1}</span><span>${esc(o.text)}</span></button>`)
          .join("")}</div>`;
      for (const b of stage.querySelectorAll(".option")) {
        b.onclick = () => {
          if (mode !== "check") return;
          selected = Number(b.dataset.id);
          for (const x of stage.querySelectorAll(".option")) x.setAttribute("aria-pressed", String(x === b));
          action.disabled = false;
        };
      }
    } else {
      stage.innerHTML = `<h1 class="q">${esc(challenge.question)}</h1>
        <div class="sheet lesson-sheet">
          <div class="editor"><div class="editor-marks" id="lmarks" aria-hidden="true"></div><textarea id="ltext" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Text to correct"></textarea></div>
        </div>
        <p class="editor-hint"><i></i>Underlined words contain a mistake. Edit the text, then press Check.</p>`;
      const ta = document.getElementById("ltext");
      editor = mountEditor(ta, document.getElementById("lmarks"), challenge.text, challenge.marks);
      editor.reset();
      ta.addEventListener("input", () => (action.disabled = mode === "check" && ta.value.trim() === challenge.text.trim()));
      ta.focus();
    }
  };

  const finish = () => {
    sfx.done();
    document.body.classList.remove("focus");
    const accuracy = Math.round((100 * total) / (total + mistakes));
    $app.innerHTML = `<section class="card finish">
      <span class="finish-icon">${I.cup}</span>
      <h1>${practice ? "Practice complete!" : "Lesson complete!"}</h1>
      <p class="muted">${esc(lesson.unitTitle)} · ${esc(lesson.title)}</p>
      <div class="finish-stats">
        <div class="fstat xp"><span>Total XP</span><b>${I.bolt}${xpEarned}</b></div>
        <div class="fstat acc"><span>Accuracy</span><b>${accuracy}%</b></div>
        <div class="fstat hp"><span>Hearts</span><b>${I.heart}${stats.hearts}</b></div>
      </div>
      <div id="unit-feedback"></div>
      <div class="row" style="justify-content:center"><a class="btn big" href="#/learn">Continue</a></div>
    </section>`;
    // Finished the whole unit? Ask how it was (once).
    api("/learn")
      .then(({ units }) => {
        const u = units.find((x) => x.id === lesson.unitId);
        const done = u && u.lessons.length > 0 && u.lessons.every((l) => l.total > 0 && l.done >= l.total);
        const slot = document.getElementById("unit-feedback");
        if (!done || u.feedbackSent || !slot) return;
        slot.innerHTML = `<div class="unit-done compact"><div><b>You finished the unit “${esc(u.title)}”!</b><p class="muted small">Is there anything we should change? Your suggestion goes straight to the people who write the lessons.</p></div><button class="btn outline small" id="finish-fb">Suggest an improvement</button></div>`;
        document.getElementById("finish-fb").onclick = () => openFeedback(u, 0, () => (slot.innerHTML = `<p class="unit-thanks">${I.check} Thanks for your feedback!</p>`));
      })
      .catch(() => {});
  };

  action.onclick = async () => {
    if (mode === "continue") {
      queue.shift();
      if (!queue.length) return finish();
      return show();
    }
    if (mode === "retry") {
      mode = "check";
      foot.className = "lesson-foot";
      feedback.innerHTML = "";
      action.textContent = "Check";
      if (challenge.type === "choose") {
        for (const x of stage.querySelectorAll(".option")) x.classList.remove("wrong", "right");
        action.disabled = selected == null;
      } else document.getElementById("ltext").focus();
      return;
    }
    action.disabled = true;
    let res;
    try {
      const body = challenge.type === "choose" ? { optionId: selected } : { text: document.getElementById("ltext").value };
      res = await api(`/learn/challenges/${challenge.id}/answer`, { method: "POST", body });
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
    if (res.correct) {
      sfx.right();
      solved++;
      xpEarned += res.xp;
      setProgress();
      mode = "continue";
      foot.className = "lesson-foot right";
      feedback.innerHTML = `<span class="fb-icon">${I.tick}</span><div><b>Nicely done!</b><span>+${res.xp} XP${res.practice ? " · +1 heart" : ""}</span></div>`;
      action.textContent = "Continue";
      if (challenge.type === "choose") stage.querySelector(`.option[data-id="${selected}"]`)?.classList.add("right");
      else editor.rebase([]);
    } else {
      sfx.wrong();
      mistakes++;
      mode = "retry";
      foot.className = "lesson-foot wrong";
      if (challenge.type === "choose") {
        stage.querySelector(`.option[data-id="${selected}"]`)?.classList.add("wrong");
        feedback.innerHTML = `<span class="fb-icon">${I.close}</span><div><b>Not quite</b><span>${res.practice ? "Have another look." : "You lost a heart. Have another look."}</span></div>`;
      } else {
        const left = [...res.remaining, ...res.introduced];
        editor.rebase(left);
        const hint = left[0]?.message;
        feedback.innerHTML = `<span class="fb-icon">${I.close}</span><div><b>Not quite: ${res.fixed} of ${res.total} fixed${res.introduced.length ? `, ${res.introduced.length} new` : ""}</b>
          ${hint ? `<span>Hint: ${esc(hint)}</span>` : ""}
          <details class="answer-reveal"><summary>Show answer</summary><span>${esc(res.solution)}</span></details></div>`;
      }
      action.textContent = "Try again";
      if (!res.practice && stats.hearts <= 0) {
        action.disabled = true;
        return outOfHearts();
      }
    }
    action.disabled = false;
  };

  // Keyboard: Enter = Check/Continue (Ctrl+Enter inside the text), 1-9 = pick an option.
  const onKey = (e) => {
    if (!document.getElementById("stage")) return removeEventListener("keydown", onKey);
    const inText = e.target.tagName === "TEXTAREA";
    if (e.key === "Enter" && (!inText || e.ctrlKey || e.metaKey) && !action.disabled) {
      e.preventDefault();
      action.click();
    } else if (!inText && challenge?.type === "choose" && /^[1-9]$/.test(e.key)) {
      stage.querySelectorAll(".option")[Number(e.key) - 1]?.click();
    }
  };
  addEventListener("keydown", onKey);

  setProgress();
  show();
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
      <header class="picker-head"><span class="board-icon">${I.cup}</span><h2>Leaderboard</h2><p class="muted">Earn XP in Learn to climb. ${period === "week" ? "Resets every Monday." : ""}</p></header>
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

function drawAdmin() {
  const units = cms.content.units;
  if (!allLessons().some((l) => l.id === cms.lessonId)) cms.lessonId = allLessons()[0]?.id ?? null;
  const counts = { units: units.length, lessons: allLessons().length, challenges: allLessons().reduce((n, l) => n + l.challenges.length, 0) };
  const tools = (kind, id) => `<span class="tools">
      <button class="icon-btn sm" data-move="${kind}:${id}:-1" title="Move up">${I.up}</button>
      <button class="icon-btn sm" data-move="${kind}:${id}:1" title="Move down">${I.down}</button>
      <button class="icon-btn sm" data-edit="${kind}:${id}" title="Edit">${I.edit}</button>
      <button class="icon-btn sm danger" data-del="${kind}:${id}" title="Delete">${I.trash}</button></span>`;
  const tree = units
    .map(
      (u, ui) => `<li class="tree-unit"><div class="tree-row unit-row"><span><span class="muted small">Unit ${ui + 1}</span>${u.newFeedback ? ` <button class="count" data-goto-feedback title="New suggestions for this unit">${u.newFeedback} new</button>` : ""}<br><b>${esc(u.title)}</b></span>${tools("unit", u.id)}</div>
        <ul>${u.lessons
          .map((l) => `<li><div class="tree-row lesson-row ${l.id === cms.lessonId ? "active" : ""}" data-pick="${l.id}"><span>${esc(l.title)} <span class="muted small">(${l.challenges.length})</span></span>${tools("lesson", l.id)}</div></li>`)
          .join("")}
          <li><button class="linkbtn small" data-add-lesson="${u.id}">${I.plus} Add lesson</button></li></ul></li>`,
    )
    .join("");
  const lesson = allLessons().find((l) => l.id === cms.lessonId);

  $app.innerHTML = `
    <div class="toolbar">
      <div class="page-head"><h1>Content editor</h1><p class="muted">${counts.units} units · ${counts.lessons} lessons · ${counts.challenges} challenges · ${cms.content.players} players · ${cms.content.xpToday} XP earned today</p></div>
      <div class="toolbar-actions">
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected="true" data-view="content">Content</button>
          <button role="tab" aria-selected="false" data-view="feedback">Suggestions${cms.content.newFeedback ? ` <span class="count">${cms.content.newFeedback}</span>` : ""}</button>
        </div>
        <button class="btn" id="add-unit">${I.plus} New unit</button>
      </div>
    </div>
    <div class="cms">
      <aside class="card cms-tree"><ul class="tree">${tree || `<li class="muted small">No units yet. Add one!</li>`}</ul></aside>
      <section class="card cms-main" id="cms-main"></section>
    </div>`;

  const main = document.getElementById("cms-main");
  if (cms.editing) drawChallengeForm(main, cms.editing);
  else if (lesson) {
    main.innerHTML = `
      <div class="list-head"><div><span class="muted small">${esc(lesson.unit.title)}</span><h2>${esc(lesson.title)}</h2></div>
        <button class="btn" id="add-ch">${I.plus} Add challenge</button></div>
      <ul class="rows">${
        lesson.challenges
          .map(
            (c, i) => `<li class="ch-row"><span class="badge ${c.type}">${c.type === "fix" ? "Fix the text" : "Multiple choice"}</span>
              <div><b>${i + 1}. ${esc(c.question)}</b><p class="muted small">${
                c.type === "fix"
                  ? `${markedHtml(c.text, c.lints)} <span class="pill">${c.lints.length} ${c.lints.length === 1 ? "mistake" : "mistakes"}</span>`
                  : c.options.map((o) => (o.correct ? `<b class="good">${esc(o.text)}</b>` : esc(o.text))).join(" · ")
              }</p></div>${tools("challenge", c.id)}</li>`,
          )
          .join("") || `<li class="empty-row">No challenges yet. Add the first one!</li>`
      }</ul>`;
    document.getElementById("add-ch").onclick = () => {
      cms.editing = { lessonId: lesson.id, type: "fix", question: "Fix the mistake.", text: "", options: [{ text: "", correct: true }, { text: "", correct: false }] };
      drawAdmin();
    };
  } else main.innerHTML = `<p class="empty-row">Add a unit and a lesson to start.</p>`;

  for (const b of $app.querySelectorAll("[data-view]")) b.onclick = () => b.dataset.view === "feedback" && drawFeedback();
  for (const b of $app.querySelectorAll("[data-goto-feedback]")) b.onclick = () => drawFeedback();
  document.getElementById("add-unit").onclick = async () => {
    const title = prompt("Unit title:");
    if (!title) return;
    const description = prompt("Short description (optional):") ?? "";
    if (await cmsDo("POST", "/units", { title, description })) drawAdmin();
  };
  for (const b of $app.querySelectorAll("[data-add-lesson]")) {
    b.onclick = async () => {
      const title = prompt("Lesson title:");
      if (title && (await cmsDo("POST", "/lessons", { unitId: Number(b.dataset.addLesson), title }))) {
        cms.lessonId = allLessons().at(-1)?.id ?? cms.lessonId;
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
      const what = { unit: "this unit and all its lessons", lesson: "this lesson and its challenges", challenge: "this challenge" }[kind];
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
        const u = units.find((x) => x.id === id);
        const title = prompt("Unit title:", u.title);
        if (title == null) return;
        const description = prompt("Description:", u.description) ?? u.description;
        if (await cmsDo("PUT", `/units/${id}`, { title, description })) drawAdmin();
      } else if (kind === "lesson") {
        const l = allLessons().find((x) => x.id === id);
        const title = prompt("Lesson title:", l.title);
        if (title != null && (await cmsDo("PUT", `/lessons/${id}`, { title }))) drawAdmin();
      } else {
        const c = allLessons().flatMap((l) => l.challenges.map((ch) => ({ ...ch, lessonId: l.id }))).find((x) => x.id === id);
        cms.editing = { ...c, options: c.options.length ? c.options.map((o) => ({ ...o })) : [{ text: "", correct: true }, { text: "", correct: false }] };
        drawAdmin();
      }
    };
  }
}

/** The "Suggestions" view: players' unit feedback, newest first. */
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
      <div class="page-head"><h1>Suggestions</h1><p class="muted">What players think should change in each unit. ${data.newCount} new.</p></div>
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
          .join("") || `<li class="empty-row">${filter === "new" ? "No new suggestions. Players can send one from any unit on the Learn page." : "Nothing here."}</li>`
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

function drawChallengeForm(main, ch) {
  main.innerHTML = `
    <div class="list-head"><h2>${ch.id ? "Edit challenge" : "New challenge"}</h2><button class="btn outline small" id="cancel">Cancel</button></div>
    <div class="form">
      <div class="segmented" role="radiogroup" aria-label="Challenge type">
        <button role="radio" aria-checked="${ch.type === "fix"}" data-type="fix">Fix the text</button>
        <button role="radio" aria-checked="${ch.type === "choose"}" data-type="choose">Multiple choice</button>
      </div>
      <label class="field">Question or instruction <input type="text" id="f-q" maxlength="200" value="${esc(ch.question)}"></label>
      <div id="f-fix" ${ch.type === "fix" ? "" : "hidden"}>
        <label class="field">Text with mistakes <textarea id="f-text" maxlength="1000" placeholder="We was late for school.">${esc(ch.text ?? "")}</textarea></label>
        <div class="row"><button class="btn outline small" id="f-preview">Check with Harper</button><span class="muted small">Players must fix everything Harper underlines.</span></div>
        <div class="preview" id="f-out" hidden></div>
      </div>
      <div id="f-choose" ${ch.type === "choose" ? "" : "hidden"}>
        <span class="field">Options <span class="muted small">(pick the correct one)</span></span>
        <ul class="opt-edit" id="f-opts">${ch.options
          .map(
            (o, i) => `<li><input type="radio" name="correct" value="${i}" ${o.correct ? "checked" : ""} aria-label="Correct answer"><input type="text" value="${esc(o.text)}" maxlength="200" placeholder="Option ${i + 1}"><button class="icon-btn sm danger" data-rm="${i}" title="Remove">${I.trash}</button></li>`,
          )
          .join("")}</ul>
        <button class="linkbtn small" id="f-addopt">${I.plus} Add option</button>
      </div>
      <p class="error" id="f-err" hidden></p>
      <div class="pane-actions"><span></span><button class="btn" id="f-save">Save challenge</button></div>
    </div>`;
  const collect = () => {
    ch.question = document.getElementById("f-q").value;
    ch.text = document.getElementById("f-text").value;
    ch.options = [...document.querySelectorAll("#f-opts li")].map((li, i) => ({ text: li.querySelector('input[type="text"]').value, correct: li.querySelector('input[type="radio"]').checked }));
    return ch;
  };
  document.getElementById("cancel").onclick = () => {
    cms.editing = null;
    drawAdmin();
  };
  for (const b of main.querySelectorAll("[data-type]")) {
    b.onclick = () => {
      collect().type = b.dataset.type;
      drawChallengeForm(main, ch);
    };
  }
  document.getElementById("f-addopt").onclick = () => {
    collect().options.push({ text: "", correct: false });
    drawChallengeForm(main, ch);
  };
  for (const b of main.querySelectorAll("[data-rm]")) {
    b.onclick = () => {
      collect().options.splice(Number(b.dataset.rm), 1);
      drawChallengeForm(main, ch);
    };
  }
  document.getElementById("f-preview").onclick = async () => {
    const out = document.getElementById("f-out");
    const text = document.getElementById("f-text").value;
    try {
      const { lints } = await api("/admin/preview", { method: "POST", body: { text } });
      out.hidden = false;
      out.innerHTML = lints.length
        ? `<p class="sheet-text">${markedHtml(text, lints)}</p><ul class="checks">${lints.map((l) => `<li>${I.check}<span><b>${esc(l.text)}</b> → ${esc(l.suggestions[0]?.text ?? "?")}: <span class="muted">${esc(l.message)}</span></span></li>`).join("")}</ul>`
        : `<p class="error">Harper finds no mistakes in this text, so players would have nothing to fix.</p>`;
    } catch (x) {
      toast(x.message);
    }
  };
  document.getElementById("f-save").onclick = async () => {
    collect();
    const body = { type: ch.type, question: ch.question, lessonId: ch.lessonId, text: ch.text, options: ch.options };
    const err = document.getElementById("f-err");
    try {
      cms.content = await api(ch.id ? `/admin/challenges/${ch.id}` : "/admin/challenges", { method: ch.id ? "PUT" : "POST", body });
      cms.editing = null;
      cms.lessonId = ch.lessonId;
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
  if (location.hash.startsWith("#/learn/free")) return renderFreePractice();
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
