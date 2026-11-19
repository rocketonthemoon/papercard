<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let course = $state(null);
  let units = $state([]);
  let stats = $state(null);
  let board = $state(null);
  let openUnits = $state(new Set());

  async function loadData(cid) {
    try {
      loading = true;
      errorMsg = '';
      const [data, boardData] = await Promise.all([
        api(`/learn?course=${cid}`),
        api('/leaderboard?period=week').catch(() => ({ rows: [] }))
      ]);

      course = data.course;
      units = data.units || [];
      stats = data.stats || null;
      board = boardData || { rows: [] };

      if (stats) appState.topStats = stats;

      // Automatically open the unit containing the current lesson, or unit 0
      const cur = findCurrentLessonId(units);
      const activeUnit = units.find(u => (u.lessons || []).some(l => l.id === cur))?.id ?? units[0]?.id;
      if (activeUnit) {
        openUnits = new Set([activeUnit]);
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load course path';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (id) {
      loadData(id);
    }
  });

  function findCurrentLessonId(unitList) {
    for (const u of unitList) {
      for (const l of (u.lessons || [])) {
        if (l.total > 0 && l.done < l.total) return l.id;
      }
    }
    return unitList[0]?.lessons?.[0]?.id ?? null;
  }

  let current = $derived(findCurrentLessonId(units));

  function toggleUnit(unitId) {
    const next = new Set(openUnits);
    if (next.has(unitId)) {
      next.delete(unitId);
    } else {
      next.add(unitId);
    }
    openUnits = next;
  }

  const tint = (cid) => `tint-${Math.abs(Number(cid) || 0) % 6}`;

  function unitWords(u) {
    return (u.lessons || []).reduce((n, l) => n + (l.total || 0), 0);
  }

  function unitLearned(u) {
    return (u.lessons || []).reduce((n, l) => n + (l.done || 0), 0);
  }

  let totalWords = $derived(course?.words || 0);
  let learnedWords = $derived(course?.learned || 0);
  let coursePct = $derived(totalWords ? Math.round((100 * learnedWords) / totalWords) : 0);

  let myRank = $derived.by(() => {
    const myRow = board?.rows?.find((r) => r.isYou);
    return myRow ? myRow.rank : (board?.me?.rank || 1);
  });

  let todayXP = $derived(stats?.today || 0);
  let quests = $derived([100, 250, 500]);

  function ringSvg(done, total) {
    if (total && done >= total) {
      return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--green)"/><path d="M6 10.3l2.6 2.6L14 7.6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (!done) {
      return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="2.2 2.4"/></svg>`;
    }
    const c = 2 * Math.PI * 8;
    return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" stroke-width="2"/><circle cx="10" cy="10" r="8" fill="none" stroke="var(--green)" stroke-width="2" stroke-dasharray="${((c * done) / total).toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 10 10)"/></svg>`;
  }
</script>

<div>
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:60px 0;">Loading course path…</p>
  {:else if errorMsg || !course}
    <section class="card picker" style="max-width:540px;margin:20px auto;">
      <header class="picker-head">
        <h2>Course not found</h2>
        <p class="muted">{errorMsg || 'Could not load this course.'}</p>
      </header>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <a class="btn btn-gate-pill" href="#/learn">Back to My Courses</a>
      </div>
    </section>
  {:else}
    <div class="dash">
      <div class="dash-main course-path">
        <!-- Breadcrumb Bar -->
        <div class="toolbar course-breadcrumb-bar">
          <div class="breadcrumb-trail">
            <a class="back mono-tag" href="#/learn">← My courses</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current mono-tag">{course.title}</span>
          </div>
          <div class="toolbar-actions">
            {#if course.mine}
              <a class="btn outline small" href="#/studio/{course.id}">Edit in Studio</a>
            {/if}
            <a class="linkbtn small quiet-link" href="#/course/{course.id}">About course</a>
          </div>
        </div>

        <!-- Hero Card -->
        <section class="card course-hero-path {tint(course.id)}">
          <div class="course-hero-inner">
            <div class="course-hero-text">
              <h1 class="course-hero-title">{course.title}</h1>
              <div class="course-hero-meta mono-tag">
                <span>
                  {course.creator?.official ? 'Official · ' : ''}
                  {course.fromLang} → {course.toLang} · 
                  {totalWords} {totalWords === 1 ? 'word' : 'words'} · 
                  {units.length} {units.length === 1 ? 'deck' : 'decks'}
                </span>
              </div>
              {#if course.description}
                <p class="course-hero-desc">{course.description}</p>
              {/if}
              <div class="course-path-progress">
                <div class="row spread small mono-tag">
                  <span><b>{coursePct}%</b> COMPLETED</span>
                  <span class="meta-words">
                    {totalWords - learnedWords > 0 ? `${totalWords - learnedWords} words left` : 'All learned!'}
                  </span>
                </div>
                <div class="bar"><i style="width:{coursePct}%"></i></div>
              </div>
              {#if current}
                <div class="course-hero-cta">
                  <a class="btn btn-gate-pill small" href="#/learn/lesson/{current}">
                    <span>{learnedWords > 0 ? 'Continue →' : 'Start →'}</span>
                  </a>
                </div>
              {/if}
            </div>
          </div>
        </section>

        <!-- Units list -->
        <div class="unit-cards-list">
          {#each units as u, ui (u.id)}
            {@const words = unitWords(u)}
            {@const learned = unitLearned(u)}
            {@const pct = words ? Math.round((100 * learned) / words) : 0}
            {@const done = u.lessons?.length > 0 && u.lessons.every(l => l.total > 0 && l.done >= l.total)}
            {@const hasCurrent = (u.lessons || []).some(l => l.id === current)}
            {@const currentLesson = (u.lessons || []).find(l => l.id === current)}
            {@const currentLessonIdx = (u.lessons || []).findIndex(l => l.id === current)}
            {@const isOpen = openUnits.has(u.id)}

            <section class="card module-card unit-card {isOpen ? 'open' : ''}" data-unit={u.id}>
              <!-- Header -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="module-head" onclick={() => toggleUnit(u.id)}>
                <span class="module-no mono-tag">
                  Unit {String(ui + 1).padStart(2, '0')}<small>/{String(units.length).padStart(2, '0')}</small>
                </span>
                <div class="module-info">
                  <div class="module-title-row">
                    <h2>{u.title}</h2>
                    {#if u.level}
                      <span class="pill level-pill mono-tag">{u.level}</span>
                    {/if}
                  </div>
                  {#if u.description}
                    <p class="module-desc">{u.description}</p>
                  {/if}
                </div>
                <button
                  type="button"
                  class="chev icon-btn"
                  aria-label="Show lessons"
                  aria-expanded={isOpen}
                  onclick={(e) => { e.stopPropagation(); toggleUnit(u.id); }}
                >
                  <Icon name="chev" size={14} />
                </button>
              </div>

              <!-- Module progress & Action -->
              <div class="module-progress">
                <div class="row spread mono-tag unit-progress-label">
                  <span><b>{pct}%</b> COMPLETED</span>
                  <span class="muted small">{words - learned ? `${words - learned} words left` : 'All learned'}</span>
                </div>
                <div class="bar unit-bar"><i style="width:{pct}%"></i></div>

                {#if hasCurrent && currentLesson}
                  <div class="module-action">
                    <a class="btn unit-primary-btn" href="#/learn/lesson/{current}">
                      <span>{learned ? 'Continue →' : 'Start course →'}</span>
                      <small class="unit-btn-sub">Lesson {currentLessonIdx + 1}: {currentLesson.title} · {currentLesson.total} words</small>
                    </a>
                  </div>
                {:else if done}
                  <div class="module-action">
                    <a class="btn outline unit-secondary-btn" href="#/learn/lesson/{u.lessons[0]?.id}">
                      <span>Practise Deck</span> <span class="btn-arrow">↺</span>
                    </a>
                  </div>
                {:else if (u.lessons || []).length > 0}
                  <div class="module-action">
                    <a class="btn outline unit-secondary-btn" href="#/learn/lesson/{u.lessons[0]?.id}">
                      <span>{learned > 0 ? 'Continue Deck' : 'Start Deck'}</span> <span class="btn-arrow">→</span>
                    </a>
                  </div>
                {/if}
              </div>

              <!-- Lessons rows -->
              <ul class="lesson-rows">
                {#each (u.lessons || []) as l, li (l.id)}
                  {@const isDone = l.total > 0 && l.done >= l.total}
                  {@const isCur = l.id === current}
                  {@const metaText = isDone ? `${l.total} words · Completed` : l.done > 0 ? `${l.done}/${l.total} learned` : `${l.total} words`}
                  {@const ctaText = isDone ? 'Review' : isCur ? 'Start →' : l.done > 0 ? 'Continue' : 'Start'}

                  <li>
                    <a
                      class="lesson-row-link lesson-node {isCur ? 'current' : isDone ? 'done' : ''}"
                      href="#/learn/lesson/{l.id}"
                      title={isDone ? 'Practise' : isCur ? 'Up next' : 'Play'}
                    >
                      {#if isDone}
                        <span class="lesson-num step-badge done" title="Completed">
                          <Icon name="check" size={12} />
                        </span>
                      {:else if isCur}
                        <span class="lesson-num step-badge current" title="Current lesson">
                          <span class="badge-dot-inner"></span>{li + 1}
                        </span>
                      {:else}
                        <span class="lesson-num step-badge" title="Lesson {li + 1}">{li + 1}</span>
                      {/if}

                      <div class="lesson-step-content">
                        <span class="lesson-title">Lesson {li + 1}: {l.title}</span>
                        <span class="lesson-step-meta mono-tag">{metaText}</span>
                      </div>

                      <span class="lesson-state mono-tag">
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html ringSvg(l.done || 0, l.total || 0)}
                        <span class="lesson-cta-text">{ctaText}</span>
                      </span>

                      <span class="lesson-end">
                        <Icon name="chev" size={14} />
                      </span>
                    </a>
                  </li>
                {:else}
                  <li class="muted small mono-tag" style="padding:16px;">No lessons yet.</li>
                {/each}
              </ul>

              <!-- Footer -->
              <div class="module-foot mono-tag">
                <span class="muted small">{(u.lessons || []).length} lessons · {words} words</span>
              </div>
            </section>
          {:else}
            <section class="card picker">
              <header class="picker-head">
                <h2>No lessons yet</h2>
                <p class="muted">The creator has not added any lessons to this course yet.</p>
              </header>
            </section>
          {/each}
        </div>
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
    </div>
  {/if}
</div>
