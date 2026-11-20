<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import { initial, percent, plural } from '../lib/format.js';
  import { instructionFor, optionForKey } from '../lib/lessonSession.js';
  import {
    formatDuration,
    formatDate,
    nextUnanswered,
    loadSavedAnswers,
    saveAnswers,
    clearSavedAnswers,
    resultSummary,
    outcomeText,
  } from '../lib/duel.js';
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

  onMount(async () => {
    try {
      const res = await api(`/duels/${code}`);
      duel = res;
      if (res.you?.submitted) {
        results = res;
        return;
      }
      answers = loadSavedAnswers(code, res.count);
      const first = answers.indexOf(null);
      at = first >= 0 ? first : 0;
      const startTime = Date.now();
      timerInterval = setInterval(() => (timerText = formatDuration(Date.now() - startTime)), 1000);
    } catch (e) {
      errorMsg = e.message || 'Failed to load duel';
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval);
  });

  let currentQ = $derived(duel?.questions?.[at] || null);
  let answeredCount = $derived(answers.filter((a) => a !== null).length);
  let answeredPct = $derived(percent(answeredCount, duel?.count));
  let toLangName = $derived(duel?.course?.toLang || 'Lithuanian');
  let summary = $derived(results ? resultSummary(results) : null);

  function handleKeydown(e) {
    if (loading || results || !currentQ) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const picked = optionForKey(currentQ, e.key);
    if (picked !== null) selectOption(picked);
    else if (e.key === 'ArrowRight') at = Math.min(duel.count - 1, at + 1);
    else if (e.key === 'ArrowLeft') at = Math.max(0, at - 1);
  }

  function selectOption(optId) {
    answers[at] = optId;
    answers = [...answers];
    saveAnswers(code, answers);
    const next = nextUnanswered(answers, at);
    if (next >= 0) setTimeout(() => (at = next), 260);
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
    if (unanswered > 0 && !confirm(`You haven't answered ${plural(unanswered, 'question')}. Submit anyway?`)) return;
    try {
      submitting = true;
      const res = await api(`/duels/${code}/submit`, { method: 'POST', body: { answers } });
      clearSavedAnswers(code);
      if (timerInterval) clearInterval(timerInterval);
      results = res;
    } catch (e) {
      errorMsg = e.message || 'Failed to submit answers';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="duel-page">
  {#if loading}
    <p class="page-loading" role="status">Loading duel {code}…</p>
  {:else if errorMsg}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Something went wrong</h2>
        <p class="muted">{errorMsg}</p>
      </header>
      <div class="row picker-actions">
        <a class="btn btn-gate-pill" href="#/play">Back to Play</a>
      </div>
    </section>
  {:else if summary}
    <div class="toolbar">
      <a class="back" href="#/play">← Play</a>
      <div class="toolbar-actions">
        <button class="btn outline small" onclick={copyShareLink}>Invite link</button>
        <a class="btn btn-gate-pill small" href="#/play">New room →</a>
      </div>
    </div>

    <div class="workspace two duel-workspace">
      <aside class="card side duel-side">
        <section>
          <h3>Your result</h3>
          <p class="duel-score"><b>{summary.points}</b> <span class="muted">/ {summary.maxPoints} points</span></p>
        </section>

        <section>
          <dl class="duel-kv">
            <div><dt>Right</dt><dd class="good">{summary.correct}/{summary.count}</dd></div>
            <div><dt>Wrong</dt><dd class:bad={summary.wrong > 0}>{summary.wrong}</dd></div>
            <div><dt>Time</dt><dd>{summary.elapsed}</dd></div>
          </dl>
        </section>

        <section>
          <h3>Scoreboard</h3>
          <p class="duel-outcome" class:muted={summary.outcome === 'waiting'}>{outcomeText(summary)}</p>
          <ul class="duel-people">
            {#each summary.players as p (p.name)}
              <li class:you={p.isYou}>
                <span class="muted small mono-tag">#{p.rank ?? 1}</span>
                <span class="avatar-ph duel-avatar">{initial(p)}</span>
                <div class="duel-person">
                  <b>{p.name}{p.isYou ? ' (you)' : ''}</b>
                  <span class="muted small mono-tag">{p.correct ?? 0}/{summary.count} right · {formatDuration(p.elapsedMs)}</span>
                </div>
                <span class="pts mono-tag"><b>{p.points ?? 0}</b> <small>pts</small></span>
              </li>
            {/each}
          </ul>
          {#if !summary.hasOpponent}
            <button class="btn dashed block duel-invite" onclick={copyShareLink}>Copy invite link</button>
          {/if}
        </section>
      </aside>

      <section class="card list-card">
        <div class="list-head">
          <h3>Answer key · {results.title || 'Duel'}</h3>
          <span class="muted small">{summary.correct} of {summary.count} right</span>
        </div>
        <ul class="rows">
          {#each results.key || [] as k, i (i)}
            <li class="answer">
              <Icon name={k.right ? 'ok' : 'miss'} class={k.right ? 'mark-ok' : 'mark-miss'} />
              <div>
                <span class="found">{k.prompt}</span> → <b>{k.answer}</b>
                {#if !k.right}
                  <p class="muted small">You said: {k.yours ?? '(no answer)'}</p>
                {/if}
              </div>
              <span class="tag {k.right ? 'ok' : 'miss'}">{k.right ? 'right' : 'wrong'}</span>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {:else if duel}
    <div class="toolbar">
      <a class="back" href="#/play">← Play</a>
      <div class="toolbar-actions">
        <button class="btn outline small" onclick={copyShareLink}>Invite link</button>
        <button class="btn btn-gate-pill small" id="submit" onclick={submitDuel} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit answers'}
        </button>
      </div>
    </div>

    <div class="workspace two duel-workspace">
      <aside class="card side duel-side">
        <section>
          <h3>Duel</h3>
          <span class="code-chip pill yellow mono-tag duel-code">{duel.code}</span>
          <p class="muted small">{duel.title} · set by {duel.creator?.name || 'Player'}</p>
        </section>

        <section>
          <h3>Answered</h3>
          <p class="duel-big mono-tag"><b>{answeredCount}</b> <small>of {duel.count}</small></p>
          <div class="bar"><i style:width="{answeredPct}%"></i></div>
        </section>

        <section>
          <h3>Time</h3>
          <p class="duel-big mono-tag" role="timer"><b>{timerText}</b></p>
        </section>

        <section>
          <h3>Scoring</h3>
          <ul class="duel-checks">
            <li>+10 per right answer</li>
            <li>One try; answers revealed at the end</li>
            <li>Ties go to the faster player</li>
          </ul>
        </section>

        <section>
          <h3>Players ({duel.players?.length || 0})</h3>
          {#if duel.players?.length}
            <ul class="duel-people compact">
              {#each duel.players as p (p.name)}
                <li>
                  <span class="avatar-ph duel-avatar sm">{initial(p)}</span>
                  <span class="duel-person">{p.name}</span>
                  <span class="pill sm">played</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted small">Nobody has played yet. Be the first, then send the link.</p>
          {/if}
        </section>
      </aside>

      <div class="sheet-wrap">
        <div class="sheet duel-sheet duel-arena">
          <div>
            <div class="sheet-head">
              <span>{appState.user?.name || 'Learner'}</span>
              <span>{formatDate(duel.createdAt)}</span>
            </div>

            <nav class="qdots" aria-label="Questions">
              {#each duel.questions || [] as _, i (i)}
                <button
                  type="button"
                  class="qdot"
                  class:done={answers[i] !== null}
                  class:at={i === at}
                  aria-current={i === at ? 'step' : undefined}
                  aria-label="Question {i + 1}{answers[i] !== null ? ', answered' : ''}"
                  onclick={() => (at = i)}
                >
                  {i + 1}
                </button>
              {/each}
            </nav>

            {#if currentQ}
              <div class="duel-q" id="qcard">
                <p class="muted small mono-tag duel-q-count">Question {at + 1} of {duel.count}</p>
                <h1 class="q duel-q-heading">{instructionFor(currentQ, toLangName)}</h1>
                <div class="prompt-card challenge-card duel-prompt">
                  <span class="prompt-word">{currentQ.prompt}</span>
                  {#if currentQ.pos && currentQ.pos !== 'phrase'}
                    <span class="tag-chip mono-tag">{currentQ.pos}</span>
                  {/if}
                </div>
                <div class="options" role="group" aria-label="Answers">
                  {#each currentQ.options || [] as o, i (o.id)}
                    <button type="button" class="option option-tile duel-option" aria-pressed={answers[at] === o.id} onclick={() => selectOption(o.id)}>
                      <span class="key option-key" aria-hidden="true">{i + 1}</span>
                      <span>{o.text}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <div class="duel-nav">
            <button class="btn outline small" onclick={() => (at = Math.max(0, at - 1))} disabled={at === 0}>← Previous</button>
            <button class="btn btn-gate-pill small" onclick={() => (at = Math.min(duel.count - 1, at + 1))} disabled={at === duel.count - 1}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .duel-workspace {
    margin-top: 16px;
  }

  /* Phones: the questions come first; the info card follows */
  @media (max-width: 900px) {
    .duel-workspace > .sheet-wrap {
      order: -1;
    }
  }

  .duel-side h3 {
    margin: 0 0 6px;
  }

  .duel-side p {
    margin: 4px 0 0;
  }

  .duel-side .duel-score {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap;
    align-self: stretch;
    width: 100%;
    align-items: baseline;
    gap: 6px;
  }

  .duel-score b {
    font-size: 32px;
    font-weight: 800;
    line-height: 1;
  }

  .duel-kv {
    margin: 0;
    display: grid;
    gap: 6px;
  }

  .duel-kv div {
    display: flex;
    justify-content: space-between;
  }

  .duel-kv dt,
  .duel-kv dd {
    margin: 0;
  }

  .duel-kv dd {
    font-weight: 700;
  }

  .duel-kv .good {
    color: #1d7a45;
  }

  .duel-kv .bad {
    color: var(--color-firecracker-red);
  }

  .duel-outcome {
    font-weight: 700;
  }

  .duel-outcome.muted {
    font-weight: 400;
    font-size: 13px;
  }

  .duel-people {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }

  .duel-people li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(26, 26, 26, 0.06);
  }

  .duel-people.compact li {
    gap: 8px;
    padding: 4px 0;
    border-bottom: none;
  }

  .duel-person {
    flex: 1;
    min-width: 0;
    display: grid;
    font-size: 14px;
  }

  .duel-avatar {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    font-size: 13px;
    font-weight: 700;
  }

  .duel-avatar.sm {
    width: 24px;
    height: 24px;
    font-size: 11px;
  }

  .pts {
    font-weight: 800;
  }

  .duel-invite {
    width: 100%;
    margin-top: 14px;
  }

  .duel-code {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  .duel-big {
    font-size: 22px;
  }

  .duel-checks {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 13px;
  }

  .duel-checks li::before {
    content: '✓ ';
    font-weight: 700;
  }

  .sheet-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(26, 26, 26, 0.1);
    font-size: 14px;
    font-weight: 600;
  }

  .qdots {
    margin-bottom: 16px;
  }

  .duel-q {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .duel-q-count {
    margin: 0;
  }

  .duel-q-heading {
    min-height: 56px;
    display: flex;
    align-items: center;
    margin: 0;
    font-size: 26px;
    line-height: 1.15;
  }

  .duel-prompt {
    min-height: 84px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .prompt-word {
    font-size: 24px;
    font-weight: 800;
    overflow-wrap: anywhere;
  }

  .duel-option {
    min-height: 56px;
    box-sizing: border-box;
  }

  .duel-nav {
    display: flex;
    justify-content: space-between;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid rgba(26, 26, 26, 0.1);
  }
</style>
