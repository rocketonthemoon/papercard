<script>
  import { courseFlag as flag, initial } from '../lib/format.js';
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';
  import PeopleList from '../lib/components/PeopleList.svelte';

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

  let showFollowers = $state(false);

  async function closeFollowers(changed) {
    showFollowers = false;
    if (!changed || !creator) return;
    try {
      const res = await api(`/users/${encodeURIComponent(creator.username)}`);
      data = { ...data, creator: { ...creator, ...res.user } };
    } catch {
      /* keep the old counts */
    }
  }

  async function toggleFollow() {
    if (!creator) return;
    try {
      // The server replies with the updated profile card (youFollow, followers).
      const fresh = await api(`/users/${encodeURIComponent(creator.username)}/follow`, {
        method: creator.youFollow ? 'DELETE' : 'POST',
        body: {},
      });
      data = { ...data, creator: { ...creator, ...fresh } };
    } catch (e) {
      appState.showToast(e.message || 'Action failed');
    }
  }
  let canEdit = $derived(data?.canEdit || false);

  async function handleEnroll() {
    try {
      await api(`/courses/${c.id}/enroll`, { method: 'POST', body: {} });
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

</script>

<div>
  {#if loading}
    <p class="page-loading" role="status">Loading course…</p>
  {:else if errorMsg || !c}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Course not found</h2>
        <p class="muted">{errorMsg || 'Could not find the requested course.'}</p>
      </header>
      <div class="row picker-actions">
        <a class="btn btn-gate-pill" href="#/discover">Back to Courses</a>
      </div>
    </section>
  {:else}
    <div class="toolbar course-breadcrumb-bar">
      <div class="breadcrumb-trail">
        <a class="back" href="#/discover">← Courses</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-current">{c.title}</span>
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
          <div class="course-leave-row">
            <button class="link-disclaimer-underline" onclick={handleLeave}>Leave course</button>
          </div>
        {/if}
      </div>

      <aside class="card side-card">
        {#if creator}
          <h3>Made by</h3>
          <div class="profile-mini">
            <a class="profile-mini-head link-plain" href="#/u/{creator.username}">
              <span class="avatar" aria-hidden="true">
                {#if creator.picture}<img src={creator.picture} alt="" referrerpolicy="no-referrer" />{:else}{initial(creator)}{/if}
              </span>
              <span class="profile-mini-info">
                <span class="profile-mini-name">
                  {creator.name || creator.username}
                  {#if creator.official}<span class="pill yellow sm official-tag">Official</span>{/if}
                </span>
                <span class="profile-mini-handle">@{creator.username}</span>
              </span>
            </a>
            {#if creator.bio}
              <p class="profile-mini-bio">{creator.bio}</p>
            {/if}
            <div class="profile-mini-foot">
              <button type="button" class="profile-mini-followers count-btn" onclick={() => (showFollowers = true)}>
                <b>{creator.followers ?? 0}</b> {(creator.followers ?? 0) === 1 ? 'follower' : 'followers'}
              </button>
              {#if !creator.isYou}
                <button type="button" data-follow aria-pressed={!!creator.youFollow} onclick={toggleFollow}>
                  {creator.youFollow ? 'Following' : 'Follow'}
                </button>
              {/if}
            </div>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

{#if showFollowers && creator}
  <PeopleList username={creator.username} tab="followers" onclose={closeFollowers} />
{/if}

<style>

  .course-leave-row {
    margin-top: 16px;
  }

  .profile-mini {
    margin-top: 12px;
  }

  .official-tag {
    margin-left: 6px;
    vertical-align: 2px;
  }
</style>
