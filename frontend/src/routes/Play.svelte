<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let activeTab = $state('create'); // 'create' or 'join'
  let loading = $state(true);
  let errorMsg = $state('');

  let courses = $state([]);
  let selectedCourseId = $state(null);
  let units = $state([]);
  let pickedUnits = $state(new Set());
  let creating = $state(false);

  let joinCode = $state('');
  let myDuels = $state([]);

  onMount(async () => {
    try {
      loading = true;
      const [learnData, duelsData] = await Promise.all([
        api('/learn').catch(() => ({ myCourses: [] })),
        api('/duels').catch(() => ({ duels: [] })),
      ]);

      courses = learnData.myCourses || [];
      if (learnData.course) {
        selectedCourseId = learnData.course.id;
      } else if (courses.length > 0) {
        selectedCourseId = courses[0].id;
      }

      if (selectedCourseId) {
        await loadUnits(selectedCourseId);
      }

      myDuels = duelsData.duels || [];
    } catch (e) {
      errorMsg = e.message || 'Failed to load lobby';
    } finally {
      loading = false;
    }
  });

  async function loadUnits(courseId) {
    try {
      const res = await api(`/learn/course/${courseId}`);
      units = res.units || [];
      // Pick first 2 units by default if available
      pickedUnits.clear();
      units.slice(0, 2).forEach(u => pickedUnits.add(u.id));
      pickedUnits = new Set(pickedUnits);
    } catch {
      units = [];
    }
  }

  function toggleUnit(uId) {
    if (pickedUnits.has(uId)) {
      pickedUnits.delete(uId);
    } else {
      pickedUnits.add(uId);
    }
    pickedUnits = new Set(pickedUnits);
  }

  let totalWordsInPicked = $derived(
    units
      .filter(u => pickedUnits.has(u.id))
      .reduce((sum, u) => sum + (u.lessons || []).reduce((ls, l) => ls + (l.words || 0), 0), 0)
  );

  async function handleCreateRoom() {
    if (pickedUnits.size === 0) {
      appState.showToast('Pick at least one deck');
      return;
    }

    try {
      creating = true;
      const res = await api('/duels', {
        method: 'POST',
        body: {
          courseId: selectedCourseId,
          unitIds: Array.from(pickedUnits),
        },
      });

      if (res.code) {
        appState.navigate(`#/duel/${res.code}`);
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to create duel';
    } finally {
      creating = false;
    }
  }

  function handleJoinSubmit(e) {
    e.preventDefault();
    const clean = joinCode.trim().toUpperCase();
    if (clean.length === 6) {
      appState.navigate(`#/duel/${clean}`);
    } else {
      appState.showToast('Please enter a 6-letter room code');
    }
  }
</script>

<div class="lobby-grid">
  <!-- Main Picker Card -->
  <section class="card picker-card">
    <header class="picker-head">
      <h2>Word Duels</h2>
      <p class="muted">Challenge a friend to a fast-paced vocabulary match, or enter a room code.</p>
    </header>

    <div class="mode-tabs">
      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === 'create'}
        onclick={() => activeTab = 'create'}
      >
        <Icon name="cards" size={18} />
        <span>Create a room</span>
      </button>

      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === 'join'}
        onclick={() => activeTab = 'join'}
      >
        <Icon name="play" size={18} />
        <span>Join a room</span>
      </button>
    </div>

    {#if activeTab === 'create'}
      <div class="tab-pane">
        {#if courses.length > 1}
          <div class="field">
            <label for="duel-course-sel" class="mono-tag small">Course</label>
            <select
              id="duel-course-sel"
              class="select-input"
              bind:value={selectedCourseId}
              onchange={() => loadUnits(selectedCourseId)}
            >
              {#each courses as c}
                <option value={c.id}>{c.title}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div class="deck-header">
          <h3>Which decks?</h3>
          <span class="mono-tag muted small">
            {pickedUnits.size ? `${pickedUnits.size} deck${pickedUnits.size > 1 ? 's' : ''} · ${totalWordsInPicked} words` : 'Pick at least one'}
          </span>
        </div>

        <div class="deck-list">
          {#if units.length === 0}
            <p class="muted small">Loading decks...</p>
          {:else}
            {#each units as u}
              {@const wordsCount = (u.lessons || []).reduce((s, l) => s + (l.words || 0), 0)}
              <label class="deck-item" class:selected={pickedUnits.has(u.id)}>
                <input
                  type="checkbox"
                  checked={pickedUnits.has(u.id)}
                  onchange={() => toggleUnit(u.id)}
                />
                <div class="deck-info">
                  <b class="deck-title">{u.title}</b>
                  <span class="muted small mono-tag">{wordsCount} words</span>
                </div>
              </label>
            {/each}
          {/if}
        </div>

        {#if errorMsg}
          <p class="error-text">{errorMsg}</p>
        {/if}

        <div class="create-actions">
          <span class="mono-tag muted small">10 RANDOM WORDS · YOU PLAY FIRST</span>
          <button
            type="button"
            class="btn primary"
            onclick={handleCreateRoom}
            disabled={creating || pickedUnits.size === 0}
          >
            {creating ? 'Creating...' : 'Create room →'}
          </button>
        </div>
      </div>
    {:else}
      <div class="tab-pane">
        <form onsubmit={handleJoinSubmit} class="join-form">
          <label for="join-code" class="mono-tag small">Room code</label>
          <div class="join-row">
            <input
              id="join-code"
              type="text"
              class="code-input"
              placeholder="e.g. K7QX4M"
              maxlength="6"
              bind:value={joinCode}
            />
            <button type="submit" class="btn primary">Join →</button>
          </div>
        </form>
      </div>
    {/if}
  </section>

  <!-- Side List of Rooms -->
  <aside class="card rooms-card">
    <div class="rooms-head">
      <h3>Your rooms</h3>
      <span class="mono-tag muted small">({myDuels.length})</span>
    </div>

    {#if myDuels.length === 0}
      <p class="muted small empty-note">You haven't played any duels yet.</p>
    {:else}
      <ul class="duel-rows">
        {#each myDuels as d}
          <li class="duel-row-item">
            <div class="row-info">
              <span class="pill yellow">{d.code}</span>
              <span class="row-desc small">{d.title || 'Duel'}</span>
            </div>
            <a href="#/duel/{d.code}" class="btn outline sm">
              {d.submitted ? 'View' : 'Play →'}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>

<style>
  .lobby-grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 24px;
    align-items: flex-start;
  }

  @media (max-width: 860px) {
    .lobby-grid {
      grid-template-columns: 1fr;
    }
  }

  .picker-card {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .picker-head h2 {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }

  .mode-tabs {
    display: flex;
    gap: 12px;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 18px;
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    font-weight: 700;
    font-size: 14px;
    transition: background-color 0.12s ease;
  }

  .tab-btn:hover {
    background: var(--color-hi-vis-yellow);
  }

  .tab-btn.active {
    background: var(--color-hi-vis-yellow);
  }

  .tab-pane {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .select-input {
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 8px 12px;
    background: var(--color-bone-white);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
  }

  .deck-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-top: 6px;
  }

  .deck-header h3 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }

  .deck-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 280px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .deck-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .deck-item:hover {
    background: rgba(244, 237, 54, 0.4);
  }

  .deck-item.selected {
    background: rgba(244, 237, 54, 0.7);
  }

  .deck-item input {
    cursor: pointer;
    width: 18px;
    height: 18px;
    accent-color: var(--color-ink-black);
  }

  .deck-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .deck-title {
    font-size: 14px;
  }

  .create-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 16px;
    border-top: 1.5px solid rgba(26, 26, 26, 0.15);
  }

  .join-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 360px;
  }

  .join-row {
    display: flex;
    gap: 12px;
  }

  .code-input {
    flex: 1;
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    padding: 10px 16px;
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }

  .error-text {
    color: var(--color-firecracker-red);
    font-weight: 700;
    font-size: 13px;
  }

  /* Side Rooms */
  .rooms-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .rooms-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rooms-head h3 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }

  .empty-note {
    text-align: center;
    padding: 20px 0;
  }

  .duel-rows {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;
  }

  .duel-row-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border: 1.2px solid rgba(26, 26, 26, 0.15);
    border-radius: var(--radius-card);
  }

  .row-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .row-desc {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
