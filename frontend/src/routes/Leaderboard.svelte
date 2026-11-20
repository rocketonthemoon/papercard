<script>
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import { initial } from '../lib/format.js';
  import { podiumSpots, restOfBoard, standingNote, periodFromHash } from '../lib/leaderboard.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state({ rows: [], me: null });

  let period = $derived(periodFromHash(appState.hash));

  async function loadBoard(p) {
    try {
      loading = true;
      errorMsg = '';
      data = await api(`/leaderboard?period=${p}`);
    } catch (e) {
      errorMsg = e.message || 'Failed to load leaderboard';
    } finally {
      loading = false;
    }
  }

  // The tabs are plain links; the hash decides which board loads.
  $effect(() => {
    loadBoard(period);
  });

  let rows = $derived(data?.rows || []);
  let note = $derived(standingNote(rows, data?.me, period));
</script>

<section class="card board-page">
  <header class="picker-head">
    <h2>{period === 'week' ? "This week's top learners" : 'All-time top learners'}</h2>
    <p class="muted">Earn XP in lessons and reviews, in any course.{period === 'week' ? ' Resets every Monday.' : ''}</p>
  </header>

  <nav class="segmented board-tabs" aria-label="Leaderboard period">
    <a href="#/leaderboard" aria-current={period === 'week' ? 'page' : undefined} class:active={period === 'week'}>Weekly</a>
    <a href="#/leaderboard/all" aria-current={period === 'all' ? 'page' : undefined} class:active={period === 'all'}>All time</a>
  </nav>

  {#if loading}
    <p class="board-status muted" role="status">Loading leaderboard…</p>
  {:else if errorMsg}
    <p class="board-status form-error" role="alert">{errorMsg}</p>
  {:else if rows.length === 0}
    <div class="board-empty">
      <Icon name="trophy" size={48} />
      <h3>No learners on the board yet</h3>
      <p class="muted">Earn XP in lessons and reviews to take the top spot.</p>
      <a href="#/learn" class="btn btn-gate-pill">Start learning →</a>
    </div>
  {:else}
    <div class="podium">
      {#each podiumSpots(rows) as spot, i (i)}
        {#if spot}
          <a class="podium-spot {spot.place}" href="#/u/{spot.row.username}">
            <span class="pic">
              <span class="avatar-ph podium-avatar {spot.place}" style:--size="{spot.size}px">{initial(spot.row)}</span>
              <span class="rank-badge">{spot.row.rank ?? spot.rank}</span>
            </span>
            <b>{spot.row.name}{spot.row.isYou ? ' (you)' : ''}</b>
            <span>{spot.row.xp} XP</span>
          </a>
        {:else}
          <span aria-hidden="true"></span>
        {/if}
      {/each}
    </div>

    {#if rows.length > 3}
      <ol class="rank-list">
        {#each restOfBoard(rows) as r (r.username ?? r.rank)}
          <li class:you={r.isYou}>
            <span class="n">{r.rank}</span>
            <span class="avatar-ph rank-avatar">{initial(r)}</span>
            <a class="rank-name" href="#/u/{r.username}">{r.name}{r.isYou ? ' (you)' : ''}</a>
            <span class="xp">{r.xp} XP</span>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}

  {#if !loading && !errorMsg && note}
    <p class="board-standing">
      {note}
      {#if !data?.me?.rank}<a href="#/learn">Go to lessons →</a>{/if}
    </p>
  {/if}
</section>

<style>
  .board-tabs {
    margin: 0 auto 24px;
  }

  .board-status {
    margin: 0;
    padding: 40px 0;
    text-align: center;
  }

  .board-empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 32px 0;
    text-align: center;
  }

  .board-empty h3,
  .board-empty p {
    margin: 0;
  }

  .board-empty .btn {
    margin-top: 8px;
  }

  .podium-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    border: 2px solid var(--color-ink-black);
    background: var(--color-bone-white);
    font-family: var(--font-degulardisplay-bold);
    font-weight: 800;
    font-size: calc(var(--size) * 0.4);
  }

  .podium-avatar.first {
    background: var(--color-hi-vis-yellow);
  }

  .podium-avatar.second {
    background: var(--color-buttery-yellow);
  }

  .podium-avatar.third {
    background: var(--color-bubblegum-pink);
  }

  .rank-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    margin-right: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    font-weight: 700;
    font-size: 14px;
  }

  .rank-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
    font-weight: 600;
    text-decoration: none;
  }

  .rank-name:hover {
    text-decoration: underline;
  }

  .xp {
    margin-left: auto;
    padding-left: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .board-standing {
    margin: 24px 0 0;
    padding: 12px 16px;
    border: 1.5px dashed rgba(26, 26, 26, 0.35);
    border-radius: var(--r-card);
    text-align: center;
    font-size: 14px;
  }

  .board-standing a {
    margin-left: 6px;
    font-weight: 700;
    color: var(--color-ink-black);
  }
</style>
