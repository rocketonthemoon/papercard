<script>
  import { courseFlag as flag, plural } from '../lib/format.js';
  import { onMount, tick } from 'svelte';
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

  async function openNewCourse() {
    showNewCourse = true;
    await tick();
    document.getElementById('c-title')?.focus();
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
        appState.showToast('Course created. Add your first deck!');
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

  async function handleImportDb(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await fetch('/api/courses/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.sqlite3',
          'X-Requested-With': 'labas'
        },
        body: file,
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      appState.showToast('Course imported');
      appState.navigate(`#/studio/${data.id}`);
    } catch (x) {
      appState.showToast(x.message || 'Import failed');
    }
  }
</script>

<div>
  <div class="toolbar studio-toolbar">
    <div class="page-head">
      <p class="muted studio-desc">Build your own course: decks, lessons and words.</p>
    </div>
    <div class="toolbar-actions">
      <label class="btn btn-gate-pill small import-btn" title="Upload a course file exported from Papercard">
        <Icon name="upload" size={16} /> Import .db
        <input type="file" id="import" accept=".db,.sqlite,application/vnd.sqlite3" hidden onchange={handleImportDb}>
      </label>
      {#if loading || courses.length > 0}
        <button class="btn btn-gate-pill small" id="new-course" onclick={openNewCourse}>
          <Icon name="plus" size={16} /> New course →
        </button>
      {/if}
    </div>
  </div>

  {#if showNewCourse}
    <form class="card form new-course" id="nc" onsubmit={handleCreateCourse}>
      <h2>New course</h2>
      <div class="form-two">
        <label class="field">Title
          <input type="text" id="c-title" maxlength="80" placeholder="Spanish for travellers" bind:value={newTitle} required />
        </label>
        <label class="field">Teaches
          <input type="text" id="c-to" maxlength="30" placeholder="Spanish" bind:value={newToLang} required />
        </label>
      </div>
      <div class="form-two">
        <label class="field">For speakers of
          <input type="text" id="c-from" maxlength="30" bind:value={newFromLang} />
        </label>
        <label class="field">Language code <span class="muted small">(e.g. es, lt)</span>
          <input type="text" id="c-code" maxlength="8" placeholder="es" bind:value={newCode} />
        </label>
      </div>
      <label class="field">Special letters <span class="muted small">(e.g. á é í ó ú ñ)</span>
        <input type="text" id="c-letters" maxlength="80" placeholder="á é í ó ú ñ" bind:value={newLetters} />
      </label>
      <label class="field">Description
        <textarea id="c-desc" maxlength="300" placeholder="Who it's for and what they'll learn" bind:value={newDesc}></textarea>
      </label>

      {#if formErr}
        <p class="form-error" id="nc-err" role="alert">{formErr}</p>
      {/if}

      <div class="row modal-actions">
        <button type="button" class="btn outline" id="nc-cancel" onclick={() => showNewCourse = false}>Cancel</button>
        <button class="btn btn-gate-pill" disabled={creating}>{creating ? 'Creating...' : 'Create course'}</button>
      </div>
    </form>
  {/if}

  {#if loading}
    <p class="page-loading" role="status">Loading your courses…</p>
  {:else if errorMsg}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Something went wrong</h2>
        <p class="muted">{errorMsg}</p>
      </header>
    </section>
  {:else}
    <div class="studio-main-grid">
      {#if courses.length === 0}
        <section class="card picker empty-state-card">
          <header class="picker-head">
            <span class="board-icon empty-state-icon">
              <Icon name="decks" size={48} />
            </span>
            <h2>No custom courses yet</h2>
            <p class="muted">Create one from scratch, or import a course file someone shared with you.</p>
          </header>
          <div class="row picker-actions">
            <button class="btn btn-gate-pill" id="studio-empty-new" onclick={openNewCourse}>New course →</button>
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
                    {c.toLang} · {plural(c.units, 'deck')} · {plural(c.words || 0, 'word')} · {plural(c.learners || 0, 'learner')}
                  </p>
                </div>
              </a>
              <div class="course-foot">
                {#if c.hidden}
                  <span class="pill due">hidden</span>
                {:else}
                  <a class="small mono-tag" href="#/course/{c.id}">View as a learner</a>
                {/if}
                <a class="btn btn-gate-pill small" href="#/studio/{c.id}">
                  <Icon name="edit" size={14} /> Edit →
                </a>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>

    {#if official.length > 0}
      <div class="studio-section">
        <div class="row spread section-row">
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
                    {c.toLang} · {plural(c.units, 'deck')} · {plural(c.words || 0, 'word')}
                  </p>
                </div>
              </a>
              <div class="course-foot">
                <span class="creator-meta mono-tag">OFFICIAL</span>
                <a class="btn btn-gate-pill small" href="#/studio/{c.id}">
                  <Icon name="edit" size={14} /> Edit →
                </a>
              </div>
            </article>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
