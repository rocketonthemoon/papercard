<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);

  onMount(async () => {
    try {
      loading = true;
      data = await api(`/courses/${id}`);
    } catch (e) {
      errorMsg = e.message || 'Failed to load course';
    } finally {
      loading = false;
    }
  });

  let c = $derived(data?.course || null);
  let units = $derived(data?.units || []);
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
</script>

<div>
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:40px 0;">Loading course…</p>
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
    <div class="toolbar course-breadcrumb-bar" style="margin-bottom:16px;">
      <div class="breadcrumb-trail">
        <a class="back mono-tag" href="#/discover" style="text-decoration:none;color:inherit;font-weight:700;">
          ← Courses
        </a>
        <span class="breadcrumb-sep" style="margin:0 8px;">/</span>
        <span class="breadcrumb-current mono-tag" style="opacity:0.8;">{c.title}</span>
      </div>
      <div class="toolbar-actions">
        {#if canEdit}
          <a class="btn outline small" href="#/studio/{c.id}">Edit course</a>
        {/if}
      </div>
    </div>

    <div class="course-page" style="display:grid;grid-template-columns:1fr 300px;gap:24px;">
      <div class="course-page-main">
        <section class="card course-overview" style="margin-bottom:24px;">
          <div class="row" style="gap:8px;margin-bottom:12px;">
            <span class="pill yellow">{c.creator?.official ? 'OFFICIAL' : 'COMMUNITY'}</span>
            <span class="mono-tag muted">{c.fromLang} → {c.toLang}</span>
          </div>
          <h1 style="font-family:var(--font-display);font-size:32px;font-weight:900;letter-spacing:-0.03em;">{c.title}</h1>
          <p class="muted" style="margin:12px 0 20px;font-size:16px;line-height:1.5;">{c.description || 'Step-by-step vocabulary and phrases.'}</p>

          <div class="course-stats mono-tag muted small" style="display:flex;gap:16px;border-top:1.5px solid rgba(0,0,0,0.1);padding-top:14px;">
            <span>{units.length} decks</span>
            <span>{c.words} words</span>
            <span>{c.learners || 0} learners</span>
          </div>
        </section>

        <!-- Syllabus -->
        <h2 style="font-family:var(--font-display);font-size:24px;font-weight:900;margin-bottom:14px;">Course Decks</h2>
        <div class="syllabus-list" style="display:flex;flex-direction:column;gap:12px;">
          {#each units as u, ui}
            <div class="card unit-preview-card" style="padding:18px 24px;">
              <div class="row spread" style="margin-bottom:8px;">
                <b style="font-size:18px;">Deck {ui + 1}: {u.title}</b>
                <span class="pill bone sm">{u.level || 'A1'}</span>
              </div>
              {#if u.description}
                <p class="muted small" style="margin-bottom:10px;">{u.description}</p>
              {/if}
              <div class="mono-tag small muted">
                {(u.lessons || []).length} lessons · {(u.lessons || []).reduce((n, l) => n + (l.total || 0), 0)} words
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Side Card -->
      <aside class="course-page-side">
        <div class="card enroll-card" style="position:sticky;top:80px;text-align:center;">
          <h3 style="font-family:var(--font-display);font-size:22px;margin-bottom:8px;">Ready to learn?</h3>
          <p class="muted small" style="margin-bottom:20px;">Master this course with bite-sized lessons and flashcards.</p>
          {#if c.enrolled}
            <a href="#/learn/course/{c.id}" class="btn btn-gate-pill" style="width:100%;justify-content:center;">Continue learning →</a>
          {:else}
            <button class="btn btn-gate-pill" style="width:100%;justify-content:center;" onclick={handleEnroll}>Start course →</button>
          {/if}
        </div>
      </aside>
    </div>
  {/if}
</div>
