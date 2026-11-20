<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';
  import TodayCard from '../lib/components/TodayCard.svelte';
  import { courseFlag, tintClass, percent, plural } from '../lib/format.js';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);
  let board = $state({ rows: [] });

  onMount(async () => {
    try {
      loading = true;
      const [learnData, boardData] = await Promise.all([
        api('/learn'),
        api('/leaderboard?period=week').catch(() => ({ rows: [] })),
      ]);
      data = learnData;
      board = boardData;
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
</script>

<div class="dash">
  {#if loading}
    <p class="page-loading" role="status">Loading your courses…</p>
  {:else if errorMsg}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Something went wrong</h2>
        <p class="muted">{errorMsg}</p>
      </header>
      <div class="row picker-actions">
        <a class="btn btn-gate-pill" href="#/discover">Discover courses</a>
      </div>
    </section>
  {:else}
    <div class="dash-main course-path">
      {#if myCourses.length > 0}
        <div class="enrolled-grid">
          {#each myCourses as c (c.id)}
            {@const pct = percent(c.learned, c.words)}
            {@const tag = c.creator?.official ? 'OFFICIAL' : 'ENROLLED'}
            <div class="card enrolled-card" data-course={c.id}>
              <!-- Tile Art matching web design -->
              <div class="tile-art {tintClass(c.id)}">
                <div class="pcard-top-row">
                  <span class="tag-chip mono-tag">{tag}</span>
                  <span class="lang-orb mono-tag">{courseFlag(c)}</span>
                </div>
                <h3 class="pcard-title">
                  <a class="link-plain" href="#/learn/course/{c.id}">{c.title}</a>
                </h3>
                <div class="pcard-sub mono-tag">{plural(c.units, 'deck')} · {plural(c.words, 'word')}</div>
              </div>

              {#if c.description}
                <p class="enrolled-desc" title={c.description}>{c.description}</p>
              {:else}
                <div class="enrolled-desc-spacer"></div>
              {/if}

              <!-- Progress bar -->
              <div class="enrolled-progress">
                <div class="row spread small mono-tag">
                  <span><b>{pct}%</b> complete</span>
                  <span class="muted">{c.learned || 0}/{c.words} words</span>
                </div>
                <div class="bar"><i style:width="{pct}%"></i></div>
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
          <div class="row picker-actions">
            <a class="btn btn-gate-pill" href="#/discover">Find a course</a>
            <a class="btn outline" href="#/studio">Create a course</a>
          </div>
        </section>
      {/if}
    </div>

    <TodayCard {stats} {board} />
  {/if}
</div>
