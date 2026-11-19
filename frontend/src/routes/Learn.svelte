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
  const myRank = $derived.by(() => {
    const myRow = board?.rows?.find((r) => r.isYou);
    return myRow ? myRow.rank : (board?.me?.rank || 1);
  });
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
              <div class="enrolled-progress">
                <div class="row spread small mono-tag">
                  <span><b>{pct}%</b> COMPLETED</span>
                  <span class="muted">{c.learned || 0}/{c.words} WORDS</span>
                </div>
                <div class="bar"><i style="width: {pct}%"></i></div>
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
          <div class="dash-progress-summary-meta">
            {#if stats?.due}
              <span class="pill due mono-tag">{stats.due} DUE</span>
            {/if}
            {#if todayXP}
              <span class="pill ok mono-tag">+{todayXP} XP</span>
            {:else}
              <span class="pill mono-tag">0 XP</span>
            {/if}
            <span class="dash-progress-quick-stats mono-tag">{stats?.streak ?? 0}d · {stats?.learned ?? 0} learned</span>
          </div>
        </summary>
        <div class="dash-collapsible-body dash-progress-body">
          <div class="chips" style="display:flex;gap:8px;margin-bottom:12px;">
            <span class="chip" title="Day streak" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#fff;border:1.5px solid #000;border-radius:100px;font-size:12px;font-weight:700;">
              <Icon name="fire" size={14} /><b>{stats?.streak ?? 0}</b>
            </span>
            <span class="chip" title="Total XP" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#fff;border:1.5px solid #000;border-radius:100px;font-size:12px;font-weight:700;">
              <Icon name="bolt" size={14} /><b>{stats?.xp ?? 0}</b>
            </span>
          </div>
          <div class="stat-row">
            <div class="stat-box"><span class="mono-tag">Learned</span><b class="mono-tag">{stats?.learned ?? 0}</b></div>
            <div class="stat-box"><span class="mono-tag">Due</span><b class="mono-tag">{stats?.due ?? 0}</b></div>
          </div>
          {#if stats?.due}
            <a class="btn btn-gate-pill block" href="#/learn/review">Review {stats.due} words now</a>
          {:else if stats?.learned}
            <p class="stat-note">All caught up! Next review soon.</p>
          {/if}
          {#if quests.length > 0}
            <div class="dash-today-quests">
              <div class="dash-activity-head"><span class="muted small mono-tag">Active quests</span></div>
              <ul class="quests">
                {#each quests as q}
                  <li>
                    <div class="row spread mono-tag">
                      <span>Earn {q} XP</span>
                      <span class="muted small">{stats?.xp ?? 0}/{q}</span>
                    </div>
                    <div class="bar"><i style="width: {Math.min(100, Math.round((100 * (stats?.xp ?? 0)) / q))}%"></i></div>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          <div class="dash-side-links">
            <a class="small mono-tag" href="#/learn/words">All your words</a>
            {#if stats?.learned}
              <a class="small mono-tag" href="#/learn/review">Shuffled flashcards</a>
            {/if}
          </div>
        </div>
      </details>

      <div class="card widget dash-rank-card">
        <a href="#/leaderboard" class="dash-rank-line">
          <span class="dash-rank-title">Leaderboard</span>
          <span class="dash-rank-val mono-tag">#{myRank} this week →</span>
        </a>
      </div>
    </aside>
  {/if}
</div>
