<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);

  async function loadCourse(courseId) {
    try {
      loading = true;
      errorMsg = '';
      data = await api(`/courses/${courseId}`);
    } catch (e) {
      errorMsg = e.message || 'Failed to load course';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (id) {
      loadCourse(id);
    }
  });

  let c = $derived(data?.course || null);
  let units = $derived(data?.units || []);
  let creator = $derived(data?.creator || null);
  let canEdit = $derived(data?.canEdit || false);

  async function handleEnroll() {
    try {
      await api('/learn', { method: 'POST', body: { courseId: c.id } });
      appState.showToast(`Enrolled in ${c.title}!`);
      appState.navigate(`#/learn/course/${c.id}`);
    } catch (e) {
      appState.showToast(e.message || 'Failed to enroll');
    }
  }

  async function handleLeave() {
    if (!confirm('Leave this course? Your progress is kept if you come back.')) return;
    try {
      await api(`/courses/${c.id}/enroll`, { method: 'DELETE' });
      await loadCourse(c.id);
      appState.showToast('Course removed from your learning list');
    } catch (e) {
      appState.showToast(e.message || 'Failed to leave course');
    }
  }

  function flag(course) {
    const code = (course?.toCode || course?.toLang || '').toLowerCase();
    if (code === 'lt' || code === 'lithuanian') return 'LT';
    if (code === 'en' || code === 'english') return 'EN';
    if (code === 'es' || code === 'spanish') return 'ES';
    if (code === 'fr' || code === 'french') return 'FR';
    if (code === 'de' || code === 'german') return 'DE';
    return (code.slice(0, 2) || 'LT').toUpperCase();
  }
</script>

<div>
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:60px 0;">Loading course…</p>
  {:else if errorMsg || !c}
    <section class="card picker" style="max-width:540px;margin:20px auto;">
      <header class="picker-head">
        <h2>Course not found</h2>
        <p class="muted">{errorMsg || 'Could not find the requested course.'}</p>
      </header>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <a class="btn btn-gate-pill" href="#/discover">Back to Courses</a>
      </div>
    </section>
  {:else}
    <div class="toolbar course-breadcrumb-bar">
      <div class="breadcrumb-trail">
        <a class="back mono-tag" href="#/discover">← Courses</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-current mono-tag">{c.title}</span>
      </div>
      <div class="toolbar-actions">
        {#if canEdit}
          <a class="btn outline small" href="#/studio/{c.id}">Edit course</a>
        {/if}
      </div>
    </div>

    <div class="course-page">
      <div class="course-page-main">
        <section class="card course-hero">
          <div class="course-hero-top">
            <div class="hero-badges">
              <span class="tag-chip mono-tag">{c.creator?.official ? 'OFFICIAL' : 'COURSE'}</span>
              <span class="meta-lang mono-tag">{c.fromLang} → {c.toLang}</span>
            </div>
            <span class="course-flag big">{flag(c)}</span>
          </div>

          <h1>
            {c.title}
            {#if c.hidden}<span class="pill due">hidden</span>{/if}
            {#if c.locked}<span class="pill">locked</span>{/if}
          </h1>

          <p class="muted course-stats-row">
            {units.length} {units.length === 1 ? 'deck' : 'decks'} · 
            {c.words} {c.words === 1 ? 'word' : 'words'} · 
            {c.learners || 0} {c.learners === 1 ? 'learner' : 'learners'}
          </p>

          {#if c.description}
            <p class="course-description-text">{c.description}</p>
          {/if}

          <div class="course-hero-actions">
            {#if c.enrolled}
              <a class="btn btn-hero-primary" href="#/learn/course/{c.id}">Continue →</a>
            {:else}
              <button class="btn btn-hero-primary" onclick={handleEnroll}>Start course →</button>
            {/if}
          </div>
        </section>

        <section class="card list-card">
          <div class="list-head">
            <h3>Decks ({units.length})</h3>
          </div>
          <ul class="rows">
            {#each units as u, i}
              <li class="deck-row">
                <span class="level-chip-badge">{u.level ? u.level : String(i + 1).padStart(2, '0')}</span>
                <div class="deck-info">
                  <b>Deck {i + 1}: {u.title}</b>
                  {#if u.description}
                    <p class="muted small">{u.description}</p>
                  {/if}
                </div>
                <span class="deck-meta mono-tag muted small">
                  {u.learned ? `${u.learned}/` : ''}{u.words || 0} {u.words === 1 ? 'word' : 'words'}
                </span>
              </li>
            {:else}
              <li class="empty-row">No decks yet.</li>
            {/each}
          </ul>
        </section>

        {#if c.enrolled}
          <div class="course-leave-row" style="margin-top:16px;">
            <button class="link-disclaimer-underline" onclick={handleLeave}>Leave course</button>
          </div>
        {/if}
      </div>

      <aside class="card side-card">
        {#if creator}
          <h3>Made by</h3>
          <div class="profile-mini" style="margin-top:12px;">
            <a class="who-pill profile-pill" href="#/u/{creator.username}">
              <span>{creator.name || creator.username}</span>
            </a>
            {#if creator.bio}
              <p class="muted small" style="margin-top:8px;">{creator.bio}</p>
            {/if}
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>
