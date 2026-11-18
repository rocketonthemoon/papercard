<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
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

  $effect(() => {
    const isAll = appState.hash.includes('all');
    const p = isAll ? 'all' : 'week';
    if (p !== period) {
      loadBoard(p);
    }
  });

  onMount(() => {
    const isAll = appState.hash.includes('all');
    loadBoard(isAll ? 'all' : 'week');
  });

  let rows = $derived(data?.rows || []);
  let me = $derived(data?.me || null);

  function avatarText(r) {
    return (r.name || '?').charAt(0).toUpperCase();
  }
</script>

<section class="card board-page">
  <header class="picker-head">
    <h2>{period === 'week' ? "This week's top learners" : "All-time top learners"}</h2>
    <p class="muted">
      Earn XP in lessons and reviews, in any course. {period === 'week' ? 'Resets every Monday.' : ''}
    </p>
  </header>

  <div class="segmented" role="tablist" style="margin:0 auto 24px;">
    <a
      role="tab"
      href="#/leaderboard"
      aria-selected={period === 'week'}
      onclick={(e) => { e.preventDefault(); appState.navigate('#/leaderboard'); loadBoard('week'); }}
    >
      Weekly
    </a>
    <a
      role="tab"
      href="#/leaderboard/all"
      aria-selected={period === 'all'}
      onclick={(e) => { e.preventDefault(); appState.navigate('#/leaderboard/all'); loadBoard('all'); }}
    >
      All time
    </a>
  </div>

  {#if loading}
    <p class="muted loading" style="text-align:center;padding:40px 0;">Loading leaderboard…</p>
  {:else if errorMsg}
    <p class="error" style="text-align:center;padding:40px 0;">{errorMsg}</p>
  {:else if rows.length === 0}
    <div class="empty-state" style="text-align:center;padding:40px 0;">
      <span class="finish-icon" style="display:inline-block;margin-bottom:12px;"><Icon name="trophy" size={48} /></span>
      <h3>No learners on the board yet</h3>
      <p class="muted" style="margin:8px 0 16px;">Earn XP in lessons and reviews to take the top spot.</p>
      <a href="#/learn" class="btn btn-gate-pill">Start learning →</a>
    </div>
  {:else}
    <!-- Podium: 2nd, 1st, 3rd -->
    <div class="podium">
      {#if rows[1]}
        <a class="podium-spot second" href="#/u/{rows[1].username}">
          <span class="pic">
            <span class="avatar-ph" style="display:inline-flex;width:48px;height:48px;border-radius:50%;background:#f4ed36;border:2px solid #000;align-items:center;justify-content:center;font-weight:900;font-size:20px;">{avatarText(rows[1])}</span>
            <span class="rank-badge">2</span>
          </span>
          <b>{rows[1].name}{rows[1].isYou ? ' (you)' : ''}</b>
          <span>{rows[1].xp} XP</span>
        </a>
      {:else}
        <span></span>
      {/if}

      {#if rows[0]}
        <a class="podium-spot first" href="#/u/{rows[0].username}">
          <span class="pic">
            <span class="avatar-ph" style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:#ffd33d;border:2px solid #000;align-items:center;justify-content:center;font-weight:900;font-size:24px;">{avatarText(rows[0])}</span>
            <span class="rank-badge">1</span>
          </span>
          <b>{rows[0].name}{rows[0].isYou ? ' (you)' : ''}</b>
          <span>{rows[0].xp} XP</span>
        </a>
      {:else}
        <span></span>
      {/if}

      {#if rows[2]}
        <a class="podium-spot third" href="#/u/{rows[2].username}">
          <span class="pic">
            <span class="avatar-ph" style="display:inline-flex;width:44px;height:44px;border-radius:50%;background:#f8c1ba;border:2px solid #000;align-items:center;justify-content:center;font-weight:900;font-size:18px;">{avatarText(rows[2])}</span>
            <span class="rank-badge">3</span>
          </span>
          <b>{rows[2].name}{rows[2].isYou ? ' (you)' : ''}</b>
          <span>{rows[2].xp} XP</span>
        </a>
      {:else}
        <span></span>
      {/if}
    </div>

    <!-- Rest of the Board -->
    {#if rows.length > 3}
      <ol class="rank-list">
        {#each rows.slice(3, 20) as r}
          <li class={r.isYou ? 'you' : ''}>
            <span class="n">{r.rank}</span>
            <span class="avatar-ph" style="display:inline-flex;width:32px;height:32px;border-radius:50%;background:#f9f5f2;border:1.5px solid #000;align-items:center;justify-content:center;font-weight:700;font-size:14px;margin-right:10px;">{avatarText(r)}</span>
            <a href="#/u/{r.username}" style="text-decoration:none;color:inherit;font-weight:600;">{r.name}{r.isYou ? ' (you)' : ''}</a>
            <span class="xp" style="margin-left:auto;font-weight:700;">{r.xp} XP</span>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}

  {#if me && !rows.some(r => r.isYou)}
    <p class="muted center" style="margin-top:24px;text-align:center;">
      You're #{me.rank} with {me.xp} XP.
    </p>
  {/if}
</section>
