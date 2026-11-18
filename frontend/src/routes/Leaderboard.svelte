<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import Icon from '../lib/components/Icon.svelte';

  let period = $state('week'); // 'week' or 'all'
  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state({ rows: [], me: null });

  async function loadBoard(p) {
    try {
      loading = true;
      period = p;
      data = await api(`/leaderboard?period=${p}`);
    } catch (e) {
      errorMsg = e.message || 'Failed to load leaderboard';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadBoard('week');
  });

  let rows = $derived(data?.rows || []);
  let topThree = $derived(rows.slice(0, 3));
  let restRows = $derived(rows.slice(3));
</script>

<div class="leaderboard-view">
  <section class="card board-card">
    <header class="board-head">
      <div class="trophy-icon">
        <Icon name="trophy" size={32} />
      </div>
      <h2>{period === 'week' ? "This Week's Top Learners" : "All-Time Top Learners"}</h2>
      <p class="muted">
        Earn XP in lessons and reviews to take the top spot. {period === 'week' ? 'Resets every Monday.' : ''}
      </p>

      <div class="period-tabs">
        <button
          type="button"
          class="tab-btn"
          class:active={period === 'week'}
          onclick={() => loadBoard('week')}
        >
          Weekly
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={period === 'all'}
          onclick={() => loadBoard('all')}
        >
          All time
        </button>
      </div>
    </header>

    {#if loading}
      <div class="loading-state">
        <p class="muted">Loading rankings…</p>
      </div>
    {:else if errorMsg}
      <div class="error-state">
        <p class="muted">{errorMsg}</p>
      </div>
    {:else if rows.length === 0}
      <div class="empty-state">
        <p class="muted">No learners on the board yet. Complete a lesson to take #1!</p>
        <a href="#/learn" class="btn primary">Start learning →</a>
      </div>
    {:else}
      <!-- Podium for Top 3 -->
      {#if topThree.length > 0}
        <div class="podium">
          {#if topThree[1]}
            <div class="podium-col rank-2">
              <span class="podium-badge">🥈 #2</span>
              <span class="podium-avatar">{topThree[1].name?.charAt(0) || '?'}</span>
              <b class="podium-name">{topThree[1].name}</b>
              <span class="podium-xp mono-tag">{topThree[1].xp} XP</span>
            </div>
          {/if}

          {#if topThree[0]}
            <div class="podium-col rank-1">
              <span class="podium-badge">👑 #1</span>
              <span class="podium-avatar">{topThree[0].name?.charAt(0) || '?'}</span>
              <b class="podium-name">{topThree[0].name}</b>
              <span class="podium-xp mono-tag">{topThree[0].xp} XP</span>
            </div>
          {/if}

          {#if topThree[2]}
            <div class="podium-col rank-3">
              <span class="podium-badge">🥉 #3</span>
              <span class="podium-avatar">{topThree[2].name?.charAt(0) || '?'}</span>
              <b class="podium-name">{topThree[2].name}</b>
              <span class="podium-xp mono-tag">{topThree[2].xp} XP</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Full Table -->
      <table class="board-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Learner</th>
            <th>Streak</th>
            <th>XP</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r, i}
            <tr class:is-you={r.isYou}>
              <td>
                <span class="rank-num mono-tag">#{i + 1}</span>
              </td>
              <td>
                <a href="#/u/{r.handle || r.username || r.name}" class="learner-cell">
                  <span class="learner-avatar">{r.name?.charAt(0) || '?'}</span>
                  <span class="learner-name">{r.name} {r.isYou ? '(You)' : ''}</span>
                </a>
              </td>
              <td>
                {#if r.streak}
                  <span class="streak-tag mono-tag">
                    <Icon name="fire" size={13} />
                    <span>{r.streak}d</span>
                  </span>
                {:else}
                  <span class="muted mono-tag small">-</span>
                {/if}
              </td>
              <td>
                <b class="xp-cell mono-tag">{r.xp}</b>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if data.me && !rows.some(r => r.isYou)}
        <p class="my-rank-note mono-tag muted">
          You're #{data.me.rank} with {data.me.xp} XP.
        </p>
      {/if}
    {/if}
  </section>
</div>

<style>
  .leaderboard-view {
    max-width: 680px;
    margin: 0 auto;
  }

  .board-card {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 32px 24px;
  }

  .board-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
  }

  .board-head h2 {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 900;
  }

  .period-tabs {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .tab-btn {
    padding: 6px 18px;
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .tab-btn.active {
    background: var(--color-hi-vis-yellow);
  }

  /* Podium */
  .podium {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    gap: 16px;
    padding: 20px 0 10px;
  }

  .podium-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 16px 12px;
    width: 140px;
    text-align: center;
  }

  .podium-col.rank-1 {
    background: var(--color-hi-vis-yellow);
    height: 190px;
    order: 2;
  }

  .podium-col.rank-2 {
    background: var(--color-bone-white);
    height: 165px;
    order: 1;
  }

  .podium-col.rank-3 {
    background: var(--color-bubblegum-pink);
    height: 150px;
    order: 3;
  }

  .podium-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
  }

  .podium-name {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .podium-xp {
    font-size: 12px;
    font-weight: 700;
  }

  /* Table */
  .board-table {
    width: 100%;
    border-collapse: collapse;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    overflow: hidden;
    margin-top: 10px;
  }

  .board-table th, .board-table td {
    padding: 10px 14px;
    border-bottom: 1px solid rgba(26, 26, 26, 0.12);
  }

  .board-table th {
    background: rgba(26, 26, 26, 0.05);
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: left;
  }

  .board-table tr.is-you {
    background: rgba(244, 237, 54, 0.35);
  }

  .learner-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
  }

  .learner-avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--color-ink-black);
    background: var(--color-bone-white);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
  }

  .streak-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }

  .xp-cell {
    font-size: 14px;
  }

  .my-rank-note {
    text-align: center;
    margin-top: 8px;
    font-size: 12px;
  }

  .loading-state, .error-state, .empty-state {
    text-align: center;
    padding: 32px 0;
  }
</style>
