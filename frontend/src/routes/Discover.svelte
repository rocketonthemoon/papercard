<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';
  import { courseFlag as flag, tintClass as tint, percent } from '../lib/format.js';

  let loading = $state(true);
  let errorMsg = $state('');
  let courses = $state([]);
  let people = $state([]);
  let searchQuery = $state('');
  let officialOnly = $state(false);
  let activeTab = $state('all'); // 'all', 'courses', 'people'
  let searchTimer = null;


  async function loadData(query = '') {
    try {
      loading = true;
      errorMsg = '';
      const cleanQ = query.trim();
      const endpoint = cleanQ 
        ? `/courses?tab=popular&q=${encodeURIComponent(cleanQ)}`
        : '/courses?tab=popular';
      const res = await api(endpoint);
      courses = res.courses || [];
      people = res.people || [];
    } catch (e) {
      errorMsg = e.message || 'Failed to load discover catalog';
    } finally {
      loading = false;
    }
  }

  function handleSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadData(searchQuery);
    }, 250);
  }

  function clearSearch() {
    searchQuery = '';
    loadData('');
  }

  onMount(() => {
    loadData('');
  });

  let filteredCourses = $derived(officialOnly ? courses.filter((c) => c.creator?.official) : courses);

  async function handleEnroll(c) {
    try {
      await api(`/courses/${c.id}/enroll`, { method: 'POST', body: {} });
      appState.showToast(`Enrolled in ${c.title}!`);
      appState.navigate(`#/learn/course/${c.id}`);
    } catch (e) {
      appState.showToast(e.message || 'Failed to enroll');
    }
  }

  async function toggleFollow(person) {
    try {
      const isFollowing = person.is_following;
      const method = isFollowing ? 'DELETE' : 'POST';
      await api(`/users/${encodeURIComponent(person.username)}/follow`, { method, body: {} });
      person.is_following = !isFollowing;
      person.followers = (person.followers || 0) + (isFollowing ? -1 : 1);
      people = [...people];
      appState.showToast(isFollowing ? `Unfollowed @${person.username}` : `Following @${person.username}`);
    } catch (e) {
      appState.showToast(e.message || 'Failed to update follow');
    }
  }
</script>

<div class="discover">
  <div class="discover-main">
    <section class="discover-hero">
      <form class="discover-search" id="d-form" role="search" onsubmit={(e) => { e.preventDefault(); loadData(searchQuery); }}>
        <div class="search-input-wrap">
          <input
            type="search"
            id="d-q"
            placeholder="Search courses, people or words…"
            aria-label="Search discover catalog"
            autocomplete="off"
            spellcheck="false"
            bind:value={searchQuery}
            oninput={handleSearchInput}
          />
          {#if searchQuery}
            <button type="button" class="search-clear-btn" aria-label="Clear search" onclick={clearSearch}>
              <Icon name="close" size={16} />
            </button>
          {/if}
        </div>
        <button class="btn btn-gate-pill search-btn" type="submit">Search →</button>
      </form>

      <div class="discover-filters" role="group" aria-label="Filter results">
        <button type="button" class="tab-pill" class:active={activeTab === 'all'} aria-pressed={activeTab === 'all'} onclick={() => (activeTab = 'all')}>
          All{people.length > 0 ? ` (${filteredCourses.length + people.length})` : ''}
        </button>
        <button type="button" class="tab-pill" class:active={activeTab === 'courses'} aria-pressed={activeTab === 'courses'} onclick={() => (activeTab = 'courses')}>
          Courses ({filteredCourses.length})
        </button>
        {#if people.length > 0}
          <button type="button" class="tab-pill" class:active={activeTab === 'people'} aria-pressed={activeTab === 'people'} onclick={() => (activeTab = 'people')}>
            People ({people.length})
          </button>
        {/if}
        {#if activeTab !== 'people'}
          <button type="button" class="tab-pill toggle-pill" class:active={officialOnly} aria-pressed={officialOnly} onclick={() => (officialOnly = !officialOnly)}>
            {#if officialOnly}<Icon name="check" size={12} />{/if}
            Official only
          </button>
        {/if}
      </div>
    </section>

    {#if loading}
      <p class="page-loading" role="status">Searching catalog…</p>
    {:else if errorMsg}
      <section class="card picker page-error">
        <header class="picker-head">
          <h2>Unable to load catalog</h2>
          <p class="muted">{errorMsg}</p>
        </header>
      </section>
    {:else if filteredCourses.length === 0 && (activeTab === 'courses' || people.length === 0)}
      <section class="card picker page-error">
        <header class="picker-head">
          <h2>No matching results</h2>
          <p class="muted">Try adjusting your search terms or create your own course in the Studio.</p>
        </header>
        <div class="row picker-actions">
          <a href="#/studio" class="btn btn-gate-pill">Create a course →</a>
        </div>
      </section>
    {:else}
      <!-- People / Profiles Section when available -->
      {#if people.length > 0 && (activeTab === 'all' || activeTab === 'people')}
        <div class="discover-section-block">
          <div class="section-heading-row">
            <h2 class="discover-sec-title">People & Creators</h2>
            <span class="muted small mono-tag">{people.length} found</span>
          </div>
          <div class="people-grid">
            {#each people as p (p.username || p.id)}
              <div class="card person-card">
                <a href="#/u/{p.username}" class="person-card-link">
                  <div class="person-avatar">
                    {#if p.picture}
                      <img src={p.picture} alt="" class="avatar-img" />
                    {:else}
                      <span class="avatar-txt">{(p.name || p.username || '?').charAt(0).toUpperCase()}</span>
                    {/if}
                  </div>
                  <div class="person-details">
                    <div class="row person-meta">
                      <span class="person-name">{p.name || p.username}</span>
                      {#if p.is_official}
                        <span class="tag-chip mono-tag official-tag">OFFICIAL</span>
                      {/if}
                    </div>
                    <span class="person-handle mono-tag">@{p.username}</span>
                    {#if p.bio}
                      <p class="person-bio">{p.bio}</p>
                    {/if}
                    <div class="person-stats mono-tag small">
                      <span>{p.followers || 0} followers</span> · 
                      <span>{p.courses_count || p.courses || 0} courses</span>
                    </div>
                  </div>
                </a>
                <div class="person-actions">
                  <button
                    type="button"
                    class="btn btn-gate-pill small {p.is_following ? 'outline' : ''}"
                    onclick={() => toggleFollow(p)}
                  >
                    {p.is_following ? 'Following' : 'Follow'}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Courses Grid -->
      {#if filteredCourses.length > 0 && (activeTab === 'all' || activeTab === 'courses')}
        <div class="discover-section-block">
          {#if people.length > 0 && activeTab === 'all'}
            <div class="section-heading-row">
              <h2 class="discover-sec-title">Courses</h2>
              <span class="muted small mono-tag">{filteredCourses.length} available</span>
            </div>
          {/if}
          <div class="course-grid discover-grid" id="d-grid">
            {#each filteredCourses as c (c.id)}
              {@const tag = c.creator?.official ? 'OFFICIAL' : c.enrolled ? 'ENROLLED' : 'COMMUNITY'}
              {@const pct = percent(c.learned, c.words)}
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
                      <div class="bar"><i style:width="{pct}%"></i></div>
                    </div>
                  {:else}
                    <div class="progress-line empty" aria-hidden="true"></div>
                  {/if}
                </div>

                <div class="pcard-foot">
                  <a href="#/u/{c.creator?.username || c.creator?.name}" class="creator-meta mono-tag">
                    by {c.creator?.name || 'Vokab'}
                  </a>
                  {#if c.enrolled}
                    <a class="btn btn-gate-pill small" href="#/learn/course/{c.id}">Continue →</a>
                  {:else}
                    <button class="btn btn-gate-pill small" onclick={() => handleEnroll(c)}>Start →</button>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .person-meta {
    gap: 6px;
    align-items: center;
  }

  .tab-pill {
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 700;
    font-family: var(--font-degularvariable), sans-serif;
    border: 2px solid var(--color-ink-black);
    border-radius: var(--radius-buttons, 100px);
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .discover-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }

  .toggle-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  @media (max-width: 600px) {
    .toggle-pill {
      margin-left: 0;
    }

    .discover-search :global(.search-btn) {
      display: none !important;
    }

    .discover-search :global(.search-input-wrap) {
      flex: 1 1 100% !important;
    }
  }

  .tab-pill:focus-visible {
    outline: 2px solid var(--color-ink-black);
    outline-offset: 2px;
  }

  .tab-pill.active {
    background: var(--color-hi-vis-yellow) !important;
    box-shadow: 1px 1px 0 var(--color-ink-black);
  }

  .discover-section-block {
    margin-bottom: 28px;
  }

  .section-heading-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 16px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.15);
  }

  .discover-sec-title {
    font-family: var(--font-degulardisplay-bold), sans-serif;
    font-size: 20px;
    font-weight: 800;
    color: var(--color-ink-black);
    margin: 0;
  }

  .people-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }

  .person-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 16px;
    background: var(--color-bone-white);
    border: 2px solid var(--color-ink-black);
    border-radius: var(--radius-cards, 6px);
    box-shadow: 2px 2px 0 var(--color-ink-black);
    gap: 12px;
  }

  .person-card-link {
    display: flex;
    gap: 12px;
    text-decoration: none;
    color: inherit;
  }

  .person-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid var(--color-ink-black);
    background: var(--color-hi-vis-yellow);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .person-avatar .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .person-avatar .avatar-txt {
    font-weight: 900;
    font-size: 20px;
    font-family: var(--font-display, sans-serif);
    color: var(--color-ink-black);
  }

  .person-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .person-name {
    font-weight: 800;
    font-size: 15px;
    font-family: var(--font-degulardisplay-bold), sans-serif;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .person-handle {
    font-size: 12px;
    color: rgba(26, 26, 26, 0.65);
  }

  .person-bio {
    font-size: 13px;
    line-height: 1.35;
    margin: 4px 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .person-stats {
    font-size: 11px;
    color: rgba(26, 26, 26, 0.7);
    margin-top: 2px;
  }

  .person-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px dashed rgba(26, 26, 26, 0.15);
  }

  .official-tag {
    background: #ffd33d;
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 100px;
    border: 1px solid #000;
  }
</style>
