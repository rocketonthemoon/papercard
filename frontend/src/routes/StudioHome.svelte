<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let courses = $state([]);
  let official = $state([]);
  let showNewCourse = $state(false);

  // Form state
  let newTitle = $state('');
  let newFromLang = $state('English');
  let newToLang = $state('');
  let newCode = $state('');
  let newLetters = $state('');
  let newDesc = $state('');
  let creating = $state(false);
  let formErr = $state('');

  function flag(c) {
    if (c.toCode) return c.toCode.toUpperCase();
    if (c.toLang && c.toLang.toLowerCase().includes('lithuanian')) return 'LT';
    return (c.toLang || 'LT').slice(0, 2).toUpperCase();
  }

  onMount(async () => {
    await loadCourses();
  });

  async function loadCourses() {
    try {
      loading = true;
      const res = await api('/courses?tab=mine');
      courses = res.courses || [];
      if (appState.user?.isAdmin) {
        const pop = await api('/courses?tab=popular').catch(() => ({ courses: [] }));
        official = (pop.courses || []).filter(c => c.creator?.official && !c.mine);
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load courses';
    } finally {
      loading = false;
    }
  }

  async function handleCreateCourse(e) {
    e.preventDefault();
    if (!newTitle.trim() || !newToLang.trim()) {
      formErr = 'Please enter a course title and language';
      return;
    }

    try {
      creating = true;
      formErr = '';
      const res = await api('/courses', {
        method: 'POST',
        body: {
          title: newTitle.trim(),
          fromLang: newFromLang.trim() || 'English',
          toLang: newToLang.trim(),
          toCode: newCode.trim(),
          letters: newLetters.trim(),
          description: newDesc.trim(),
        },
      });

      if (res.course?.id) {
        appState.navigate(`#/studio/${res.course.id}`);
      } else {
        await loadCourses();
        showNewCourse = false;
      }
    } catch (e) {
      formErr = e.message || 'Failed to create course';
    } finally {
      creating = false;
    }
  }
</script>

<div>
  <div class="toolbar studio-toolbar">
    <div class="page-head">
      <p class="muted studio-desc">Build your own course: decks, lessons and words.</p>
    </div>
    <div class="toolbar-actions">
      <button class="btn btn-gate-pill small" id="new-course" onclick={() => showNewCourse = !showNewCourse}>
        <Icon name="plus" size={16} /> New course →
      </button>
    </div>
  </div>

  {#if showNewCourse}
    <form class="card form new-course" onsubmit={handleCreateCourse} style="margin-bottom:24px;">
      <h2>New course</h2>
      <div class="form-two" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px;">
        <label class="field">Title
          <input type="text" id="c-title" maxlength="80" placeholder="Spanish for travellers" bind:value={newTitle} required />
        </label>
        <label class="field">Teaches
          <input type="text" id="c-to" maxlength="30" placeholder="Spanish" bind:value={newToLang} required />
        </label>
      </div>
      <div class="form-two" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px;">
        <label class="field">For speakers of
          <input type="text" id="c-from" maxlength="30" bind:value={newFromLang} />
        </label>
        <label class="field">Language code <span class="muted small">(e.g. es, lt)</span>
          <input type="text" id="c-code" maxlength="8" placeholder="es" bind:value={newCode} />
        </label>
      </div>
      <label class="field" style="margin-bottom:12px;">Special letters <span class="muted small">(e.g. á é í ó ú ñ)</span>
        <input type="text" id="c-letters" maxlength="80" placeholder="á é í ó ú ñ" bind:value={newLetters} />
      </label>
      <label class="field" style="margin-bottom:16px;">Description
        <textarea id="c-desc" maxlength="300" placeholder="Who it's for and what they'll learn" bind:value={newDesc}></textarea>
      </label>

      {#if formErr}
        <p class="error">{formErr}</p>
      {/if}

      <div class="row" style="justify-content:flex-end;gap:12px;">
        <button type="button" class="btn outline" onclick={() => showNewCourse = false}>Cancel</button>
        <button class="btn btn-gate-pill" disabled={creating}>{creating ? 'Creating...' : 'Create course'}</button>
      </div>
    </form>
  {/if}

  {#if loading}
    <p class="muted loading" style="text-align:center;padding:40px 0;">Loading your courses…</p>
  {:else if errorMsg}
    <section class="card picker" style="max-width:540px;margin:20px auto;">
      <header class="picker-head">
        <h2>Something went wrong</h2>
        <p class="muted">{errorMsg}</p>
      </header>
    </section>
  {:else}
    <div class="studio-main-grid">
      {#if courses.length === 0}
        <section class="card picker" style="max-width:540px;margin:20px auto;">
          <header class="picker-head">
            <span class="board-icon"><Icon name="cards" size={40} /></span>
            <h2>No custom courses yet</h2>
            <p class="muted">Create one from scratch to start writing decks and lessons.</p>
          </header>
          <div class="row" style="justify-content:center;margin-top:16px;">
            <button class="btn btn-gate-pill" onclick={() => showNewCourse = true}>New course →</button>
          </div>
        </section>
      {:else}
        <div class="studio-course-grid">
          {#each courses as c (c.id)}
            <article class="card studio-course-card">
              <a class="course-main" href="#/studio/{c.id}">
                <span class="course-flag mono-tag">{flag(c)}</span>
                <div class="course-main-info">
                  <h3>{c.title}</h3>
                  <p class="muted small mono-tag-desc">
                    {c.toLang} · {c.units || 1} decks · {c.words || 0} words · {c.learners || 0} learners
                  </p>
                </div>
              </a>
              <div class="course-foot">
                {#if c.hidden}
                  <span class="pill due">hidden</span>
                {:else}
                  <a class="small mono-tag" href="#/course/{c.id}">View as learner</a>
                {/if}
                <a class="btn btn-gate-pill small" href="#/studio/{c.id}">Edit →</a>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>

    {#if official.length > 0}
      <div class="studio-section" style="margin-top:40px;">
        <div class="row spread section-row" style="margin-bottom:16px;">
          <h2>Official courses</h2>
          <span class="muted small mono-tag">ADMIN EDIT PRIVILEGES</span>
        </div>
        <div class="studio-course-grid">
          {#each official as c (c.id)}
            <article class="card studio-course-card">
              <a class="course-main" href="#/studio/{c.id}">
                <span class="course-flag mono-tag">{flag(c)}</span>
                <div class="course-main-info">
                  <h3>{c.title}</h3>
                  <p class="muted small mono-tag-desc">
                    {c.toLang} · {c.units || 1} decks · {c.words || 0} words
                  </p>
                </div>
              </a>
              <div class="course-foot">
                <span class="creator-meta mono-tag">OFFICIAL</span>
                <a class="btn btn-gate-pill small" href="#/studio/{c.id}">Edit →</a>
              </div>
            </article>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
