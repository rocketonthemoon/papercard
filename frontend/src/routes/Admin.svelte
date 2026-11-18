<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);

  onMount(async () => {
    await loadAdminData();
  });

  async function loadAdminData() {
    try {
      loading = true;
      const res = await api('/admin/courses');
      data = res;
    } catch (e) {
      errorMsg = e.message || 'Admins only or failed to load';
    } finally {
      loading = false;
    }
  }

  let courses = $derived(data?.courses || []);

  async function toggleCourseHidden(c) {
    try {
      await api(`/admin/courses/${c.id}/visibility`, {
        method: 'POST',
        body: { hidden: !c.hidden }
      });
      c.hidden = !c.hidden;
      data = { ...data };
      appState.showToast(`Course is now ${c.hidden ? 'hidden' : 'live'}`);
    } catch (e) {
      appState.showToast(e.message || 'Action failed');
    }
  }

  async function handleDeleteCourse(c) {
    if (!confirm(`Permanently delete "${c.title}"?`)) return;
    try {
      await api(`/admin/courses/${c.id}`, { method: 'DELETE' });
      await loadAdminData();
      appState.showToast('Course deleted');
    } catch (e) {
      appState.showToast(e.message || 'Failed to delete');
    }
  }
</script>

<div class="admin-view">
  <header class="admin-head">
    <div>
      <h1 class="admin-title">Admin Console</h1>
      <p class="muted">Platform-wide overview and course moderation.</p>
    </div>

    {#if data}
      <div class="stat-pills">
        <span class="pill yellow"><b>{courses.length}</b> COURSES</span>
        <span class="pill matcha"><b>{data.players || 0}</b> LEARNERS</span>
        <span class="pill bone"><b>{data.xpToday || 0}</b> XP TODAY</span>
      </div>
    {/if}
  </header>

  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading administrative console…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Access Restricted</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/learn" class="btn primary">Back to Home</a>
    </div>
  {:else}
    <section class="card admin-table-card">
      <div class="table-header">
        <span class="mono-tag">REGISTERED COURSES ({courses.length})</span>
      </div>

      <ul class="admin-course-list">
        {#each courses as c}
          <li class="admin-course-item">
            <div class="course-main-info">
              <div class="title-line">
                <a href="#/course/{c.id}" class="course-link"><b>{c.title}</b></a>
                <span class="pill sm" class:pink={c.hidden} class:matcha={!c.hidden}>
                  {c.hidden ? 'HIDDEN' : 'LIVE'}
                </span>
                {#if c.creator?.official}
                  <span class="pill sm yellow">OFFICIAL</span>
                {/if}
              </div>

              <div class="meta-line mono-tag muted small">
                <span>By {c.creator?.name || 'Creator'}</span> ·
                <span>{c.fromLang} → {c.toLang}</span> ·
                <span>{c.words || 0} words</span> ·
                <span>{c.learners || 0} learners</span>
              </div>
            </div>

            <div class="admin-actions">
              <button
                class="btn outline sm"
                onclick={() => toggleCourseHidden(c)}
              >
                {c.hidden ? 'Publish (Make Live)' : 'Hide'}
              </button>
              <a href="#/studio/{c.id}" class="btn outline sm">
                <Icon name="edit" size={13} />
                <span>Edit</span>
              </a>
              <button
                class="btn outline sm trash-btn"
                onclick={() => handleDeleteCourse(c)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .admin-view {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .admin-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .admin-title {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 900;
    color: var(--color-bone-white);
  }

  .admin-head .muted {
    color: var(--color-bone-white);
  }

  .stat-pills {
    display: flex;
    gap: 8px;
  }

  .admin-table-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .table-header {
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.1);
    padding-bottom: 10px;
  }

  .admin-course-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;
  }

  .admin-course-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    gap: 16px;
  }

  @media (max-width: 680px) {
    .admin-course-item {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .course-main-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .course-link {
    font-size: 16px;
  }

  .admin-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .trash-btn:hover {
    background: var(--color-bubblegum-pink);
  }

  .loading-box, .error-box {
    text-align: center;
    padding: 48px 24px;
  }
</style>
