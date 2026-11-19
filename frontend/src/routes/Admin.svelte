<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);

  const plural = (n, word, pluralWord) => `${n} ${n === 1 ? word : (pluralWord || word + 's')}`;
  const fmtDate = (ms) => new Date(ms || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function flag(c) {
    if (c.toCode) return c.toCode.toUpperCase();
    if (c.toLang && c.toLang.toLowerCase().includes('lithuanian')) return 'LT';
    return (c.toLang || 'LT').slice(0, 2).toUpperCase();
  }

  onMount(async () => {
    await loadAdminData();
  });

  async function loadAdminData() {
    if (!appState.user?.isAdmin) {
      loading = false;
      return;
    }
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
      await api(`/admin/courses/${c.id}`, {
        method: 'PUT',
        body: { hidden: !c.hidden }
      });
      c.hidden = !c.hidden;
      data = { ...data };
      appState.showToast(`Course is now ${c.hidden ? 'hidden' : 'live'}`);
    } catch (e) {
      appState.showToast(e.message || 'Action failed');
    }
  }

  async function makeOfficial(c) {
    if (!confirm(`Move “${c.title}” to the official account? Its creator will no longer be able to edit it.`)) return;
    try {
      const updated = await api(`/admin/courses/${c.id}`, {
        method: 'PUT',
        body: { official: true }
      });
      data = { ...data, courses: courses.map((x) => (x.id === c.id ? { ...x, ...(updated.course || updated) } : x)) };
      appState.showToast('Course moved to the official account');
    } catch (e) {
      appState.showToast(e.message || 'Action failed');
    }
  }
</script>

{#if !appState.user?.isAdmin}
  <section class="card picker">
    <header class="picker-head">
      <h2>Admins only</h2>
      <p class="muted">Ask the site owner to add your email to ADMINS.</p>
    </header>
  </section>
{:else if loading}
  <p class="muted loading">Loading courses…</p>
{:else if errorMsg}
  <section class="card picker">
    <header class="picker-head">
      <h2>Something went wrong</h2>
      <p class="muted">{errorMsg}</p>
    </header>
  </section>
{:else if data}
  <div class="toolbar admin-toolbar">
    <div class="page-head">
      <h1 class="admin-title">ADMIN CONSOLE</h1>
      <p class="muted admin-desc">Platform-wide overview and course moderation. Hidden courses remain accessible only to creators.</p>
    </div>
    <div class="admin-stats-pills">
      <div class="admin-stat-pill"><span class="stat-pill-num">{courses.length}</span> <span class="stat-pill-lbl">COURSES</span></div>
      <div class="admin-stat-pill"><span class="stat-pill-num">{data.players ?? 0}</span> <span class="stat-pill-lbl">LEARNERS</span></div>
      <div class="admin-stat-pill"><span class="stat-pill-num">{data.xpToday ?? 0}</span> <span class="stat-pill-lbl">XP TODAY</span></div>
    </div>
  </div>

  <section class="card admin-list-card">
    <div class="admin-list-head">
      <span class="mono-tag">REGISTERED COURSES ({courses.length})</span>
      <span class="muted small mono-tag">Moderation &amp; Discovery Controls</span>
    </div>
    <ul class="admin-rows">
      {#each courses as c (c.id)}
        <li class="admin-course-row {c.hidden ? 'is-hidden' : ''}">
          <div class="admin-course-left">
            <span class="course-flag">{flag(c)}</span>
            <div class="admin-course-info">
              <div class="admin-course-title-line">
                <a class="admin-course-title" href="#/course/{c.id}">{c.title}</a>
                {#if c.hidden}
                  <span class="admin-badge badge-hidden">HIDDEN</span>
                {:else}
                  <span class="admin-badge badge-live">LIVE</span>
                {/if}
                {#if c.creator?.official}
                  <span class="admin-badge badge-official">OFFICIAL</span>
                {/if}
              </div>
              <div class="admin-course-meta">
                <span>by <b>{#if c.creator?.username}<a href="#/u/{c.creator.username}">{c.creator.name}</a>{:else}{c.creator?.name || 'Creator'}{/if}</b></span>
                <span class="meta-dot">·</span>
                <span>{c.toLang}</span>
                <span class="meta-dot">·</span>
                <span>{plural(c.words || 0, 'word')}</span>
                <span class="meta-dot">·</span>
                <span>{plural(c.learners || 0, 'learner')}</span>
                <span class="meta-dot">·</span>
                <span>updated {fmtDate(c.updatedAt)}</span>
              </div>
            </div>
          </div>
          <div class="admin-course-actions">
            {#if c.creator?.official}
              <a class="btn btn-gate-pill small" href="#/studio/{c.id}">
                <Icon name="edit" size={14} /> Edit →
              </a>
            {:else}
              <a class="btn btn-gate-pill small" href="#/course/{c.id}">View →</a>
              <button class="btn btn-outlined-display small" onclick={() => makeOfficial(c)}>Make official</button>
            {/if}
            <button
              class="btn btn-outlined-display small {c.hidden ? 'btn-unhide' : 'btn-hide'}"
              onclick={() => toggleCourseHidden(c)}
            >
              {c.hidden ? 'Unhide' : 'Hide'}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}
