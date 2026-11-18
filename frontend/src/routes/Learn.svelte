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
</script>

<div class="dash">
  {#if loading}
    <div class="loading-state">
      <p class="muted">Loading your courses…</p>
    </div>
  {:else if errorMsg}
    <section class="card error-box">
      <h2>Something went wrong</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/discover" class="btn primary">Browse courses</a>
    </section>
  {:else}
    <!-- Main Course Section -->
    <div class="dash-main">
      {#if myCourses.length === 0}
        <section class="card empty-state">
          <div class="empty-icon">
            <Icon name="cards" size={48} />
          </div>
          <h2>You're not enrolled in any courses yet</h2>
          <p class="muted">Explore courses created by us and the community to start learning.</p>
          <div class="btn-row">
            <a href="#/discover" class="btn primary">Find a course</a>
            <a href="#/studio" class="btn outline">Create a course</a>
          </div>
        </section>
      {:else}
        <div class="enrolled-grid">
          {#each myCourses as c (c.id)}
            {@const pct = c.words ? Math.round((100 * (c.learned || 0)) / c.words) : 0}
            <div class="card enrolled-card">
              <div class="card-top">
                <span class="pill yellow">{c.creator?.official ? 'OFFICIAL' : 'ENROLLED'}</span>
                <span class="mono-tag lang-tag">{c.fromLang || 'EN'} → {c.toLang || 'LT'}</span>
              </div>

              <h3 class="course-title">
                <a href="#/learn/course/{c.id}">{c.title}</a>
              </h3>

              <p class="course-desc">
                {c.description || 'Comprehensive vocabulary and conversational practice.'}
              </p>

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

              <div class="card-actions">
                <a href="#/learn/course/{c.id}" class="btn primary sm">
                  {c.learned ? 'Continue →' : 'Start →'}
                </a>
                <a href="#/course/{c.id}" class="btn outline sm">About</a>
              </div>
            </div>
          {/each}

          <!-- Add Course Card -->
          <a href="#/discover" class="add-course-card">
            <div class="add-inner">
              <span class="plus-icon"><Icon name="plus" size={24} /></span>
              <b>Find more courses</b>
            </div>
          </a>
        </div>
      {/if}
    </div>

    <!-- Side Widgets (Today Stats, Quests, 14-day Chart) -->
    <aside class="dash-side">
      {#if stats}
        <div class="card side-widget">
          <div class="widget-head">
            <h3>Today</h3>
            <div class="head-pills">
              {#if stats.due > 0}
                <span class="pill pink">{stats.due} DUE</span>
              {/if}
              <span class="pill yellow">+{todayXP} XP</span>
            </div>
          </div>

          <div class="stat-counts">
            <div class="stat-box">
              <span class="mono-tag muted">Learned</span>
              <b class="stat-num">{stats.learned || 0}</b>
            </div>
            <div class="stat-box">
              <span class="mono-tag muted">Due</span>
              <b class="stat-num">{stats.due || 0}</b>
            </div>
          </div>

          {#if stats.due > 0}
            <a href="#/learn/review" class="btn primary full-width">
              <Icon name="shuffle" size={16} />
              <span>Review {stats.due} {stats.due === 1 ? 'word' : 'words'}</span>
            </a>
          {:else}
            <p class="muted small note">All caught up on reviews!</p>
          {/if}

          <!-- 14-Day Activity -->
          {#if stats.days && stats.days.length}
            <div class="activity-section">
              <span class="mono-tag muted small">XP · LAST 14 DAYS</span>
              <div class="sparkline-bars">
                {#each stats.days as d}
                  {@const maxXP = Math.max(...stats.days.map(x => x.xp || 0), 20)}
                  {@const height = Math.min(100, Math.round((d.xp / maxXP) * 100))}
                  <div class="bar-col" title="{d.date || ''}: {d.xp || 0} XP">
                    <div class="bar-fill" style="height: {height || 6}%;"></div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Active Quests -->
          {#if quests.length}
            <div class="quests-section">
              <span class="mono-tag muted small">ACTIVE QUESTS</span>
              <ul class="quest-list">
                {#each quests as q}
                  {@const qpct = Math.min(100, Math.round((100 * (stats.xp || 0)) / q))}
                  <li class="quest-item">
                    <div class="quest-row mono-tag">
                      <span>Earn {q} XP</span>
                      <span class="muted small">{stats.xp || 0}/{q}</span>
                    </div>
                    <div class="quest-track">
                      <div class="quest-fill" style="width: {qpct}%"></div>
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .dash {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }

  @media (max-width: 900px) {
    .dash {
      flex-direction: column;
    }
  }

  .dash-main {
    flex: 1;
    min-width: 0;
  }

  .dash-side {
    width: 310px;
    min-width: 310px;
  }

  @media (max-width: 900px) {
    .dash-side {
      width: 100%;
      min-width: 0;
    }
  }

  .loading-state, .error-box {
    text-align: center;
    padding: 60px 20px;
  }

  .empty-state {
    text-align: center;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-row {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .enrolled-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 20px;
  }

  .enrolled-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 250px;
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    padding: 22px;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }

  .enrolled-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 6px 0 rgba(26, 26, 26, 0.3);
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .lang-tag {
    font-size: 11px;
    color: var(--ink-60);
    font-weight: 700;
  }

  .course-title {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 900;
    margin-bottom: 6px;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .course-title a {
    color: var(--color-ink-black);
    text-decoration: none;
    transition: color 0.1s ease;
  }

  .course-title a:hover {
    color: var(--color-magenta-punch);
  }

  .course-desc {
    font-size: 13.5px;
    color: var(--ink-60);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 16px;
  }

  .progress-wrap {
    margin-bottom: 18px;
  }

  .progress-labels {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 6px;
  }

  .progress-track {
    height: 10px;
    background: rgba(26, 26, 26, 0.12);
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--color-hi-vis-yellow);
    border-radius: var(--radius-pill);
    transition: width 0.3s ease;
  }

  .card-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .add-course-card {
    border: 2px dashed var(--color-ink-black);
    border-radius: var(--radius-card);
    background: rgba(249, 245, 242, 0.4);
    min-height: 250px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    box-shadow: 0 4px 0 rgba(26, 26, 26, 0.15);
    transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.12s ease;
  }

  .add-course-card:hover {
    background: var(--color-bone-white);
    transform: translateY(-3px);
    box-shadow: 0 6px 0 rgba(26, 26, 26, 0.3);
  }

  .add-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--color-ink-black);
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 800;
  }

  .plus-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: var(--border-thick);
    background: var(--color-bone-white);
    box-shadow: 0 2px 0 var(--color-ink-black);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Side Widget */
  .side-widget {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .widget-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .widget-head h3 {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 900;
  }

  .head-pills {
    display: flex;
    gap: 6px;
  }

  .stat-counts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .stat-box {
    background: rgba(26, 26, 26, 0.03);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: 0 2px 0 var(--color-ink-black);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-num {
    font-family: var(--font-mono);
    font-size: 24px;
    font-weight: 800;
  }

  .full-width {
    width: 100%;
    justify-content: center;
  }

  .note {
    text-align: center;
    margin: 4px 0;
  }

  .activity-section, .quests-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1.5px solid rgba(26, 26, 26, 0.12);
  }

  .sparkline-bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 50px;
    padding-top: 6px;
  }

  .bar-col {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }

  .bar-fill {
    width: 100%;
    background: var(--color-matcha-cream);
    border: 1.5px solid var(--color-ink-black);
    border-radius: 2px 2px 0 0;
    min-height: 4px;
    transition: height 0.2s ease;
  }

  .bar-col:last-child .bar-fill {
    background: var(--color-hi-vis-yellow);
  }

  .quest-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;
  }

  .quest-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .quest-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 700;
  }

  .quest-track {
    height: 8px;
    background: rgba(26, 26, 26, 0.12);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .quest-fill {
    height: 100%;
    background: var(--color-matcha-cream);
    border-radius: var(--radius-pill);
  }
</style>
