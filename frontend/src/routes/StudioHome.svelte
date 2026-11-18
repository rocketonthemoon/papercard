<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let courses = $state([]);
  let showCreateModal = $state(false);

  // Form state
  let newTitle = $state('');
  let newFromLang = $state('English');
  let newToLang = $state('Lithuanian');
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
    } catch (e) {
      errorMsg = e.message || 'Failed to load courses';
    } finally {
      loading = false;
    }
  }

  async function handleCreateCourse(e) {
    e.preventDefault();
    if (!newTitle.trim()) {
      formErr = 'Please enter a course title';
      return;
    }

    try {
      creating = true;
      formErr = '';
      const res = await api('/courses', {
        method: 'POST',
        body: {
          title: newTitle.trim(),
          fromLang: newFromLang.trim(),
          toLang: newToLang.trim(),
          description: newDesc.trim(),
        },
      });

      if (res.course?.id) {
        appState.navigate(`#/studio/${res.course.id}`);
      } else {
        await loadCourses();
        showCreateModal = false;
      }
    } catch (e) {
      formErr = e.message || 'Failed to create course';
    } finally {
      creating = false;
    }
  }
</script>

<div class="studio-view">
  <div class="studio-top">
    <div>
      <h1 class="studio-title">Course Studio</h1>
      <p class="muted">Author and edit courses: decks, lessons, and vocabulary words.</p>
    </div>

    <button
      class="btn primary sm"
      onclick={() => showCreateModal = true}
    >
      <Icon name="plus" size={16} />
      <span>New course →</span>
    </button>
  </div>

  {#if showCreateModal}
    <form onsubmit={handleCreateCourse} class="card create-form">
      <h2>Create New Course</h2>

      <div class="field">
        <label for="c-title" class="mono-tag small">Course title</label>
        <input
          id="c-title"
          type="text"
          class="input-box"
          placeholder="e.g. Lithuanian for Beginners"
          bind:value={newTitle}
          required
        />
      </div>

      <div class="field-row">
        <div class="field">
          <label for="c-from" class="mono-tag small">From language</label>
          <input
            id="c-from"
            type="text"
            class="input-box"
            bind:value={newFromLang}
          />
        </div>
        <div class="field">
          <label for="c-to" class="mono-tag small">Target language</label>
          <input
            id="c-to"
            type="text"
            class="input-box"
            bind:value={newToLang}
          />
        </div>
      </div>

      <div class="field">
        <label for="c-desc" class="mono-tag small">Description (optional)</label>
        <textarea
          id="c-desc"
          class="input-box"
          rows="2"
          placeholder="What will learners achieve in this course?"
          bind:value={newDesc}
        ></textarea>
      </div>

      {#if formErr}
        <p class="error-msg">{formErr}</p>
      {/if}

      <div class="modal-actions">
        <button
          type="button"
          class="btn outline sm"
          onclick={() => showCreateModal = false}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn primary sm"
          disabled={creating}
        >
          {creating ? 'Creating...' : 'Create course'}
        </button>
      </div>
    </form>
  {/if}

  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading your courses…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Something went wrong</h2>
      <p class="muted">{errorMsg}</p>
    </div>
  {:else if courses.length === 0 && !showCreateModal}
    <section class="card empty-state">
      <div class="empty-icon"><Icon name="studio" size={48} /></div>
      <h2>No custom courses yet</h2>
      <p class="muted">Create your first course to build lessons and share your language knowledge with others.</p>
      <button class="btn primary" onclick={() => showCreateModal = true}>
        <Icon name="plus" size={16} />
        <span>Create a course</span>
      </button>
    </section>
  {:else}
    <div class="courses-grid">
      {#each courses as c}
        <article class="card course-card">
          <div class="course-top">
            <span class="pill yellow">{c.fromLang} → {c.toLang}</span>
            <span class="mono-tag muted small">{c.units || 0} decks · {c.words || 0} words</span>
          </div>

          <h3 class="course-name">
            <a href="#/studio/{c.id}">{c.title}</a>
          </h3>

          <p class="course-desc muted small">{c.description || 'Custom course'}</p>

          <div class="course-actions">
            <a href="#/studio/{c.id}" class="btn primary sm">
              <Icon name="edit" size={14} />
              <span>Edit course →</span>
            </a>
            <a href="#/course/{c.id}" class="btn outline sm">View preview</a>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .studio-view {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .studio-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .studio-title {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 900;
    color: var(--color-bone-white);
  }

  .studio-top .muted {
    color: var(--color-bone-white);
  }

  .create-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 24px;
  }

  .create-form h2 {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-box {
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 10px 14px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    background: var(--color-bone-white);
    box-shadow: 0 2px 0 var(--color-ink-black);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }

  .error-msg {
    color: var(--color-firecracker-red);
    font-size: 13px;
    font-weight: 700;
  }

  .courses-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
  }

  .course-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 220px;
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    padding: 22px;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }

  .course-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 6px 0 rgba(26, 26, 26, 0.3);
  }

  .course-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .course-name {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 800;
    margin-bottom: 6px;
  }

  .course-desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 14px;
  }

  .course-actions {
    display: flex;
    gap: 8px;
  }

  .loading-box, .error-box, .empty-state {
    text-align: center;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
</style>
