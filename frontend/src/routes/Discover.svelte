<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let courses = $state([]);
  let searchQuery = $state('');
  let officialOnly = $state(false);

  onMount(async () => {
    try {
      loading = true;
      const res = await api('/courses');
      courses = res.courses || [];
    } catch (e) {
      errorMsg = e.message || 'Failed to load courses';
    } finally {
      loading = false;
    }
  });

  let filteredCourses = $derived(
    courses.filter(c => {
      if (officialOnly && !c.creator?.official) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        (c.title || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.toLang || '').toLowerCase().includes(q)
      );
    })
  );

  async function handleEnroll(c) {
    try {
      await api('/learn', { method: 'POST', body: { courseId: c.id } });
      appState.showToast(`Enrolled in ${c.title}!`);
      appState.navigate(`#/learn/course/${c.id}`);
    } catch (e) {
      appState.showToast(e.message || 'Failed to enroll');
    }
  }
</script>

<div class="discover-view">
  <header class="discover-hero">
    <h1 class="discover-title">Discover Courses</h1>
    <p class="discover-subtitle">Learn Lithuanian and other languages through courses made by us and learners.</p>

    <div class="search-bar">
      <input
        type="search"
        class="discover-input"
        placeholder="Search courses, topics, or languages..."
        bind:value={searchQuery}
      />
      <label class="filter-toggle">
        <input type="checkbox" bind:checked={officialOnly} />
        <span class="mono-tag small">Official only</span>
      </label>
    </div>
  </header>

  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading courses catalog…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Unable to load catalog</h2>
      <p class="muted">{errorMsg}</p>
    </div>
  {:else if filteredCourses.length === 0}
    <div class="card empty-box">
      <h2>No courses found</h2>
      <p class="muted">Try adjusting your search query or create a course in the Studio.</p>
      <a href="#/studio" class="btn primary">Create a course →</a>
    </div>
  {:else}
    <div class="courses-grid">
      {#each filteredCourses as c}
        <article class="card course-card">
          <div class="card-top">
            <span class="pill yellow">{c.creator?.official ? 'OFFICIAL' : 'COMMUNITY'}</span>
            <span class="mono-tag muted">{c.fromLang} → {c.toLang}</span>
          </div>

          <h2 class="card-title">
            <a href="#/course/{c.id}">{c.title}</a>
          </h2>

          <p class="card-desc">
            {c.description || 'Comprehensive vocabulary and conversational practice.'}
          </p>

          <div class="card-meta mono-tag muted small">
            <span>{c.words || 0} words</span> · <span>{c.learners || 0} learners</span>
          </div>

          <div class="card-actions">
            {#if c.enrolled}
              <a href="#/learn/course/{c.id}" class="btn primary sm">Continue →</a>
            {:else}
              <button
                type="button"
                class="btn primary sm"
                onclick={() => handleEnroll(c)}
              >
                Start →
              </button>
            {/if}
            <a href="#/course/{c.id}" class="btn outline sm">Details</a>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .discover-view {
    max-width: 1040px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .discover-hero {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .discover-title {
    font-family: var(--font-display);
    font-size: 34px;
    font-weight: 900;
    color: var(--color-bone-white);
  }

  .discover-subtitle {
    color: var(--color-bone-white);
    font-size: 16px;
    max-width: 580px;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .discover-input {
    flex: 1;
    min-width: 260px;
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    padding: 10px 20px;
    font-family: inherit;
    font-size: 15px;
    background: var(--color-bone-white);
  }

  .filter-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-bone-white);
    font-weight: 700;
    cursor: pointer;
  }

  .courses-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 20px;
  }

  .course-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 240px;
    transition: transform 0.12s ease;
  }

  .course-card:hover {
    transform: translateY(-2px);
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .card-title {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    line-height: 1.25;
    margin-bottom: 8px;
  }

  .card-title a:hover {
    color: var(--color-magenta-punch);
  }

  .card-desc {
    font-size: 13.5px;
    color: var(--ink-60);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 14px;
  }

  .card-meta {
    margin-bottom: 16px;
  }

  .card-actions {
    display: flex;
    gap: 10px;
  }

  .loading-box, .error-box, .empty-box {
    text-align: center;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
</style>
