<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);
  let enrolling = $state(false);

  onMount(async () => {
    try {
      loading = true;
      const res = await api(`/courses/${id}`);
      data = res;
    } catch (e) {
      errorMsg = e.message || 'Failed to load course details';
    } finally {
      loading = false;
    }
  });

  let c = $derived(data?.course || null);
  let units = $derived(data?.units || []);

  async function handleEnroll() {
    try {
      enrolling = true;
      await api('/learn', {
        method: 'POST',
        body: { courseId: c.id }
      });
      appState.showToast(`Enrolled in ${c.title}!`);
      appState.navigate(`#/learn/course/${c.id}`);
    } catch (e) {
      appState.showToast(e.message || 'Failed to enroll');
    } finally {
      enrolling = false;
    }
  }
</script>

<div class="course-detail-view">
  <div class="detail-header">
    <a href="#/discover" class="back-link mono-tag">
      <Icon name="back" size={16} />
      <span>All courses</span>
    </a>
    {#if data?.canEdit}
      <a href="#/studio/{c.id}" class="btn sm outline">
        <Icon name="edit" size={14} />
        <span>Edit course</span>
      </a>
    {/if}
  </div>

  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading course details…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Unable to load course</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/discover" class="btn primary">Back to Discover</a>
    </div>
  {:else if c}
    <section class="card hero-card">
      <div class="hero-top">
        <span class="pill yellow">{c.creator?.official ? 'OFFICIAL' : 'COMMUNITY'}</span>
        <span class="mono-tag muted">{c.fromLang} → {c.toLang}</span>
      </div>

      <h1 class="hero-title">{c.title}</h1>

      <p class="stats-line mono-tag muted small">
        {c.units || units.length} decks · {c.words || 0} words · {c.learners || 0} learners
      </p>

      <p class="hero-desc">{c.description || 'Comprehensive vocabulary and conversational practice.'}</p>

      <div class="hero-actions">
        {#if c.enrolled}
          <a href="#/learn/course/{c.id}" class="btn primary">
            Continue course →
          </a>
        {:else}
          <button
            type="button"
            class="btn primary"
            onclick={handleEnroll}
            disabled={enrolling}
          >
            {enrolling ? 'Enrolling...' : 'Enroll in course →'}
          </button>
        {/if}
      </div>
    </section>

    <!-- Units & Syllabus Breakdown -->
    <div class="syllabus-card card">
      <h2 class="syllabus-title">Course Syllabus</h2>

      <div class="unit-list">
        {#each units as u, i}
          <div class="unit-item">
            <div class="unit-header">
              <span class="unit-num mono-tag">DECK {i + 1}</span>
              <h3 class="unit-title">{u.title}</h3>
              <span class="unit-words-count mono-tag muted small">
                {(u.lessons || []).length} lessons
              </span>
            </div>

            {#if u.lessons && u.lessons.length}
              <ul class="lesson-pills">
                {#each u.lessons as l}
                  <li class="lesson-chip mono-tag">
                    {l.title}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .course-detail-view {
    max-width: 760px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
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

  .hero-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .hero-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .hero-title {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 900;
    line-height: 1.1;
  }

  .stats-line {
    font-size: 12px;
  }

  .hero-desc {
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-60);
  }

  .hero-actions {
    margin-top: 8px;
  }

  .syllabus-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .syllabus-title {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.12);
    padding-bottom: 10px;
  }

  .unit-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .unit-item {
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    padding: 14px;
    background: var(--color-bone-white);
  }

  .unit-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }

  .unit-num {
    font-size: 11px;
    color: var(--ink-60);
  }

  .unit-title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    flex: 1;
  }

  .lesson-pills {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0;
  }

  .lesson-chip {
    background: rgba(26, 26, 26, 0.05);
    border: 1px solid rgba(26, 26, 26, 0.2);
    border-radius: var(--radius-pill);
    padding: 3px 10px;
    font-size: 11px;
  }
</style>
