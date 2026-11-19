<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);
  let board = $state({ rows: [] });
  let feed = $state({ courses: [] });

  onMount(async () => {
    try {
      loading = true;
      const [learnData, boardData, feedData] = await Promise.all([
        api('/learn'),
        api('/leaderboard?period=week').catch(() => ({ rows: [] })),
        api('/feed').catch(() => ({ courses: [] })),
      ]);
      data = learnData;
      board = boardData;
      feed = feedData;
      if (learnData?.stats) {
        appState.topStats = learnData.stats;
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load courses';
    } finally {
      loading = false;
    }
  });

  let myCourses = $derived(data?.myCourses || []);
  let stats = $derived(data?.stats || null);
  let todayXP = $derived(stats?.days?.at(-1)?.xp ?? 0);
  let quests = $derived([100, 250, 500, 1000].filter(q => q > (stats?.xp || 0)).slice(0, 3));

  const tint = (id) => `tint-${Math.abs(Number(id) || 0) % 6}`;

  function flag(c) {
    if (c.toCode) return c.toCode.toUpperCase();
    if (c.toLang && c.toLang.toLowerCase().includes('lithuanian')) return 'LT';
    return (c.toLang || 'LT').slice(0, 2).toUpperCase();
  }
</script>

<div class="dash">
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:40px 0;width:100%;">Loading your courses…</p>
  {:else if errorMsg}
    <section class="card picker" style="width:100%;max-width:600px;margin:20px auto;">
      <header class="picker-head">
        <h2>Something went wrong</h2>
        <p class="muted">{errorMsg}</p>
      </header>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <a class="btn btn-gate-pill" href="#/discover">Discover courses</a>
      </div>
    </section>
  {:else}
    <div class="dash-main course-path">
      {#if myCourses.length > 0}
        <div class="enrolled-grid">
          {#each myCourses as c (c.id)}
            {@const pct = c.words ? Math.round((100 * (c.learned || 0)) / c.words) : 0}
            {@const tag = c.creator?.official ? 'OFFICIAL' : 'ENROLLED'}
            <div class="card enrolled-card" data-course={c.id}>
              <!-- Tile Art matching web design -->
              <div class="tile-art {tint(c.id)}">
                <div class="pcard-top-row">
                  <span class="tag-chip mono-tag">{tag}</span>
                  <span class="lang-orb mono-tag">{flag(c)}</span>
                </div>
                <h3 class="pcard-title">
                  <a href="#/learn/course/{c.id}">{c.title}</a>
                </h3>
                <div class="pcard-sub mono-tag">{c.units?.length || 1} decks · {c.words} words</div>
              </div>

              {#if c.description}
                <p class="enrolled-desc" title={c.description}>{c.description}</p>
              {:else}
                <div class="enrolled-desc-spacer"></div>
              {/if}

              <!-- Progress bar -->
              <div class="progress-wrap">
                <div class="progress-labels mono-tag">
                  <span><b>{pct}%</b> COMPLETED</span>
                  <span>{c.learned || 0}/{c.words} WORDS</span>
                </div>
                <div class="progress-track">
                  <div class="progress-bar" style="width: {pct}%"></div>
                </div>
              </div>

              <div class="enrolled-foot">
                <a class="btn btn-gate-pill small" href="#/learn/course/{c.id}">
                  {c.learned ? 'Continue →' : 'Start →'}
                </a>
                <a class="btn btn-outlined-display small" href="#/course/{c.id}">About</a>
              </div>
            </div>
          {/each}

          <a class="enrolled-add" href="#/discover">
            <div>
              <span class="plus"><Icon name="plus" size={24} /></span>
              <b>Find more courses</b>
            </div>
          </a>
        </div>
      {:else}
        <section class="card picker">
          <header class="picker-head">
            <span class="board-icon"><Icon name="cards" size={40} /></span>
            <h2>You're not enrolled in any courses yet</h2>
            <p class="muted">Explore courses created by us and the community to start learning.</p>
          </header>
          <div class="row" style="justify-content:center;gap:12px;margin-top:16px;">
            <a class="btn btn-gate-pill" href="#/discover">Find a course</a>
            <a class="btn outline" href="#/studio">Create a course</a>
          </div>
        </section>
      {/if}
    </div>

    <!-- Dash Side widgets -->
    <aside class="dash-side">
      <!-- Today XP Widget -->
      <details class="card widget dash-collapsible-card dash-today-card profile-card" open>
        <summary class="widget-head dash-collapsible-summary dash-today-summary">
          <div class="dash-collapsible-title-wrap">
            <span class="dash-collapsible-chev" aria-hidden="true">▾</span>
            <h3>Today</h3>
          </div>
        </summary>
        <div class="today-xp-row" style="padding:14px 0;">
          <span class="mono-tag" style="font-size:24px;font-weight:900;color:#000;">+{todayXP} XP</span>
          <span class="muted small" style="margin-left:8px;">earned today</span>
        </div>
        {#if quests.length > 0}
          <ul class="quest-list" style="list-style:none;padding:0;margin-top:12px;">
            {#each quests as q}
              <li style="margin-bottom:10px;">
                <div class="row spread mono-tag small" style="margin-bottom:4px;">
                  <span>Earn {q} XP</span>
                  <span class="muted small">{stats?.xp || 0}/{q}</span>
                </div>
                <div class="progress-track" style="height:6px;">
                  <div class="progress-bar" style="width:{Math.min(100, Math.round((100 * (stats?.xp || 0)) / q))}%"></div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </details>

      <!-- Mini Leaderboard Widget -->
      <section class="card widget dash-board-widget" style="margin-top:16px;">
        <div class="row spread" style="margin-bottom:12px;">
          <h3>Weekly Board</h3>
          <a href="#/leaderboard" class="small mono-tag" style="font-weight:700;color:inherit;text-decoration:none;">View all →</a>
        </div>
        {#if board?.rows?.length}
          <ol class="rank-list compact" style="list-style:none;padding:0;margin:0;">
            {#each board.rows.slice(0, 5) as r}
              <li class="row spread {r.isYou ? 'you' : ''}" style="padding:6px 0;align-items:center;border-bottom:1px solid rgba(0,0,0,0.05);">
                <div class="row" style="gap:8px;">
                  <span class="mono-tag" style="font-weight:700;width:18px;">{r.rank}</span>
                  <span class="small" style="font-weight:600;">{r.name}{r.isYou ? ' (you)' : ''}</span>
                </div>
                <span class="mono-tag small" style="font-weight:700;">{r.xp} XP</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="muted small">Finish a lesson to get on the board!</p>
        {/if}
      </section>
    </aside>
  {/if}
</div>
