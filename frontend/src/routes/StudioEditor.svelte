<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let content = $state(null);
  let selectedLesson = $state(null);

  // New word form state
  let wordLt = $state('');
  let wordEn = $state('');
  let wordPos = $state('');
  let wordNote = $state('');
  let addingWord = $state(false);

  onMount(async () => {
    await loadContent();
  });

  async function loadContent() {
    try {
      loading = true;
      const res = await api(`/studio/${id}/content`);
      content = res;
      // Auto-select first lesson if available and none selected
      if (!selectedLesson && res.units?.[0]?.lessons?.[0]) {
        selectedLesson = res.units[0].lessons[0];
      } else if (selectedLesson) {
        // Refresh selected lesson reference
        const found = res.units?.flatMap(u => u.lessons || []).find(l => l.id === selectedLesson.id);
        if (found) selectedLesson = found;
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load course editor';
    } finally {
      loading = false;
    }
  }

  let course = $derived(content?.course || null);
  let units = $derived(content?.units || []);

  async function handleAddUnit() {
    const title = prompt('Enter deck / unit title:');
    if (!title || !title.trim()) return;
    const level = (prompt('Level (A1, A2, B1, B2...):', 'A1') || 'A1').trim().toUpperCase();

    try {
      await api(`/studio/${id}/units`, {
        method: 'POST',
        body: { title: title.trim(), level, description: '' }
      });
      await loadContent();
      appState.showToast('Deck added!');
    } catch (e) {
      appState.showToast(e.message || 'Failed to add deck');
    }
  }

  async function handleDeleteUnit(uId) {
    if (!confirm('Are you sure you want to delete this deck and all its lessons?')) return;
    try {
      await api(`/studio/${id}/units/${uId}`, { method: 'DELETE' });
      await loadContent();
      appState.showToast('Deck deleted');
    } catch (e) {
      appState.showToast(e.message || 'Failed to delete deck');
    }
  }

  async function handleAddLesson(uId) {
    const title = prompt('Enter lesson title:');
    if (!title || !title.trim()) return;

    try {
      const res = await api(`/studio/${id}/units/${uId}/lessons`, {
        method: 'POST',
        body: { title: title.trim() }
      });
      await loadContent();
      appState.showToast('Lesson added!');
    } catch (e) {
      appState.showToast(e.message || 'Failed to add lesson');
    }
  }

  async function handleDeleteLesson(lId) {
    if (!confirm('Delete this lesson and all its words?')) return;
    try {
      await api(`/studio/${id}/lessons/${lId}`, { method: 'DELETE' });
      if (selectedLesson?.id === lId) selectedLesson = null;
      await loadContent();
      appState.showToast('Lesson deleted');
    } catch (e) {
      appState.showToast(e.message || 'Failed to delete lesson');
    }
  }

  async function handleAddWord(e) {
    e.preventDefault();
    if (!selectedLesson || !wordLt.trim() || !wordEn.trim()) return;

    try {
      addingWord = true;
      await api(`/studio/${id}/lessons/${selectedLesson.id}/words`, {
        method: 'POST',
        body: {
          lt: wordLt.trim(),
          en: wordEn.trim(),
          pos: wordPos.trim() || undefined,
          note: wordNote.trim() || undefined,
        }
      });
      wordLt = '';
      wordEn = '';
      wordPos = '';
      wordNote = '';
      await loadContent();
      appState.showToast('Word added!');
    } catch (e) {
      appState.showToast(e.message || 'Failed to add word');
    } finally {
      addingWord = false;
    }
  }

  async function handleDeleteWord(wId) {
    if (!confirm('Delete this word?')) return;
    try {
      await api(`/studio/${id}/words/${wId}`, { method: 'DELETE' });
      await loadContent();
      appState.showToast('Word deleted');
    } catch (e) {
      appState.showToast(e.message || 'Failed to delete word');
    }
  }
</script>

<div class="editor-view">
  <div class="editor-topbar">
    <div class="nav-back">
      <a href="#/studio" class="back-link mono-tag">
        <Icon name="back" size={16} />
        <span>Studio</span>
      </a>
      {#if course}
        <span class="mono-tag muted">/ {course.title}</span>
      {/if}
    </div>

    {#if course}
      <div class="top-actions">
        <a href="#/learn/course/{course.id}" class="btn sm outline">
          <span>Learner view</span>
        </a>
        <button class="btn sm primary" onclick={handleAddUnit}>
          <Icon name="plus" size={14} />
          <span>Add deck</span>
        </button>
      </div>
    {/if}
  </div>

  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading course syllabus…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Unable to load course</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/studio" class="btn primary">Back to Studio</a>
    </div>
  {:else if course}
    <div class="editor-grid">
      <!-- Left Panel: Decks & Lessons Tree -->
      <aside class="card syllabus-panel">
        <div class="panel-head">
          <h3>Decks & Lessons</h3>
          <button class="icon-btn sm" onclick={handleAddUnit} title="Add deck">
            <Icon name="plus" size={14} />
          </button>
        </div>

        {#if units.length === 0}
          <p class="muted small empty-note">No decks yet. Click "Add deck" to start.</p>
        {:else}
          <div class="units-list">
            {#each units as u}
              <div class="unit-group">
                <div class="unit-bar">
                  <div class="unit-name-wrap">
                    {#if u.level}
                      <span class="pill yellow sm">{u.level}</span>
                    {/if}
                    <b>{u.title}</b>
                  </div>

                  <div class="unit-actions">
                    <button
                      class="mini-btn"
                      title="Add lesson"
                      onclick={() => handleAddLesson(u.id)}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                    <button
                      class="mini-btn trash"
                      title="Delete deck"
                      onclick={() => handleDeleteUnit(u.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>

                <!-- Lessons in Unit -->
                <ul class="lesson-sublist">
                  {#each (u.lessons || []) as l}
                    <li>
                      <button
                        type="button"
                        class="lesson-select-btn"
                        class:active={selectedLesson?.id === l.id}
                        onclick={() => selectedLesson = l}
                      >
                        <span class="l-title">{l.title}</span>
                        <span class="mono-tag muted small">{(l.words || []).length}w</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
        {/if}
      </aside>

      <!-- Right Panel: Lesson Words Editor -->
      <main class="card lesson-content-panel">
        {#if !selectedLesson}
          <div class="no-selection">
            <Icon name="cards" size={40} />
            <p class="muted">Select a lesson from the left, or add a new lesson.</p>
          </div>
        {:else}
          <div class="lesson-panel-header">
            <div>
              <span class="mono-tag muted small">EDITING LESSON</span>
              <h2>{selectedLesson.title}</h2>
            </div>
            <button
              class="btn outline sm"
              onclick={() => handleDeleteLesson(selectedLesson.id)}
            >
              <Icon name="trash" size={14} />
              <span>Delete lesson</span>
            </button>
          </div>

          <!-- Add Word Form -->
          <form onsubmit={handleAddWord} class="add-word-form">
            <h4 class="mono-tag">Add vocabulary word</h4>
            <div class="word-inputs">
              <input
                type="text"
                class="input-box"
                placeholder="Target word (e.g. knyga)"
                bind:value={wordLt}
                required
              />
              <input
                type="text"
                class="input-box"
                placeholder="English translation (e.g. book)"
                bind:value={wordEn}
                required
              />
              <input
                type="text"
                class="input-box sm"
                placeholder="Part of speech (noun, verb)"
                bind:value={wordPos}
              />
              <input
                type="text"
                class="input-box sm"
                placeholder="Optional note / example"
                bind:value={wordNote}
              />
              <button type="submit" class="btn primary sm" disabled={addingWord}>
                {addingWord ? 'Adding...' : '+ Add Word'}
              </button>
            </div>
          </form>

          <!-- Words Table -->
          <div class="words-table-wrap">
            <div class="table-head mono-tag muted small">
              <span>{(selectedLesson.words || []).length} WORDS IN THIS LESSON</span>
            </div>

            {#if !selectedLesson.words || selectedLesson.words.length === 0}
              <p class="muted small empty-note">No words added to this lesson yet.</p>
            {:else}
              <ul class="words-list">
                {#each selectedLesson.words as w}
                  <li class="word-entry">
                    <div class="w-info">
                      <b class="w-lt">{w.lt}</b>
                      <span class="w-eq">=</span>
                      <span class="w-en">{w.en}</span>
                      {#if w.pos}
                        <span class="pill sm">{w.pos}</span>
                      {/if}
                      {#if w.note}
                        <small class="muted">({w.note})</small>
                      {/if}
                    </div>

                    <button
                      class="mini-btn trash"
                      title="Delete word"
                      onclick={() => handleDeleteWord(w.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .editor-view {
    max-width: 1040px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .editor-topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .nav-back {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: var(--color-bone-white);
  }

  .back-link:hover {
    color: var(--color-hi-vis-yellow);
  }

  .top-actions {
    display: flex;
    gap: 10px;
  }

  .editor-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 820px) {
    .editor-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Left Panel */
  .syllabus-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.1);
    padding-bottom: 8px;
  }

  .panel-head h3 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }

  .units-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .unit-group {
    border: 1px solid rgba(26, 26, 26, 0.15);
    border-radius: var(--radius-card);
    padding: 10px;
    background: rgba(26, 26, 26, 0.02);
  }

  .unit-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .unit-name-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
  }

  .unit-actions {
    display: flex;
    gap: 4px;
  }

  .mini-btn {
    width: 24px;
    height: 24px;
    border: 1px solid var(--color-ink-black);
    border-radius: 4px;
    background: var(--color-bone-white);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mini-btn:hover {
    background: var(--color-hi-vis-yellow);
  }

  .mini-btn.trash:hover {
    background: var(--color-bubblegum-pink);
  }

  .lesson-sublist {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
  }

  .lesson-select-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-radius: var(--radius-pill);
    border: var(--border-hair);
    text-align: left;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    background: var(--color-bone-white);
    transition: transform 0.08s ease, background-color 0.1s ease;
  }

  .lesson-select-btn:hover {
    background: var(--color-buttery-yellow);
    transform: translateX(2px);
  }

  .lesson-select-btn.active {
    background: var(--color-hi-vis-yellow);
    box-shadow: 0 2px 0 var(--color-ink-black);
  }

  /* Right Panel */
  .lesson-content-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 24px;
  }

  .lesson-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.12);
    padding-bottom: 12px;
  }

  .lesson-panel-header h2 {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
  }

  .add-word-form {
    background: rgba(26, 26, 26, 0.03);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: 0 3px 0 var(--color-ink-black);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .word-inputs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  @media (max-width: 600px) {
    .word-inputs {
      grid-template-columns: 1fr;
    }
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

  .words-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
  }

  .word-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border: 1px solid rgba(26, 26, 26, 0.15);
    border-radius: var(--radius-card);
  }

  .w-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .w-lt {
    font-family: var(--font-display);
    font-size: 15px;
  }

  .w-eq {
    color: var(--ink-60);
  }

  .no-selection, .empty-note, .loading-box, .error-box {
    text-align: center;
    padding: 40px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
</style>
