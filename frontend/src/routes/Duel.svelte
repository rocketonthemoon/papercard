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
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
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
        // Load local draft if exists
        try {
          const saved = JSON.parse(localStorage.getItem(`duel-${code}`) || 'null');
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
      localStorage.setItem(`duel-${code}`, JSON.stringify(answers));
    } catch {}

    // Auto-advance to next unanswered
    const next = answers.indexOf(null, at + 1) >= 0 ? answers.indexOf(null, at + 1) : answers.indexOf(null);
    if (next >= 0) {
      setTimeout(() => { at = next; }, 200);
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
        localStorage.removeItem(`duel-${code}`);
      } catch {}
      if (timerInterval) clearInterval(timerInterval);
      results = res;
    } catch (e) {
      errorMsg = e.message || 'Failed to submit answers';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="duel-view">
  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading duel {code}…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Something went wrong</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/play" class="btn primary">Back to Play</a>
    </div>
  {:else if results}
    <!-- Results Screen -->
    <div class="card results-card">
      <div class="results-head">
        <span class="pill yellow mono-tag">DUEL RESULTS</span>
        <h2>{duel.title || 'Duel Complete!'}</h2>
        <p class="muted small">Code: <b>{code}</b> · Course: {duel.course?.title || 'Lithuanian'}</p>
      </div>

      <!-- Leaderboard / Scores Table -->
      <div class="scores-table-wrap">
        <h3>Players & Scores</h3>
        <table class="scores-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Score</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {#each (results.players || []) as p, i}
              <tr class:you={p.isYou}>
                <td><b>#{i + 1}</b></td>
                <td>
                  <div class="player-cell">
                    <span class="player-avatar">{p.name ? p.name.charAt(0).toUpperCase() : '?'}</span>
                    <span>{p.name} {p.isYou ? '(You)' : ''}</span>
                  </div>
                </td>
                <td><b class="score-val">{p.score ?? 0} pts</b></td>
                <td><span class="mono-tag small muted">{p.timeFormatted || '0:00'}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="results-actions">
        <button class="btn outline" onclick={copyShareLink}>
          <Icon name="copy" size={16} />
          <span>Copy invite link</span>
        </button>
        <a href="#/play" class="btn primary">Play another duel →</a>
      </div>
    </div>
  {:else if duel}
    <!-- Active Duel Arena -->
    <div class="duel-toolbar">
      <a href="#/play" class="back-link">
        <Icon name="back" size={16} />
        <span>Exit duel</span>
      </a>

      <div class="toolbar-right">
        <button class="btn outline sm" onclick={copyShareLink}>
          <Icon name="copy" size={14} />
          <span>Invite link</span>
        </button>
        <button
          class="btn primary sm"
          onclick={submitDuel}
          disabled={submitting}
        >
          <Icon name="send" size={14} />
          <span>{submitting ? 'Submitting...' : 'Submit answers'}</span>
        </button>
      </div>
    </div>

    <div class="workspace-two">
      <!-- Left 300px Sidebar -->
      <aside class="card side-panel">
        <section class="panel-section">
          <span class="mono-tag muted small">DUEL CODE</span>
          <div class="code-badge">
            <span class="pill yellow mono-tag code-pill">{duel.code}</span>
          </div>
          <p class="muted small">{duel.title} · set by {duel.creator?.name || 'Player'}</p>
        </section>

        <section class="panel-section">
          <div class="sec-row">
            <span class="mono-tag muted small">ANSWERED</span>
            <b class="big-stat">{answeredCount} <small>/ {duel.count}</small></b>
          </div>
          <div class="track-bar">
            <div class="fill-bar" style="width: {answeredPct}%;"></div>
          </div>
        </section>

        <section class="panel-section">
          <span class="mono-tag muted small">ELAPSED TIME</span>
          <p class="timer-stat mono-tag">{timerText}</p>
        </section>

        <section class="panel-section scoring-section">
          <span class="mono-tag muted small">SCORING</span>
          <ul class="rule-list">
            <li>
              <Icon name="check" size={16} class="rule-icon" />
              <span>+10 pts per right answer</span>
            </li>
            <li>
              <Icon name="check" size={16} class="rule-icon" />
              <span>One try; revealed at end</span>
            </li>
            <li>
              <Icon name="check" size={16} class="rule-icon" />
              <span>Ties go to the faster player</span>
            </li>
          </ul>
        </section>
      </aside>

      <!-- Main Duel Sheet -->
      <div class="sheet duel-sheet">
        <div class="sheet-head">
          <span class="mono-tag"><b>PLAYER:</b> {appState.user?.name || 'Learner'}</span>
          <span class="mono-tag"><b>ROUND:</b> {at + 1} / {duel.count}</span>
        </div>

        <!-- Question Dots Navigator -->
        <nav class="qdots" aria-label="Questions list">
          {#each Array(duel.count) as _, i}
            <button
              type="button"
              class="qdot"
              class:done={answers[i] !== null}
              class:current={i === at}
              onclick={() => at = i}
              aria-label="Question {i + 1}"
            >
              {i + 1}
            </button>
          {/each}
        </nav>

        {#if currentQ}
          <div class="question-box">
            <span class="mono-tag muted small">Question {at + 1} of {duel.count}</span>

            <div class="prompt-card">
              <h1 class="prompt-title">
                {currentQ.kind === 'pick_en' ? 'What does this mean?' : 'How do you say this in Lithuanian?'}
              </h1>
              <div class="prompt-word-wrap">
                <b class="prompt-word">{currentQ.prompt}</b>
                {#if currentQ.pos}
                  <span class="pill sm">{currentQ.pos}</span>
                {/if}
              </div>
            </div>

            <!-- Options Grid -->
            <div class="options-grid">
              {#each (currentQ.options || []) as opt, i}
                {@const isPicked = answers[at] === opt.id}
                <button
                  type="button"
                  class="option-btn"
                  class:picked={isPicked}
                  onclick={() => selectOption(opt.id)}
                >
                  <span class="opt-num mono-tag">{i + 1}</span>
                  <span class="opt-label">{opt.text}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="sheet-footer">
          <button
            class="btn outline sm"
            onclick={() => at = Math.max(0, at - 1)}
            disabled={at === 0}
          >
            ← Previous
          </button>
          <button
            class="btn outline sm"
            onclick={() => at = Math.min(duel.count - 1, at + 1)}
            disabled={at === duel.count - 1}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .duel-view {
    max-width: 1040px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .duel-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: var(--color-bone-white);
  }

  .back-link:hover {
    color: var(--color-hi-vis-yellow);
  }

  .toolbar-right {
    display: flex;
    gap: 10px;
  }

  /* Two Column Workspace */
  .workspace-two {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 820px) {
    .workspace-two {
      grid-template-columns: 1fr;
    }
  }

  /* Left 300px Side Panel */
  .side-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
  }

  .panel-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(26, 26, 26, 0.1);
  }

  .code-pill {
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.1em;
    padding: 4px 12px;
  }

  .sec-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .big-stat {
    font-family: var(--font-mono);
    font-size: 20px;
  }

  .track-bar {
    height: 8px;
    background: rgba(26, 26, 26, 0.1);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .fill-bar {
    height: 100%;
    background: var(--color-hi-vis-yellow);
    border-radius: var(--radius-pill);
    transition: width 0.2s ease;
  }

  .timer-stat {
    font-size: 24px;
    font-weight: 800;
    color: var(--color-ink-black);
  }

  .rule-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
  }

  .rule-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  :global(.rule-icon) {
    width: 16px !important;
    height: 16px !important;
    min-width: 16px !important;
    flex-shrink: 0;
  }

  /* Main Sheet */
  .duel-sheet {
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-shadow: 0 6px 0 var(--color-ink-black);
  }

  .sheet-head {
    display: flex;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 2px dashed rgba(26, 26, 26, 0.2);
    font-size: 12px;
  }

  .qdots {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .qdot {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: var(--border-thick);
    background: var(--color-bone-white);
    box-shadow: 0 2px 0 var(--color-ink-black);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.08s ease, box-shadow 0.08s ease, background-color 0.1s ease;
  }

  .qdot:hover {
    transform: translateY(-2px);
    box-shadow: 0 3px 0 var(--color-ink-black);
  }

  .qdot.done {
    background: var(--color-matcha-cream);
  }

  .qdot.current {
    background: var(--color-hi-vis-yellow);
    box-shadow: 0 3px 0 var(--color-ink-black);
    transform: translateY(-2px);
  }

  .question-box {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .prompt-card {
    background: rgba(26, 26, 26, 0.04);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: 0 3px 0 var(--color-ink-black);
    padding: 24px;
    text-align: center;
  }

  .prompt-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--ink-60);
    margin-bottom: 8px;
  }

  .prompt-word-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .prompt-word {
    font-family: var(--font-display);
    font-size: clamp(28px, 5vw, 42px);
    font-weight: 900;
    letter-spacing: -0.01em;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  @media (max-width: 600px) {
    .options-grid {
      grid-template-columns: 1fr;
    }
  }

  .option-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    box-shadow: 0 3px 0 var(--color-ink-black);
    font-size: 15px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    transition: transform 0.08s ease, box-shadow 0.08s ease, background-color 0.1s ease;
  }

  .option-btn:hover {
    background: var(--color-buttery-yellow);
    transform: translateY(-2px);
    box-shadow: 0 4px 0 var(--color-ink-black);
  }

  .option-btn:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-ink-black);
  }

  .option-btn.picked {
    background: var(--color-hi-vis-yellow);
    box-shadow: 0 3px 0 var(--color-ink-black);
  }

  .opt-num {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: var(--border-thick);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    background: var(--color-bone-white);
    box-shadow: 0 1px 0 var(--color-ink-black);
  }

  .sheet-footer {
    display: flex;
    justify-content: space-between;
    padding-top: 14px;
    border-top: 1px solid rgba(26, 26, 26, 0.1);
  }

  /* Results Card */
  .results-card {
    display: flex;
    flex-direction: column;
    gap: 24px;
    text-align: center;
    padding: 36px 24px;
  }

  .results-head h2 {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 800;
    margin: 8px 0 4px;
  }

  .scores-table-wrap {
    text-align: left;
  }

  .scores-table-wrap h3 {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    margin-bottom: 12px;
  }

  .scores-table {
    width: 100%;
    border-collapse: collapse;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    overflow: hidden;
  }

  .scores-table th, .scores-table td {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(26, 26, 26, 0.15);
  }

  .scores-table th {
    background: rgba(26, 26, 26, 0.05);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .scores-table tr.you {
    background: rgba(244, 237, 54, 0.35);
  }

  .player-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
  }

  .player-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
  }

  .score-val {
    font-family: var(--font-mono);
    color: var(--color-magenta-punch);
  }

  .results-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
</style>
