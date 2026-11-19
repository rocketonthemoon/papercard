<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';
  import { plural } from '../lib/format.js';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let content = $state(null);
  let activeView = $state('content'); // 'content' | 'arrange' | 'feedback' | 'settings'

  let selectedLessonId = $state(null);
  let editingWord = $state(null); // null or { id?, lt, en, pos, gender, also, note }
  let closedUnits = $state(new Set());

  // Suggestions state
  let feedbackFilter = $state('new');
  let feedbackData = $state({ items: [], newCount: 0 });
  let loadingFeedback = $state(false);

  // Arrange drag & drop state
  let draggedDeckIndex = $state(null);
  let draggedLesson = $state(null); // { id, unitId, index }

  // Settings form state
  let settingsTitle = $state('');
  let settingsDesc = $state('');
  let settingsLocked = $state(false);
  let tokenStats = $state(null);
  let tokenCount = $state(10);

  const POS_LABELS = {
    noun: 'noun',
    verb: 'verb',
    phrase: 'phrase',
    adj: 'adjective',
    adv: 'adverb',
    other: 'other',
  };

  const GENDERS = {
    m: 'masculine',
    f: 'feminine',
  };

  onMount(async () => {
    await loadContent();
  });

  async function loadContent() {
    try {
      loading = true;
      errorMsg = '';
      const res = await api(`/studio/${id}/content`);
      content = res;

      settingsTitle = res.course?.title || '';
      settingsDesc = res.course?.description || '';
      settingsLocked = !!res.course?.locked;

      // Select first lesson if none selected
      const lessons = allLessons(res.units || []);
      if (!selectedLessonId && lessons.length > 0) {
        selectedLessonId = lessons[0].id;
      }

      // Close non-active units by default initially
      if (closedUnits.size === 0 && res.units?.length > 1) {
        const activeUnitId = lessons.find(l => l.id === selectedLessonId)?.unitId;
        const closed = new Set();
        for (const u of res.units) {
          if (u.id !== activeUnitId) closed.add(u.id);
        }
        closedUnits = closed;
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load course';
    } finally {
      loading = false;
    }
  }

  function allLessons(unitsList) {
    return (unitsList || []).flatMap(u =>
      (u.lessons || []).map(l => ({ ...l, unitId: u.id, unitTitle: u.title }))
    );
  }

  let course = $derived(content?.course || null);
  let units = $derived(content?.units || []);
  let lessonsList = $derived(allLessons(units));
  let currentLesson = $derived(lessonsList.find(l => l.id === selectedLessonId) || null);

  async function cmsDo(method, path, body) {
    try {
      content = await api(`/studio/${id}${path}`, {
        method,
        body: body ?? (method === 'DELETE' ? undefined : {}),
      });
      return true;
    } catch (e) {
      appState.showToast(e.message || 'Operation failed');
      return false;
    }
  }

  // Unit actions
  async function handleAddUnit() {
    const title = prompt('Deck title:');
    if (!title || !title.trim()) return;
    const level = (prompt('Level (A1, A2, B1, B2...):', 'A1') || 'A1').trim().toUpperCase();
    const description = prompt('Short description (optional):') || '';

    if (await cmsDo('POST', '/units', { title: title.trim(), level, description })) {
      const added = content.units?.at(-1);
      if (added) {
        const next = new Set(closedUnits);
        next.delete(added.id);
        closedUnits = next;
      }
      appState.showToast('Deck added!');
    }
  }

  async function handleEditUnit(u) {
    const title = prompt('Deck title:', u.title);
    if (!title || !title.trim()) return;
    const level = (prompt('Level (A1, A2, B1, B2...):', u.level || 'A1') || '').trim().toUpperCase();
    const description = prompt('Short description (optional):', u.description || '') || '';

    if (await cmsDo('PUT', `/units/${u.id}`, { title: title.trim(), level, description })) {
      appState.showToast('Deck updated');
    }
  }

  async function handleDeleteUnit(uId) {
    if (!confirm("Delete this deck and all its lessons and words? Learners' progress on it will be deleted too.")) return;
    if (await cmsDo('DELETE', `/units/${uId}`)) {
      editingWord = null;
      appState.showToast('Deck deleted');
    }
  }

  // Lesson actions
  async function handleAddLesson(uId) {
    const title = prompt('Lesson title:');
    if (!title || !title.trim()) return;

    if (await cmsDo('POST', '/lessons', { unitId: uId, title: title.trim() })) {
      const u = content.units?.find(x => x.id === uId);
      const added = u?.lessons?.at(-1);
      if (added) selectedLessonId = added.id;
      const next = new Set(closedUnits);
      next.delete(uId);
      closedUnits = next;
      appState.showToast('Lesson added!');
    }
  }

  async function handleEditLesson(l) {
    const title = prompt('Lesson title:', l.title);
    if (title === null || !title.trim()) return;

    if (await cmsDo('PUT', `/lessons/${l.id}`, { title: title.trim() })) {
      appState.showToast('Lesson renamed');
    }
  }

  async function handleDeleteLesson(lId) {
    if (!confirm("Delete this lesson and its words? Learners' progress is deleted too.")) return;
    if (await cmsDo('DELETE', `/lessons/${lId}`)) {
      if (selectedLessonId === lId) selectedLessonId = null;
      editingWord = null;
      appState.showToast('Lesson deleted');
    }
  }

  // Move items (up / down)
  async function handleMove(kind, moveId, dir) {
    if (await cmsDo('POST', '/move', { kind, id: moveId, dir })) {
      // successfully reordered
    }
  }

  // Word actions
  function startNewWord() {
    editingWord = {
      lt: '',
      en: '',
      pos: 'noun',
      gender: '',
      also: '',
      note: '',
    };
  }

  function startEditWord(w) {
    editingWord = {
      id: w.id,
      lt: w.lt || '',
      en: w.en || '',
      pos: w.pos || 'noun',
      gender: w.gender || '',
      also: w.also || '',
      note: w.note || '',
    };
  }

  async function handleSaveWord(e) {
    e.preventDefault();
    if (!selectedLessonId || !editingWord) return;

    const body = {
      lt: editingWord.lt.trim(),
      en: editingWord.en.trim(),
      pos: editingWord.pos,
      gender: editingWord.pos === 'noun' ? editingWord.gender : '',
      also: editingWord.also.trim(),
      note: editingWord.note.trim(),
    };

    if (editingWord.id) {
      if (await cmsDo('PUT', `/words/${editingWord.id}`, body)) {
        editingWord = null;
        appState.showToast('Word saved');
      }
    } else {
      if (await cmsDo('POST', '/words', { ...body, lessonId: selectedLessonId })) {
        editingWord = null;
        appState.showToast('Word added');
      }
    }
  }

  async function handleDeleteWord(wId) {
    if (!confirm('Delete this word?')) return;
    if (await cmsDo('DELETE', `/words/${wId}`)) {
      if (editingWord?.id === wId) editingWord = null;
      appState.showToast('Word deleted');
    }
  }

  // Tree toggle
  function toggleUnitOpen(uId) {
    const next = new Set(closedUnits);
    if (next.has(uId)) {
      next.delete(uId);
    } else {
      next.add(uId);
    }
    closedUnits = next;
  }

  function toggleAllUnits() {
    if (units.every(u => closedUnits.has(u.id))) {
      closedUnits = new Set();
    } else {
      closedUnits = new Set(units.map(u => u.id));
    }
  }

  // Settings Actions
  async function handleSaveSettings(e) {
    e.preventDefault();
    try {
      await api(`/courses/${id}`, {
        method: 'PUT',
        body: {
          title: settingsTitle.trim(),
          description: settingsDesc.trim(),
          fromLang: course.fromLang,
          toLang: course.toLang,
          locked: settingsLocked,
        },
      });
      await loadContent();
      appState.showToast('Settings saved!');
    } catch (err) {
      appState.showToast(err.message || 'Failed to save settings');
    }
  }

  async function loadTokens() {
    try {
      tokenStats = await api(`/studio/${id}/tokens`);
    } catch {}
  }

  async function handleCreateTokens(e) {
    e.preventDefault();
    try {
      const res = await api(`/studio/${id}/tokens`, {
        method: 'POST',
        body: { count: Number(tokenCount) },
      });
      // Trigger download
      const blob = new Blob([res.codes.join('\n') + '\n'], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `course-${id}-codes.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      tokenStats = res.stats;
      appState.showToast(`${res.codes.length} access codes created & downloaded!`);
    } catch (err) {
      appState.showToast(err.message || 'Failed to generate codes');
    }
  }

  async function handleDeleteCourse() {
    if (prompt(`Type the course title to delete it:\n${course.title}`) !== course.title) {
      appState.showToast('Deletion canceled');
      return;
    }
    try {
      await api(`/courses/${id}`, { method: 'DELETE' });
      appState.showToast('Course deleted');
      appState.navigate('#/studio');
    } catch (err) {
      appState.showToast(err.message || 'Failed to delete course');
    }
  }

  async function handleQuickAddUnit(e) {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const title = input?.value.trim();
    if (!title) return;
    if (await cmsDo('POST', '/units', { title, level: '', description: '' })) {
      input.value = '';
      appState.showToast('Deck added!');
    }
  }

  async function handleQuickAddLesson(e, uId) {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const title = input?.value.trim();
    if (!title) return;
    if (await cmsDo('POST', '/lessons', { unitId: uId, title })) {
      input.value = '';
      appState.showToast('Lesson added!');
    }
  }

  function onDragStartDeck(e, index) {
    draggedDeckIndex = index;
    try { e.dataTransfer.setData('text/plain', String(index)); } catch {}
  }

  async function onDropDeck(e, targetIndex) {
    e.preventDefault();
    if (draggedDeckIndex === null || draggedDeckIndex === targetIndex) return;
    const u = units[draggedDeckIndex];
    if (!u) return;
    await cmsDo('POST', '/arrange', { kind: 'unit', id: u.id, index: targetIndex });
    draggedDeckIndex = null;
  }

  function onDragStartLesson(e, lessonId, unitId, index) {
    draggedLesson = { id: lessonId, unitId, index };
    e.stopPropagation();
    try { e.dataTransfer.setData('text/plain', String(lessonId)); } catch {}
  }

  async function onDropLesson(e, targetUnitId, targetIndex) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedLesson) return;
    await cmsDo('POST', '/arrange', {
      kind: 'lesson',
      id: draggedLesson.id,
      unitId: targetUnitId,
      index: targetIndex
    });
    draggedLesson = null;
  }

  async function loadFeedback(filter = 'new') {
    try {
      loadingFeedback = true;
      feedbackFilter = filter;
      const res = await api(`/studio/${id}/feedback?status=${filter}`);
      feedbackData = res;
    } catch (e) {
      feedbackData = { items: [], newCount: 0 };
    } finally {
      loadingFeedback = false;
    }
  }

  async function handleMarkFeedback(fbId, currentStatus) {
    const nextStatus = currentStatus === 'new' ? 'done' : 'new';
    try {
      await api(`/studio/${id}/feedback/${fbId}`, {
        method: 'PUT',
        body: { status: nextStatus },
      });
      await loadFeedback(feedbackFilter);
      appState.showToast('Feedback updated');
    } catch (e) {
      appState.showToast(e.message || 'Failed to update feedback');
    }
  }

  async function handleDeleteFeedback(fbId) {
    if (!confirm('Delete this suggestion?')) return;
    try {
      await api(`/studio/${id}/feedback/${fbId}`, { method: 'DELETE' });
      await loadFeedback(feedbackFilter);
      appState.showToast('Feedback deleted');
    } catch (e) {
      appState.showToast(e.message || 'Failed to delete feedback');
    }
  }

  $effect(() => {
    if (activeView === 'settings') {
      loadTokens();
    } else if (activeView === 'feedback') {
      loadFeedback(feedbackFilter);
    }
  });
</script>

<div>
  {#if loading}
    <p class="page-loading" role="status">Loading studio…</p>
  {:else if errorMsg || !course}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Unable to load course</h2>
        <p class="muted">{errorMsg || 'Course not found'}</p>
      </header>
      <div class="row picker-actions">
        <a class="btn btn-gate-pill" href="#/studio">Back to Studio</a>
      </div>
    </section>
  {:else}
    <!-- Studio Top Toolbar (1:1 with web/game.js:2986) -->
    <div class="toolbar se-toolbar">
      <div class="page-head se-head">
        <a class="back" href="#/studio">← Studio</a>
        <h1 class="se-title">{course.title}</h1>
        <p class="muted small mono-tag se-meta">
          {course.toLang} · {plural(units.length, 'deck')} · {plural(course.words, 'word')} · {plural(course.learners, 'learner')}
        </p>
      </div>

      <div class="toolbar-actions se-actions">
        <div class="segmented se-tabs" role="tablist" aria-label="Editor views">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'content'}
            class:selected={activeView === 'content'}
            onclick={() => activeView = 'content'}
          >
            Content
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'arrange'}
            class:selected={activeView === 'arrange'}
            onclick={() => activeView = 'arrange'}
          >
            Arrange
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'feedback'}
            class:selected={activeView === 'feedback'}
            onclick={() => activeView = 'feedback'}
          >
            Suggestions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'settings'}
            class:selected={activeView === 'settings'}
            onclick={() => activeView = 'settings'}
          >
            Settings
          </button>
        </div>

        <a class="btn outline small" href="#/course/{course.id}">View</a>
        <button class="btn btn-gate-pill small" onclick={handleAddUnit}>+ New deck</button>
      </div>
    </div>

    <!-- VIEW 1: CONTENT (1:1 with web/game.js:3036) -->
    {#if activeView === 'content'}
      <div class="cms">
        <!-- Left: Decks & Lessons Tree -->
        <aside class="card cms-tree">
          {#if units.length > 1}
            <div class="tree-head">
              <span class="muted small mono-tag">{units.length} decks</span>
              <button class="linkbtn small" onclick={toggleAllUnits}>
                {units.every(u => closedUnits.has(u.id)) ? 'Expand all' : 'Collapse all'}
              </button>
            </div>
          {/if}

          <ul class="tree">
            {#each units as u, ui (u.id)}
              {@const isClosed = closedUnits.has(u.id)}
              <li class="tree-unit {isClosed ? 'closed' : ''}" data-unit={u.id}>
                <!-- Deck row -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="tree-row unit-row" onclick={() => toggleUnitOpen(u.id)}>
                  <button
                    type="button"
                    class="icon-btn sm tree-toggle"
                    aria-expanded={!isClosed}
                    title={isClosed ? 'Show lessons' : 'Hide lessons'}
                    onclick={(e) => { e.stopPropagation(); toggleUnitOpen(u.id); }}
                  >
                    <Icon name="chev" size={14} />
                  </button>

                  <span class="unit-label">
                    <span class="muted small">
                      {u.level ? `${u.level} · ` : ''}Deck {ui + 1}
                      <span class="unit-count"> · {(u.lessons || []).length} lessons</span>
                    </span>
                    <br />
                    <b>{u.title}</b>
                  </span>

                  <!-- Deck tools -->
                  <span class="tools" onclick={(e) => e.stopPropagation()}>
                    <button class="icon-btn sm" title="Move up" aria-label="Move deck {u.title} up" disabled={ui === 0} onclick={() => handleMove('unit', u.id, -1)}>↑</button>
                    <button class="icon-btn sm" title="Move down" aria-label="Move deck {u.title} down" disabled={ui === units.length - 1} onclick={() => handleMove('unit', u.id, 1)}>↓</button>
                    <button class="icon-btn sm" title="Edit deck" aria-label="Edit deck {u.title}" onclick={() => handleEditUnit(u)}><Icon name="edit" size={14} /></button>
                    <button class="icon-btn sm danger" title="Delete deck" aria-label="Delete deck {u.title}" onclick={() => handleDeleteUnit(u.id)}><Icon name="trash" size={14} /></button>
                  </span>
                </div>

                <!-- Lessons in Deck -->
                {#if !isClosed}
                  <ul class="tree-lessons">
                    {#each (u.lessons || []) as l (l.id)}
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <li>
                        <div
                          class="tree-row lesson-row {l.id === selectedLessonId ? 'active' : ''}"
                          onclick={() => { selectedLessonId = l.id; editingWord = null; }}
                        >
                          <span>{l.title} <span class="muted small">({(l.words || []).length})</span></span>

                          <span class="tools" onclick={(e) => e.stopPropagation()}>
                            <button class="icon-btn sm" title="Move up" onclick={() => handleMove('lesson', l.id, -1)}>↑</button>
                            <button class="icon-btn sm" title="Move down" onclick={() => handleMove('lesson', l.id, 1)}>↓</button>
                            <button class="icon-btn sm" title="Rename lesson" aria-label="Rename lesson {l.title}" onclick={() => handleEditLesson(l)}><Icon name="edit" size={14} /></button>
                            <button class="icon-btn sm danger" title="Delete lesson" aria-label="Delete lesson {l.title}" onclick={() => handleDeleteLesson(l.id)}><Icon name="trash" size={14} /></button>
                          </span>
                        </div>
                      </li>
                    {/each}
                    <li>
                      <button class="linkbtn small" onclick={() => handleAddLesson(u.id)}>+ Add lesson</button>
                    </li>
                  </ul>
                {/if}
              </li>
            {:else}
              <li class="muted small tree-empty">No decks yet. Add one with “New deck”.</li>
            {/each}
          </ul>
        </aside>

        <!-- Right: CMS Main Area -->
        <section class="card cms-main" id="cms-main">
          {#if editingWord}
            <!-- Word Form (1:1 with web/game.js:3460) -->
            <div class="list-head se-list-head">
              <h2>{editingWord.id ? 'Edit word' : 'New word'}</h2>
              <button class="btn outline small" type="button" onclick={() => editingWord = null}>Cancel</button>
            </div>

            <form class="form" onsubmit={handleSaveWord}>
              <div class="pos-segmented-scroll">
                <div class="segmented pos-segmented" role="radiogroup" aria-label="Part of speech">
                  {#each Object.entries(POS_LABELS) as [k, l]}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={editingWord.pos === k}
                      class:selected={editingWord.pos === k}
                      onclick={() => {
                        editingWord.pos = k;
                        if (k !== 'noun') editingWord.gender = '';
                      }}
                    >
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="form-two word-form-row">
                <label class="field">
                  {course.toLang}
                  <input
                    type="text"
                    maxlength="100"
                    bind:value={editingWord.lt}
                    required
                  />
                </label>
                <label class="field">
                  English
                  <input
                    type="text"
                    maxlength="100"
                    bind:value={editingWord.en}
                    placeholder={editingWord.pos === 'phrase' ? 'Where is the library?' : 'book'}
                    required
                  />
                </label>
              </div>

              {#if editingWord.pos === 'noun'}
                <label class="field">
                  Gender
                  <select
                    bind:value={editingWord.gender}
                  >
                    <option value="">(none)</option>
                    {#each Object.entries(GENDERS) as [k, l]}
                      <option value={k}>{l}</option>
                    {/each}
                  </select>
                </label>
              {/if}

              <label class="field">
                Also accepted <span class="muted small">(other correct answers, separated by ;)</span>
                <input
                  type="text"
                  maxlength="200"
                  bind:value={editingWord.also}
                  placeholder="e.g. knygelė; leidinys"
                />
              </label>

              <label class="field">
                Note <span class="muted small">(shown after answer: usage tip, example...)</span>
                <input
                  type="text"
                  maxlength="200"
                  bind:value={editingWord.note}
                  placeholder="e.g. Informal slang"
                />
              </label>

              <div class="pane-actions row spread se-form-foot">
                <span class="muted small">Matching ignores capitals and punctuation.</span>
                <button type="submit" class="btn btn-gate-pill small">Save word</button>
              </div>
            </form>
          {:else if currentLesson}
            <!-- Lesson Words View (1:1 with web/game.js:3046) -->
            <div class="list-head se-list-head">
              <div>
                <span class="muted small mono-tag">{currentLesson.unitTitle}</span>
                <h2 class="se-lesson-title">{currentLesson.title}</h2>
              </div>
              <button class="btn btn-gate-pill small" onclick={startNewWord}>+ Add word</button>
            </div>

            <p class="muted small se-help">
              Each word becomes four exercises: pick its meaning, pick the {course.toLang}, type it, or build it from tiles.
            </p>

            <ul class="rows se-words">
              {#each (currentLesson.words || []) as w, i (w.id)}
                <li class="ch-row se-word">
                  <div class="se-word-main">
                    <span class="badge pos-badge {w.pos}">
                      {POS_LABELS[w.pos] || w.pos}
                    </span>
                    <div>
                      <b>{i + 1}. {w.lt}</b>
                      <span class="muted se-word-en">= {w.en}</span>
                      {#if GENDERS[w.gender]}
                        <span class="pill bone sm se-word-gender">{GENDERS[w.gender]}</span>
                      {/if}
                      {#if w.also || w.note}
                        <p class="muted small se-word-extra">
                          {#if w.also}<span>Also accepted: {w.also}</span>{/if}
                          {#if w.also && w.note} · {/if}
                          {#if w.note}<span>{w.note}</span>{/if}
                        </p>
                      {/if}
                    </div>
                  </div>

                  <!-- Word tools -->
                  <span class="tools se-tools">
                    <button class="icon-btn sm" title="Move up" aria-label="Move {w.lt} up" disabled={i === 0} onclick={() => handleMove('word', w.id, -1)}>↑</button>
                    <button class="icon-btn sm" title="Move down" aria-label="Move {w.lt} down" disabled={i === (currentLesson.words || []).length - 1} onclick={() => handleMove('word', w.id, 1)}>↓</button>
                    <button class="icon-btn sm" title="Edit word" aria-label="Edit {w.lt}" onclick={() => startEditWord(w)}><Icon name="edit" size={14} /></button>
                    <button class="icon-btn sm danger" title="Delete word" aria-label="Delete {w.lt}" onclick={() => handleDeleteWord(w.id)}><Icon name="trash" size={14} /></button>
                  </span>
                </li>
              {:else}
                <li class="empty-row se-empty">
                  <span class="muted small">No words yet. Use “+ Add word” to add the first one.</span>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="se-empty se-empty-lg">
              <p class="muted">
                {units.length ? 'Select a lesson from the left, or add a lesson to start adding words.' : 'Start with a deck (a topic, like “At the café”), then add lessons and words to it.'}
              </p>
            </div>
          {/if}
        </section>
      </div>
    {/if}

    <!-- VIEW 2: ARRANGE (1:1 with web/game.js:3273) -->
    {#if activeView === 'arrange'}
      <p class="muted arrange-help">
        Drag lessons to reorder them or move them between decks. Use ← and → or drag a deck to reorder decks. Click a name to rename.
      </p>

      <div class="board" id="board" role="list" aria-label="Decks">
        {#each units as u, ui (u.id)}
          <section
            class="board-col card"
            role="listitem"
            aria-label="Deck {ui + 1}: {u.title}"
            data-unit={u.id}
            draggable="true"
            ondragstart={(e) => onDragStartDeck(e, ui)}
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => onDropDeck(e, ui)}
          >
            <header class="board-col-head deck-head">
              <div class="deck-toolbar">
                <span class="drag-handle deck-handle" title="Drag to reorder decks">
                  <Icon name="grip" size={14} />
                </span>
                <span class="module-no mono-tag">{ui + 1}</span>
                {#if u.level}<span class="pill bone sm">{u.level}</span>{/if}
                <span class="deck-toolbar-gap"></span>
                <button
                  type="button"
                  class="icon-btn sm"
                  title="Move deck left"
                  disabled={ui === 0}
                  onclick={() => handleMove('unit', u.id, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  class="icon-btn sm"
                  title="Move deck right"
                  disabled={ui === units.length - 1}
                  onclick={() => handleMove('unit', u.id, 1)}
                >
                  →
                </button>
                <button type="button" class="icon-btn sm danger" onclick={() => handleDeleteUnit(u.id)} title="Delete deck" aria-label="Delete deck {u.title}"><Icon name="trash" size={14} /></button>
              </div>
              <button type="button" class="rename deck-title" onclick={() => handleEditUnit(u)} title="Rename deck">
                {u.title}
              </button>
            </header>

            <ul
              class="board-cards"
              data-unit={u.id}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => onDropLesson(e, u.id, (u.lessons || []).length)}
            >
              {#each (u.lessons || []) as l, li (l.id)}
                <li
                  class="board-card card"
                  data-lesson={l.id}
                  draggable="true"
                  ondragstart={(e) => onDragStartLesson(e, l.id, u.id, li)}
                  ondragover={(e) => e.preventDefault()}
                  ondrop={(e) => onDropLesson(e, u.id, li)}
                >
                  <span class="drag-handle lesson-handle">
                    <Icon name="grip" size={12} />
                  </span>
                  <div class="lesson-main">
                    <button type="button" class="rename lesson-title" onclick={() => handleEditLesson(l)} title="Rename lesson">
                      {l.title}
                    </button>
                    <div class="muted small mono-tag lesson-count">{(l.words || []).length} words</div>
                  </div>
                  <div class="lesson-tools">
                    <button
                      type="button"
                      class="icon-btn sm"
                      title="Move lesson up"
                      disabled={li === 0}
                      onclick={() => handleMove('lesson', l.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="icon-btn sm"
                      title="Move lesson down"
                      disabled={li === (u.lessons || []).length - 1}
                      onclick={() => handleMove('lesson', l.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="icon-btn sm"
                      title="Edit its words in Content"
                      onclick={() => { selectedLessonId = l.id; editingWord = null; activeView = 'content'; }}
                    >
                      →
                    </button>
                  </div>
                </li>
              {/each}
            </ul>

            <!-- Inline Quick Add Lesson Form -->
            <form class="board-add" onsubmit={(e) => handleQuickAddLesson(e, u.id)}>
              <input
                type="text"
                maxlength="80"
                placeholder="+ Add a lesson (Enter to save)"
                aria-label="New lesson in {u.title}"
              />
            </form>
          </section>
        {/each}

        <!-- Quick Add New Deck column -->
        <form
          class="board-col board-new card"
          id="board-new-deck"
          onsubmit={handleQuickAddUnit}
        >
          <input
            type="text"
            maxlength="80"
            placeholder="+ New deck (Enter)"
            aria-label="New deck"
          />
          <button type="submit" class="btn btn-gate-pill small board-new-btn">Create deck</button>
        </form>
      </div>
    {/if}

    <!-- VIEW 3: SUGGESTIONS / FEEDBACK (1:1 with web/game.js:3406) -->
    {#if activeView === 'feedback'}
      <section class="card cms-main fb-panel">
        <div class="fb-head">
          <div class="segmented" role="tablist" aria-label="Filter suggestions">
            {#each ['new', 'done', 'all'] as f}
              <button
                type="button"
                role="tab"
                aria-selected={feedbackFilter === f}
                class:selected={feedbackFilter === f}
                onclick={() => loadFeedback(f)}
              >
                {{ new: 'New', done: 'Done', all: 'All' }[f]}
              </button>
            {/each}
          </div>
          <div class="fb-count" class:has-new={(feedbackData.newCount || 0) > 0}>
            <b>{feedbackData.newCount || 0}</b> new
          </div>
        </div>

        {#if loadingFeedback}
          <p class="page-loading" role="status">Loading suggestions…</p>
        {:else}
          <ul class="fb-list">
            {#each (feedbackData.items || []) as f (f.id)}
              <li class="fb-row card {f.status}">
                <div class="fb-row-main">
                  <div class="fb-row-meta">
                    <a class="fb-user" href="#/u/{f.username}">{f.user}</a>
                    <span class="muted small">on <b>{f.unitTitle}</b></span>
                    {#if f.rating}
                      <span class="mini-stars" role="img" aria-label="{f.rating} of 5 stars">
                        {'★'.repeat(f.rating)}<span class="mini-stars-off">{'★'.repeat(Math.max(0, 5 - f.rating))}</span>
                      </span>
                    {/if}
                    {#if f.category}
                      <span class="pill bone small mono-tag">{f.category}</span>
                    {/if}
                  </div>
                  <p class="fb-text">{f.text}</p>
                </div>

                <div class="tools fb-tools">
                  <button
                    type="button"
                    class="btn outline small"
                    onclick={() => handleMarkFeedback(f.id, f.status)}
                  >
                    {f.status === 'new' ? '✓ Mark done' : 'Reopen'}
                  </button>
                  <button
                    type="button"
                    class="icon-btn sm danger"
                    title="Delete suggestion"
                    aria-label="Delete suggestion"
                    onclick={() => handleDeleteFeedback(f.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            {:else}
              <li class="fb-empty">
                <span class="fb-empty-icon"><Icon name="chat" size={28} /></span>
                <strong>{feedbackFilter === 'new' ? 'All caught up' : feedbackFilter === 'done' ? 'Nothing marked done yet' : 'No suggestions yet'}</strong>
                <div class="fb-empty-text">Learners can suggest fixes from any deck on their Course page.</div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <!-- VIEW 4: SETTINGS (1:1 with web/game.js:3163) -->
    {#if activeView === 'settings'}
      <div class="settings-grid se-settings">
        <form class="card form se-details" onsubmit={handleSaveSettings}>
          <h2>Course details</h2>

          <label class="field">
            Course title
            <input
              type="text"
              maxlength="80"
              bind:value={settingsTitle}
              required
            />
          </label>

          <label class="field">
            Description
            <textarea
              maxlength="400"
              bind:value={settingsDesc}
              rows="3"
            ></textarea>
          </label>

          <label class="check row se-check">
            <input type="checkbox" bind:checked={settingsLocked} />
            <span>
              <b>Locked</b>: learners need an access code to start the course.
            </span>
          </label>

          <div class="row se-form-end">
            <button class="btn btn-gate-pill small" type="submit">Save details</button>
          </div>
        </form>

        <aside class="stack-sm se-side">
          <!-- Access codes card -->
          <section class="card side-card codes-card">
            <div class="widget-head row spread se-card-head">
              <h3>Access codes</h3>
              {#if course.locked}
                <span class="pill yellow small">locked</span>
              {:else}
                <span class="pill bone small">open</span>
              {/if}
            </div>

            <p class="muted small se-card-text">
              Each code opens the course once, for one learner.
            </p>

            <div class="stat-row two se-codes">
              <div><span>Unused</span><b>{tokenStats?.unused ?? '…'}</b></div>
              <div><span>Used</span><b>{tokenStats?.used ?? '…'}</b></div>
            </div>

            <form onsubmit={handleCreateTokens} class="code-make row">
              <input
                type="number"
                min="1"
                max="500"
                bind:value={tokenCount}
                aria-label="Number of codes"
              />
              <button class="btn outline small" type="submit">Generate codes</button>
            </form>
          </section>

          <!-- Export .db card -->
          <section class="card side-card">
            <h3>Export course</h3>
            <p class="muted small se-card-text">
              Download the entire course as an SQLite file.
            </p>
            <a class="btn outline small" href="/api/courses/{course.id}/export" download>
              Export .db
            </a>
          </section>

          <!-- Delete card -->
          <section class="card side-card danger-zone">
            <h3>Delete course</h3>
            <p class="muted small se-card-text">
              Permanently deletes all decks, lessons, words, and learner progress.
            </p>
            <button class="btn danger small" onclick={handleDeleteCourse}>
              Delete course
            </button>
          </section>
        </aside>
      </div>
    {/if}
  {/if}
</div>


<style>
  /* Header: title block + actions; actions wrap under the title on narrow screens */
  .se-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 14px;
    margin-bottom: 20px;
  }

  .se-head {
    flex: 1 1 260px;
    min-width: 0;
  }

  .se-title {
    margin: 4px 0 2px;
    overflow-wrap: anywhere;
  }

  .se-meta {
    margin: 0;
  }

  .se-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
  }

  @media (max-width: 700px) {
    .se-actions {
      width: 100%;
    }

    .se-tabs {
      order: 3;
      width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .se-tabs::-webkit-scrollbar {
      display: none;
    }

    .se-actions > :global(.btn) {
      flex: 1 1 0;
      justify-content: center;
    }
  }

  .tree-empty {
    padding: 16px;
  }

  /* Word editor */
  .se-list-head {
    margin-bottom: 14px;
  }

  .se-lesson-title {
    margin: 2px 0 0;
  }

  .se-help {
    margin: 0 0 18px;
  }

  .pos-segmented-scroll {
    max-width: 100%;
    overflow-x: auto;
    margin-bottom: 14px;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
  }

  .pos-segmented {
    display: inline-flex;
    white-space: nowrap;
  }

  .form :global(.field) {
    display: block;
    margin-bottom: 14px;
  }

  .form :global(.field) :global(input:not([type='checkbox'])),
  .form :global(.field) :global(select),
  .form :global(.field) :global(textarea) {
    width: 100%;
    margin-top: 4px;
    box-sizing: border-box;
  }

  .se-form-foot {
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1.5px solid rgba(26, 26, 26, 0.1);
  }

  .se-words {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .se-word {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(26, 26, 26, 0.06);
  }

  .se-word-main {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }

  .pos-badge {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .se-word-en,
  .se-word-gender {
    margin-left: 6px;
  }

  .se-word-extra {
    margin: 4px 0 0;
  }

  .se-tools {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
  }

  .se-empty {
    padding: 24px 0;
    text-align: center;
  }

  .se-empty-lg {
    padding: 40px 0;
  }

  /* Arrange board */
  .arrange-help {
    margin: 0 0 14px;
    font-size: 13px;
  }

  .board-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 40px;
  }

  .board-add {
    margin-top: auto;
  }

  .board-new {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 10px;
    padding: 24px;
  }

  .board-new-btn {
    width: 100%;
    justify-content: center;
  }

  /* Suggestions */
  .fb-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 12px 16px;
    padding: 14px 18px;
  }

  .fb-row-main {
    flex: 1 1 260px;
    min-width: 0;
  }

  .fb-row-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }

  .fb-user {
    font-weight: 700;
    color: var(--color-ink-black);
  }

  .mini-stars {
    color: #c9a400;
    letter-spacing: 1px;
    font-size: 16px;
  }

  .mini-stars-off {
    color: rgba(26, 26, 26, 0.2);
  }

  .fb-text {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .fb-tools {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
  }

  /* Settings */
  .se-details h2 {
    margin: 0 0 16px;
    font-family: var(--font-degulardisplay-bold);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .se-check {
    gap: 10px;
    margin-bottom: 20px;
    align-items: center;
    cursor: pointer;
  }

  .se-form-end {
    justify-content: flex-end;
  }

  .se-side {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .se-side :global(.side-card) {
    padding: 20px;
  }

  .se-side h3 {
    margin: 0 0 6px;
  }

  .se-card-head {
    align-items: center;
    margin-bottom: 8px;
  }

  .se-card-head h3 {
    margin: 0;
  }

  .se-card-text {
    margin: 0 0 12px;
  }

  .se-codes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 14px;
  }

  .se-codes > div {
    display: grid;
    gap: 4px;
    padding: 8px 12px;
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--r-card);
    background: #fff;
    text-align: center;
  }

  .se-codes span {
    font-family: var(--font-bergenmonoregular);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .se-codes b {
    font-family: var(--font-bergenmonoregular);
    font-size: 18px;
    font-weight: 800;
  }

  .code-make {
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .code-make input {
    width: 88px;
  }

  .danger-zone :global(.btn.danger) {
    background: var(--color-firecracker-red);
    border-color: var(--color-ink-black);
    color: #fff;
  }

  .word-form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
  }

  @media (max-width: 600px) {
    .word-form-row {
      grid-template-columns: 1fr !important;
      gap: 10px !important;
    }

    .pos-segmented-scroll {
      width: 100%;
      box-sizing: border-box;
    }

    .pos-segmented-scroll .segmented {
      display: flex !important;
      flex-wrap: nowrap !important;
      width: max-content !important;
    }

    .pos-segmented-scroll .segmented button {
      padding: 6px 12px !important;
      font-size: 13px !important;
      white-space: nowrap !important;
    }
  }

  /* Arrange board: long deck/lesson titles wrap inside their cards instead of spilling out. */
  .board-col {
    min-width: 0 !important;
  }

  .deck-head {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 8px !important;
  }

  .deck-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .deck-toolbar-gap {
    flex: 1;
  }

  .rename.deck-title,
  .rename.lesson-title {
    display: block !important;
    width: 100%;
    min-width: 0 !important;
    padding: 2px 4px !important;
    margin-left: -4px;
    white-space: normal !important;
    overflow-wrap: anywhere;
    text-align: left !important;
    text-decoration: none;
    line-height: 1.3;
  }

  .rename.deck-title {
    font-size: 16px !important;
  }

  .board-card {
    align-items: flex-start !important;
  }

  .lesson-handle {
    opacity: 0.5;
    margin-top: 4px;
  }

  .lesson-main {
    flex: 1 1 auto;
    min-width: 0;
  }

  .lesson-count {
    padding-left: 0;
  }

  .lesson-tools {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .fb-panel {
    max-width: 960px;
    margin: 0 auto;
  }

  .fb-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 16px;
    margin-bottom: 20px;
    border-bottom: 1.5px solid var(--line-card);
  }

  .fb-count {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 5px 12px;
    border: 1.5px solid var(--line-card);
    border-radius: var(--r-pill);
    font-family: var(--font-bergenmonoregular);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-60);
  }

  .fb-count b {
    font-size: 13px;
    color: var(--color-ink-black);
  }

  .fb-count.has-new {
    background: var(--color-hi-vis-yellow);
    border-color: var(--color-ink-black);
    color: var(--color-ink-black);
  }

  .fb-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .fb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 40px 24px;
    text-align: center;
    border: 1.5px dashed rgba(26, 26, 26, 0.25);
    border-radius: var(--r-card);
  }

  .fb-empty-icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 6px;
    border-radius: 50%;
    background: var(--color-matcha-cream);
    border: 2px solid var(--color-ink-black);
    color: var(--color-ink-black);
  }

  .fb-empty strong {
    font-size: 17px;
    font-weight: 800;
    color: var(--color-ink-black);
  }

  .fb-empty-text {
    max-width: 44ch;
    font-size: 14px;
    line-height: 1.45;
    color: var(--ink-60);
  }
</style>
