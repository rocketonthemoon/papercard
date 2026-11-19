<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { code } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let duel = $state(null);
  let answers = $state([]);
  let at = $state(0);
  let timerText = $state('0:00');
  let timerInterval = null;
  let submitting = $state(false);
  let results = $state(null);

  function fmtTime(ms) {
    if (!ms && ms !== 0) return '0:00';
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  onMount(async () => {
    try {
      loading = true;
      const res = await api(`/duels/${code}`);
      duel = res;

      if (res.you?.submitted) {
        results = res;
      } else {
        answers = Array(res.count).fill(null);
        try {
          const saved = JSON.parse(localStorage.getItem(`labas-duel-${code}`) || 'null');
          if (Array.isArray(saved) && saved.length === res.count) {
            answers = saved;
          }
        } catch {}

        const firstUnanswered = answers.indexOf(null);
        at = firstUnanswered >= 0 ? firstUnanswered : 0;

        const startTime = Date.now();
        timerInterval = setInterval(() => {
          timerText = fmtTime(Date.now() - startTime);
        }, 1000);
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load duel';
    } finally {
      loading = false;
    }

    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown);
    }
  });

  function handleKeydown(e) {
    if (loading || results || !currentQ) return;
    if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (currentQ.options && currentQ.options[idx]) {
        selectOption(currentQ.options[idx].id);
      }
    }
  }

  let currentQ = $derived(duel?.questions?.[at] || null);
  let answeredCount = $derived(answers.filter(a => a !== null).length);
  let answeredPct = $derived(duel?.count ? Math.round((100 * answeredCount) / duel.count) : 0);

  function selectOption(optId) {
    answers[at] = optId;
    answers = [...answers];
    try {
      localStorage.setItem(`labas-duel-${code}`, JSON.stringify(answers));
    } catch {}

    const next = answers.indexOf(null, at + 1) >= 0 ? answers.indexOf(null, at + 1) : answers.indexOf(null);
    if (next >= 0) {
      setTimeout(() => { at = next; }, 260);
    }
  }

  async function copyShareLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      appState.showToast('Invite link copied to clipboard!');
    } catch {
      prompt('Copy this link:', url);
    }
  }

  async function submitDuel() {
    const unanswered = duel.count - answeredCount;
    if (unanswered > 0) {
      if (!confirm(`You haven't answered ${unanswered} question${unanswered > 1 ? 's' : ''}. Submit anyway?`)) {
        return;
      }
    }

    try {
      submitting = true;
      const res = await api(`/duels/${code}/submit`, {
        method: 'POST',
        body: { answers },
      });
      try {
        localStorage.removeItem(`labas-duel-${code}`);
      } catch {}
      if (timerInterval) clearInterval(timerInterval);
      results = res;
    } catch (e) {
      errorMsg = e.message || 'Failed to submit answers';
    } finally {
      submitting = false;
    }
  }

  let toLangName = $derived(duel?.course?.toLang || 'Lithuanian');

  function promptHeading(q) {
    if (!q) return '';
    switch (q.kind) {
      case 'pick_en':
        return 'What does this mean?';
      case 'pick_lt':
        return `How do you say this in ${toLangName}?`;
      case 'type_lt':
        return `Write this in ${toLangName}`;
      case 'build':
        return `Translate this into ${toLangName}`;
      default:
        return 'What does this mean?';
    }
  }

  let user = $derived(appState.user);
</script>

<div>
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:60px 0;">Loading duel {code}…</p>
  {:else if errorMsg}
    <section class="card picker" style="max-width:540px;margin:20px auto;">
      <header class="picker-head">
        <h2>Something went wrong</h2>
        <p class="muted">{errorMsg}</p>
      </header>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <a class="btn btn-gate-pill" href="#/play">Back to Play</a>
      </div>
    </section>
  {:else if results}
    <!-- Results Screen (1:1 with web/game.js:374) -->
    {@const others = (results.players || []).filter(p => !p.isYou)}
    {@const youWon = results.winner && results.players?.[0]?.isYou}

    <div class="toolbar">
      <a class="back mono-tag" href="#/play">← Play</a>
      <div class="toolbar-actions">
        <button class="btn outline small" onclick={copyShareLink}>Invite link</button>
        <a class="btn btn-gate-pill small" href="#/play">New room →</a>
      </div>
    </div>

    <div class="workspace two" style="margin-top:16px;">
      <aside class="card side">
        <section>
          <h3>Your result</h3>
          <p class="score" style="margin:8px 0;">
            <b style="font-size:32px;font-weight:900;">{results.you?.points ?? 0}</b>
            <span class="muted" style="margin-left:6px;">/ {results.maxPoints ?? (results.count * 10)} points</span>
          </p>
        </section>

        <section style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
          <ul class="kv" style="list-style:none;padding:0;margin:0;">
            <li class="row spread" style="padding:4px 0;">
              <span>Right</span>
              <b class="good" style="color:var(--color-green, #179354);">{results.you?.correct ?? 0}/{results.count}</b>
            </li>
            <li class="row spread" style="padding:4px 0;">
              <span>Wrong</span>
              <b class="{results.count - (results.you?.correct ?? 0) ? 'bad' : ''}">
                {results.count - (results.you?.correct ?? 0)}
              </b>
            </li>
            <li class="row spread" style="padding:4px 0;">
              <span>Time</span>
              <b>{fmtTime(results.you?.elapsedMs)}</b>
            </li>
          </ul>
        </section>

        <section style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
          <h3>Scoreboard</h3>
          {#if !results.winner}
            <p class="muted small" style="margin:8px 0;">Waiting for a friend to play. Send them the invite link!</p>
          {:else if results.tie}
            <div class="winner tie" style="margin:8px 0;font-weight:700;">It's a tie!</div>
          {:else}
            <div class="winner" style="margin:8px 0;font-weight:700;">
              {youWon ? 'You win!' : `${results.winner} wins!`}
            </div>
          {/if}

          <ul class="people" style="list-style:none;padding:0;margin:12px 0 0;">
            {#each (results.players || []) as p}
              <li class="row spread {p.isYou ? 'you' : ''}" style="padding:8px 0;align-items:center;border-bottom:1px solid rgba(0,0,0,0.05);">
                <div class="row" style="gap:10px;align-items:center;">
                  <span class="muted small mono-tag">#{p.rank ?? 1}</span>
                  <span class="avatar-ph" style="width:28px;height:28px;line-height:28px;font-size:13px;">
                    {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                  </span>
                  <div>
                    <b style="font-size:14px;">{p.name}{p.isYou ? ' (you)' : ''}</b>
                    <br />
                    <span class="muted small mono-tag">{p.correct ?? 0}/{results.count} right · {fmtTime(p.elapsedMs)}</span>
                  </div>
                </div>
                <span class="pts mono-tag" style="font-weight:900;">
                  <b>{p.points ?? 0}</b> <small>pts</small>
                </span>
              </li>
            {/each}
          </ul>

          {#if !others.length}
            <button class="btn dashed block" style="width:100%;margin-top:14px;" onclick={copyShareLink}>
              Copy invite link
            </button>
          {/if}
        </section>
      </aside>

      <!-- Answer key card -->
      <section class="card list-card">
        <div class="list-head">
          <h3>Answer key · {results.title || 'Duel'}</h3>
          <span class="muted small">{results.you?.correct ?? 0} of {results.count} right</span>
        </div>
        <ul class="rows">
          {#each (results.key || []) as k}
            <li class="answer">
              {#if k.right}
                <Icon name="ok" class="mark-ok" />
              {:else}
                <Icon name="miss" class="mark-miss" />
              {/if}
              <div>
                <span class="found">{k.prompt}</span> → <b>{k.answer}</b>
                {#if !k.right}
                  <p class="muted small">You said: {k.yours != null ? k.yours : "(no answer)"}</p>
                {/if}
              </div>
              <span class="tag {k.right ? 'ok' : 'miss'}">{k.right ? 'right' : 'wrong'}</span>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {:else if duel}
    <!-- Active Duel Arena (1:1 with web/game.js:280) -->
    <div class="toolbar">
      <a class="back mono-tag" href="#/play">← Play</a>
      <div class="toolbar-actions">
        <button class="btn outline small" onclick={copyShareLink}>Invite link</button>
        <button class="btn btn-gate-pill small" id="submit" onclick={submitDuel} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit answers'}
        </button>
      </div>
    </div>

    <div class="workspace two" style="margin-top:16px;">
      <!-- Left sidebar -->
      <aside class="card side">
        <section>
          <h3>Duel</h3>
          <div class="row" style="margin:6px 0;">
            <span class="code-chip pill yellow mono-tag" style="font-size:16px;font-weight:900;letter-spacing:0.08em;">
              {duel.code}
            </span>
          </div>
          <p class="muted small">{duel.title} · set by {duel.creator?.name || 'Player'}</p>
        </section>

        <section style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
          <h3>Answered</h3>
          <p class="big-num mono-tag" style="font-size:22px;margin:4px 0;">
            <b>{answeredCount}</b> <small>of {duel.count}</small>
          </p>
          <div class="bar"><i style="width:{answeredPct}%;"></i></div>
        </section>

        <section style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
          <h3>Time</h3>
          <p class="timer mono-tag" style="font-size:22px;font-weight:800;margin:4px 0;">{timerText}</p>
        </section>

        <section style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
          <h3>Scoring</h3>
          <ul class="checks" style="list-style:none;padding:0;margin:6px 0;display:flex;flex-direction:column;gap:6px;font-size:13px;">
            <li>✓ +10 per right answer</li>
            <li>✓ One try; answers revealed at end</li>
            <li>✓ Ties go to the faster player</li>
          </ul>
        </section>

        <section style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
          <h3>Players ({duel.players?.length || 0})</h3>
          {#if duel.players?.length}
            <ul class="people" style="list-style:none;padding:0;margin:6px 0;">
              {#each duel.players as p}
                <li class="row" style="gap:8px;padding:4px 0;align-items:center;">
                  <span class="avatar-ph" style="width:24px;height:24px;line-height:24px;font-size:11px;">
                    {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                  </span>
                  <span>{p.name}</span>
                  <span class="played pill small" style="margin-left:auto;font-size:11px;">played</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted small">Nobody has played yet. Be the first, then send the link.</p>
          {/if}
        </section>
      </aside>

      <!-- Stable Question Arena Sheet -->
      <div class="sheet-wrap">
        <div class="sheet duel-sheet duel-arena">
          <div>
            <div class="sheet-head row spread" style="margin-bottom:12px;font-size:14px;border-bottom:1px solid rgba(0,0,0,0.08);padding-bottom:10px;">
              <span><b>Name :</b> {user?.name || 'Learner'}</span>
              <span><b>Date :</b> {fmtDate(duel.createdAt)}</span>
            </div>

            <!-- Question Number Dots -->
            <nav class="qdots" aria-label="Questions" style="margin-bottom:16px;">
              {#each (duel.questions || []) as _, i}
                <button
                  type="button"
                  class="qdot {answers[i] !== null ? 'done' : ''} {i === at ? 'at' : ''}"
                  onclick={() => at = i}
                  aria-label="Question {i + 1}"
                >
                  {i + 1}
                </button>
              {/each}
            </nav>

            <!-- Fixed-Size Question Box -->
            {#if currentQ}
              <div class="duel-q" id="qcard" style="display:flex;flex-direction:column;gap:14px;">
                <p class="muted small mono-tag" style="margin:0;">Question {at + 1} of {duel.count}</p>

                <h1 class="q" style="min-height:56px;display:flex;align-items:center;margin:0;font-size:26px;line-height:1.15;">
                  {promptHeading(currentQ)}
                </h1>

                <div class="prompt-card challenge-card" style="min-height:84px;height:84px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;">
                  <span class="prompt-word" style="font-size:24px;font-weight:900;">{currentQ.prompt}</span>
                  {#if currentQ.pos && currentQ.pos !== 'phrase'}
                    <span class="tag-chip mono-tag">{currentQ.pos}</span>
                  {/if}
                </div>

                <!-- 4 Options in Standard Fixed-Height Tiles -->
                <div class="options">
                  {#each (currentQ.options || []) as o, i (o.id)}
                    <button
                      type="button"
                      class="option option-tile"
                      aria-pressed={answers[at] === o.id}
                      onclick={() => selectOption(o.id)}
                      style="min-height:56px;box-sizing:border-box;"
                    >
                      <span class="key option-key">{i + 1}</span>
                      <span>{o.text}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <!-- Bottom Prev / Next Nav -->
          <div class="row spread" style="margin-top:20px;border-top:1px solid rgba(0,0,0,0.08);padding-top:14px;">
            <button
              class="btn outline small"
              onclick={() => at = Math.max(0, at - 1)}
              disabled={at === 0}
            >
              ← Previous
            </button>
            <button
              class="btn btn-gate-pill small"
              onclick={() => at = Math.min(duel.count - 1, at + 1)}
              disabled={at === duel.count - 1}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
