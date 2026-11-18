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

  onMount(async () => {
    try {
      loading = true;
      const res = await api(`/learn?course=${id}`);
      course = res.course;
      units = res.units || [];
      stats = res.stats || null;
      if (stats) appState.topStats = stats;
    } catch (e) {
      errorMsg = e.message || 'Failed to load course path';
    } finally {
      loading = false;
    }
  });

  // Calculate current lesson (first unfinished)
  let currentLessonId = $derived(() => {
    for (const u of units) {
      for (const l of (u.lessons || [])) {
        if (!l.total || l.done < l.total) return l.id;
      }
    }
    return units[0]?.lessons?.[0]?.id || null;
  });
</script>

<div class="course-path-container">
  <div class="path-header">
    <a href="#/learn" class="back-link mono-tag">
      <Icon name="back" size={16} />
      <span>All courses</span>
    </a>
    {#if course}
      <a href="#/course/{course.id}" class="btn sm outline">Course info</a>
    {/if}
  </div>

  {#if loading}
    <div class="card loading-card">
      <p class="muted">Loading course units…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-card">
      <h2>Failed to load course</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/learn" class="btn primary">Back to Home</a>
    </div>
  {:else if course}
    <div class="course-banner card">
      <div class="banner-top">
        <span class="pill yellow">{course.creator?.official ? 'OFFICIAL' : 'COURSE'}</span>
        <span class="mono-tag muted">{course.fromLang} → {course.toLang}</span>
      </div>
      <h1 class="course-title">{course.title}</h1>
      <p class="course-desc muted">{course.description || 'Step-by-step vocabulary and phrases.'}</p>
    </div>

    <!-- Units Stack -->
    <div class="units-stack">
      {#each units as u, ui}
        {@const unitDone = (u.lessons || []).every(l => l.total > 0 && l.done >= l.total)}
        {@const unitLearned = (u.lessons || []).reduce((acc, l) => acc + (l.done || 0), 0)}
        {@const unitTotal = (u.lessons || []).reduce((acc, l) => acc + (l.total || 0), 0)}
        {@const unitPct = unitTotal ? Math.round((100 * unitLearned) / unitTotal) : 0}

        <section class="card unit-card" class:completed={unitDone}>
          <header class="unit-head">
            <div class="unit-title-group">
              <span class="unit-num mono-tag">UNIT {ui + 1}</span>
              <h2 class="unit-name">{u.title}</h2>
            </div>
            <div class="unit-badge-group">
              <span class="mono-tag small muted">{unitLearned}/{unitTotal} words</span>
              <span class="pill sm" class:matcha={unitDone} class:yellow={!unitDone}>
                {unitPct}%
              </span>
            </div>
          </header>

          <!-- Lesson Steps List -->
          <ul class="lesson-step-list">
            {#each (u.lessons || []) as l, li}
              {@const isDone = l.total > 0 && l.done >= l.total}
              {@const isCurrent = l.id === currentLessonId()}
              <li>
                <a
                  href="#/learn/lesson/{l.id}"
                  class="lesson-row"
                  class:current={isCurrent}
                  class:done={isDone}
                >
                  <div class="step-num" class:done={isDone} class:current={isCurrent}>
                    {#if isDone}
                      <Icon name="check" size={14} />
                    {:else}
                      <span>{li + 1}</span>
                    {/if}
                  </div>

                  <div class="lesson-text">
                    <b class="lesson-name">{l.title}</b>
                    <span class="mono-tag muted small">
                      {isDone ? `${l.total} words · Completed` : `${l.done || 0}/${l.total} learned`}
                    </span>
                  </div>

                  <div class="lesson-cta mono-tag small">
                    <span class="cta-label">{isDone ? 'Review' : isCurrent ? 'Start →' : 'Practice'}</span>
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .course-path-container {
    max-width: 760px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-bottom: 40px;
  }

  .path-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-bone-white);
    font-weight: 700;
  }

  .back-link:hover {
    color: var(--color-hi-vis-yellow);
  }

  .course-banner {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .banner-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .course-title {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 900;
  }

  .units-stack {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .unit-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .unit-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.12);
  }

  .unit-num {
    font-size: 11px;
    color: var(--ink-60);
  }

  .unit-name {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
  }

  .unit-badge-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .lesson-step-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
  }

  .lesson-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    transition: transform 0.08s ease, background-color 0.1s ease;
  }

  .lesson-row:hover {
    background: rgba(244, 237, 54, 0.35);
    transform: translateX(3px);
  }

  .lesson-row.current {
    background: rgba(244, 237, 54, 0.5);
    box-shadow: 0 2px 0 var(--color-ink-black);
  }

  .step-num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .step-num.done {
    background: var(--color-matcha-cream);
  }

  .step-num.current {
    background: var(--color-hi-vis-yellow);
  }

  .lesson-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .lesson-name {
    font-size: 14.5px;
  }

  .cta-label {
    font-weight: 700;
  }
</style>
