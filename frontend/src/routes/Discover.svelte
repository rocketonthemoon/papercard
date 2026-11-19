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

  const tint = (id) => `tint-${Math.abs(Number(id) || 0) % 6}`;

  function flag(c) {
    if (c.toCode) return c.toCode.toUpperCase();
    if (c.toLang && c.toLang.toLowerCase().includes('lithuanian')) return 'LT';
    return (c.toLang || 'LT').slice(0, 2).toUpperCase();
  }

  async function loadCatalog() {
    try {
      loading = true;
      const res = await api('/courses?tab=popular');
      courses = res.courses || [];
    } catch (e) {
      errorMsg = e.message || 'Failed to load courses';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadCatalog();
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

<div class="discover">
  <div class="discover-main">
    <section class="discover-hero">
      <form class="discover-search" id="d-form" role="search" onsubmit={(e) => e.preventDefault()}>
        <div class="search-input-wrap">
          <input
            type="search"
            id="d-q"
            placeholder="Search courses, languages, topics…"
            aria-label="Search courses"
            autocomplete="off"
            spellcheck="false"
            bind:value={searchQuery}
          />
          {#if searchQuery}
            <button type="button" class="search-clear-btn" aria-label="Clear search" onclick={() => searchQuery = ''}>
              <Icon name="close" size={16} />
            </button>
          {/if}
        </div>
        <button class="btn btn-gate-pill search-btn" type="submit">Search →</button>
      </form>

      <div class="row" style="margin-top:14px;gap:12px;">
        <label class="row" style="gap:8px;cursor:pointer;">
          <input type="checkbox" bind:checked={officialOnly} />
          <span class="mono-tag small" style="font-weight:700;">Official courses only</span>
        </label>
      </div>
    </section>

    {#if loading}
      <p class="muted loading" style="text-align:center;padding:40px 0;">Loading courses catalog…</p>
    {:else if errorMsg}
      <section class="card picker" style="max-width:540px;margin:20px auto;">
        <header class="picker-head">
          <h2>Unable to load catalog</h2>
          <p class="muted">{errorMsg}</p>
        </header>
      </section>
    {:else if filteredCourses.length === 0}
      <section class="card picker" style="max-width:540px;margin:20px auto;">
        <header class="picker-head">
          <h2>No courses found</h2>
          <p class="muted">Try adjusting your search query or create a course in the Studio.</p>
        </header>
        <div class="row" style="justify-content:center;margin-top:16px;">
          <a href="#/studio" class="btn btn-gate-pill">Create a course →</a>
        </div>
      </section>
    {:else}
      <div class="course-grid discover-grid" id="d-grid">
        {#each filteredCourses as c (c.id)}
          {@const tag = c.creator?.official ? 'OFFICIAL' : c.enrolled ? 'ENROLLED' : 'COMMUNITY'}
          {@const pct = c.words ? Math.round((100 * (c.learned || 0)) / c.words) : 0}
          <article class="pcard">
            <div class="tile-art {tint(c.id)}">
              <div class="pcard-top-row">
                <span class="tag-chip mono-tag">{tag}</span>
                <span class="lang-orb mono-tag">{flag(c)}</span>
              </div>
              <h3 class="pcard-title" title={c.title}>
                <a href="#/course/{c.id}">{c.title}</a>
              </h3>
              <p class="pcard-desc" title={c.description || ''}>
                {c.description || 'Comprehensive vocabulary and conversational practice.'}
              </p>
              <div class="meta mono-tag">
                <span>{c.fromLang || 'en'} → {c.toLang || 'lt'}</span> · 
                <span>{c.words} {c.words === 1 ? 'word' : 'words'}</span> · 
                <span>{c.learners || 0} {c.learners === 1 ? 'learner' : 'learners'}</span>
              </div>
              {#if c.enrolled}
                <div class="progress-line">
                  <div class="row spread mono-tag small">
                    <span>Progress</span>
                    <span>{pct}%</span>
                  </div>
                  <div class="bar"><i style="width:{pct}%"></i></div>
                </div>
              {:else}
                <div class="progress-line empty" aria-hidden="true"></div>
              {/if}
            </div>

            <div class="pcard-foot">
              <span class="creator-meta mono-tag">
                by {c.creator?.name || 'Vokab'}
              </span>
              {#if c.enrolled}
                <a class="btn btn-gate-pill small" href="#/learn/course/{c.id}">Continue →</a>
              {:else}
                <button class="btn btn-gate-pill small" onclick={() => handleEnroll(c)}>Start →</button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>
