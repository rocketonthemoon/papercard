<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

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
    <p class="muted loading" style="text-align:center;padding:60px 0;">Loading studio…</p>
  {:else if errorMsg || !course}
    <section class="card picker" style="max-width:540px;margin:20px auto;">
      <header class="picker-head">
        <h2>Unable to load course</h2>
        <p class="muted">{errorMsg || 'Course not found'}</p>
      </header>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <a class="btn btn-gate-pill" href="#/studio">Back to Studio</a>
      </div>
    </section>
  {:else}
    <!-- Studio Top Toolbar (1:1 with web/game.js:2986) -->
    <div class="toolbar" style="margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">
      <div class="page-head" style="flex:1 1 auto;min-width:240px;">
        <a class="back mono-tag" href="#/studio">← Studio</a>
        <h1 style="margin:4px 0 2px;">{course.title}</h1>
        <p class="muted small mono-tag" style="margin:0;">
          {course.toLang} · {units.length} decks · {course.words} words · {course.learners || 0} learners
        </p>
      </div>

      <div class="toolbar-actions" style="display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <div class="segmented" role="tablist">
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
                    <button class="icon-btn sm" title="Move up" onclick={() => handleMove('unit', u.id, -1)}>↑</button>
                    <button class="icon-btn sm" title="Move down" onclick={() => handleMove('unit', u.id, 1)}>↓</button>
                    <button class="icon-btn sm" title="Edit deck" onclick={() => handleEditUnit(u)}>✎</button>
                    <button class="icon-btn sm danger" title="Delete deck" onclick={() => handleDeleteUnit(u.id)}>🗑</button>
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
                            <button class="icon-btn sm" title="Rename lesson" onclick={() => handleEditLesson(l)}>✎</button>
                            <button class="icon-btn sm danger" title="Delete lesson" onclick={() => handleDeleteLesson(l.id)}>🗑</button>
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
              <li class="muted small" style="padding:16px;">No decks yet. Add one with “New deck”!</li>
            {/each}
          </ul>
        </aside>

        <!-- Right: CMS Main Area -->
        <section class="card cms-main" id="cms-main">
          {#if editingWord}
            <!-- Word Form (1:1 with web/game.js:3460) -->
            <div class="list-head" style="margin-bottom:16px;">
              <h2>{editingWord.id ? 'Edit word' : 'New word'}</h2>
              <button class="btn outline small" type="button" onclick={() => editingWord = null}>Cancel</button>
            </div>

            <form class="form" onsubmit={handleSaveWord}>
              <div class="pos-segmented-scroll" style="overflow-x:auto;max-width:100%;padding-bottom:4px;margin-bottom:14px;-webkit-overflow-scrolling:touch;">
                <div class="segmented" role="radiogroup" aria-label="Part of speech" style="white-space:nowrap;display:inline-flex;">
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
                <label class="field" style="margin-bottom:14px;display:block;">
                  Gender
                  <select
                    bind:value={editingWord.gender}
                    style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
                  >
                    <option value="">(none)</option>
                    {#each Object.entries(GENDERS) as [k, l]}
                      <option value={k}>{l}</option>
                    {/each}
                  </select>
                </label>
              {/if}

              <label class="field" style="margin-bottom:14px;display:block;">
                Also accepted <span class="muted small">(other correct answers, separated by ;)</span>
                <input
                  type="text"
                  maxlength="200"
                  bind:value={editingWord.also}
                  placeholder="e.g. knygelė; leidinys"
                  style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
                />
              </label>

              <label class="field" style="margin-bottom:14px;display:block;">
                Note <span class="muted small">(shown after answer: usage tip, example...)</span>
                <input
                  type="text"
                  maxlength="200"
                  bind:value={editingWord.note}
                  placeholder="e.g. Informal slang"
                  style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
                />
              </label>

              <div class="pane-actions row spread" style="margin-top:20px;padding-top:14px;border-top:1.5px solid rgba(0,0,0,0.1);align-items:center;">
                <span class="muted small">Matching ignores capitals and punctuation.</span>
                <button type="submit" class="btn btn-gate-pill small">Save word</button>
              </div>
            </form>
          {:else if currentLesson}
            <!-- Lesson Words View (1:1 with web/game.js:3046) -->
            <div class="list-head" style="margin-bottom:12px;">
              <div>
                <span class="muted small mono-tag">{currentLesson.unitTitle}</span>
                <h2 style="margin:2px 0 0;">{currentLesson.title}</h2>
              </div>
              <button class="btn btn-gate-pill small" onclick={startNewWord}>+ Add word</button>
            </div>

            <p class="muted small" style="margin-bottom:18px;">
              Each word becomes four exercises: pick its meaning, pick the {course.toLang}, type it, or build it from tiles.
            </p>

            <ul class="rows" style="list-style:none;padding:0;margin:0;">
              {#each (currentLesson.words || []) as w, i (w.id)}
                <li class="ch-row row spread" style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.06);align-items:center;">
                  <div class="row" style="gap:12px;align-items:baseline;">
                    <span class="badge {w.pos}" style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase;">
                      {POS_LABELS[w.pos] || w.pos}
                    </span>
                    <div>
                      <b>{i + 1}. {w.lt}</b>
                      <span class="muted" style="margin-left:6px;">= {w.en}</span>
                      {#if GENDERS[w.gender]}
                        <span class="pill bone small" style="margin-left:6px;font-size:11px;">{GENDERS[w.gender]}</span>
                      {/if}
                      {#if w.also || w.note}
                        <p class="muted small" style="margin:4px 0 0;">
                          {#if w.also}<span>Also accepted: {w.also}</span>{/if}
                          {#if w.also && w.note} · {/if}
                          {#if w.note}<span>{w.note}</span>{/if}
                        </p>
                      {/if}
                    </div>
                  </div>

                  <!-- Word tools -->
                  <span class="tools" style="display:flex;gap:4px;">
                    <button class="icon-btn sm" title="Move up" onclick={() => handleMove('word', w.id, -1)}>↑</button>
                    <button class="icon-btn sm" title="Move down" onclick={() => handleMove('word', w.id, 1)}>↓</button>
                    <button class="icon-btn sm" title="Edit word" onclick={() => startEditWord(w)}>✎</button>
                    <button class="icon-btn sm danger" title="Delete word" onclick={() => handleDeleteWord(w.id)}>🗑</button>
                  </span>
                </li>
              {:else}
                <li class="empty-row" style="padding:24px 0;text-align:center;">
                  <span class="muted small">No words yet. Click "+ Add word" to add your first word!</span>
                </li>
              {/each}
            </ul>
          {:else}
            <div style="padding:40px 0;text-align:center;">
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
      <p class="muted arrange-help" style="margin-bottom:14px;font-size:13px;">
        Drag lessons to reorder them or move them between decks. Use ← and → or drag a deck to reorder decks. Click a name to rename.
      </p>

      <div class="board" id="board" role="list" aria-label="Decks" style="display:flex;gap:16px;overflow-x:auto;padding-bottom:16px;align-items:flex-start;">
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
                <button type="button" class="icon-btn sm danger" onclick={() => handleDeleteUnit(u.id)} title="Delete deck">🗑</button>
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
              style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;min-height:40px;"
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
            <form class="board-add" onsubmit={(e) => handleQuickAddLesson(e, u.id)} style="margin-top:auto;">
              <input
                type="text"
                maxlength="80"
                placeholder="+ Add a lesson (Enter to save)"
                aria-label="New lesson in {u.title}"
                style="width:100%;padding:8px 10px;font-size:13px;border:1.5px dashed var(--color-ink-black);border-radius:4px;box-sizing:border-box;background:#fff;"
              />
            </form>
          </section>
        {/each}

        <!-- Quick Add New Deck column -->
        <form
          class="board-col board-new card"
          id="board-new-deck"
          onsubmit={handleQuickAddUnit}
          style="min-width:240px;max-width:260px;border:2px dashed var(--color-ink-black);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:none;box-sizing:border-box;gap:10px;"
        >
          <input
            type="text"
            maxlength="80"
            placeholder="+ New deck (Enter)"
            aria-label="New deck"
            style="width:100%;padding:10px 12px;font-size:14px;border:1.5px solid var(--color-ink-black);border-radius:4px;box-sizing:border-box;background:#fff;"
          />
          <button type="submit" class="btn btn-gate-pill small" style="width:100%;">Create deck</button>
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
          <p class="muted loading" style="text-align:center;padding:30px;">Loading suggestions…</p>
        {:else}
          <ul class="fb-list">
            {#each (feedbackData.items || []) as f (f.id)}
              <li class="fb-row card {f.status}" style="padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;background:#fff;border:1.5px solid var(--color-ink-black);">
                <div style="flex:1 1 auto;min-width:0;">
                  <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
                    <a href="#/u/{f.username}" style="font-weight:700;color:var(--color-ink-black);"><b>{f.user}</b></a>
                    <span class="muted small">on <b>{f.unitTitle}</b></span>
                    {#if f.rating}
                      <span class="mini-stars" aria-label="{f.rating} of 5 stars" style="color:#f4ed36;letter-spacing:1px;font-size:16px;">
                        {'★'.repeat(f.rating)}<span style="color:#ccc;">{'★'.repeat(Math.max(0, 5 - f.rating))}</span>
                      </span>
                    {/if}
                    {#if f.category}
                      <span class="pill bone small mono-tag">{f.category}</span>
                    {/if}
                  </div>
                  <p style="margin:0;font-size:14px;line-height:1.4;">{f.text}</p>
                </div>

                <div class="tools" style="display:flex;gap:6px;flex-shrink:0;">
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
                    onclick={() => handleDeleteFeedback(f.id)}
                  >
                    🗑
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
      <div class="settings-grid" style="display:grid;grid-template-columns:1fr 340px;gap:24px;">
        <form class="card form" onsubmit={handleSaveSettings} style="padding:24px;">
          <h2 style="margin-top:0;">Course details</h2>

          <label class="field" style="margin-bottom:14px;display:block;">
            Course title
            <input
              type="text"
              maxlength="80"
              bind:value={settingsTitle}
              required
              style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
            />
          </label>

          <label class="field" style="margin-bottom:14px;display:block;">
            Description
            <textarea
              maxlength="400"
              bind:value={settingsDesc}
              rows="3"
              style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
            ></textarea>
          </label>

          <label class="check row" style="gap:10px;margin-bottom:20px;cursor:pointer;align-items:center;">
            <input type="checkbox" bind:checked={settingsLocked} />
            <span>
              <b>Locked</b>: learners need an access code to start the course.
            </span>
          </label>

          <div class="row" style="justify-content:flex-end;">
            <button class="btn btn-gate-pill small" type="submit">Save details</button>
          </div>
        </form>

        <aside class="stack-sm" style="display:flex;flex-direction:column;gap:16px;">
          <!-- Access codes card -->
          <section class="card side-card codes-card" style="padding:20px;">
            <div class="widget-head row spread" style="align-items:center;margin-bottom:8px;">
              <h3 style="margin:0;">Access codes</h3>
              {#if course.locked}
                <span class="pill yellow small">locked</span>
              {:else}
                <span class="pill bone small">open</span>
              {/if}
            </div>

            <p class="muted small" style="margin-bottom:12px;">
              Each code opens the course once, for one learner.
            </p>

            <div class="stat-row two row spread" style="margin-bottom:14px;border:1px solid rgba(0,0,0,0.1);padding:8px 12px;border-radius:4px;">
              <div><span class="muted small mono-tag">Unused</span> <b style="font-size:16px;">{tokenStats?.unused ?? '…'}</b></div>
              <div><span class="muted small mono-tag">Used</span> <b style="font-size:16px;">{tokenStats?.used ?? '…'}</b></div>
            </div>

            <form onsubmit={handleCreateTokens} class="code-make row" style="gap:8px;margin-bottom:12px;">
              <input
                type="number"
                min="1"
                max="500"
                bind:value={tokenCount}
                style="width:80px;padding:6px;border:1.5px solid #000;border-radius:4px;"
              />
              <button class="btn outline small" type="submit">Generate codes</button>
            </form>
          </section>

          <!-- Export .db card -->
          <section class="card side-card" style="padding:20px;">
            <h3 style="margin-top:0;">Export course</h3>
            <p class="muted small" style="margin-bottom:12px;">
              Download the entire course as an SQLite file.
            </p>
            <a class="btn outline small" href="/api/courses/{course.id}/export" download>
              Export .db
            </a>
          </section>

          <!-- Delete card -->
          <section class="card side-card danger-zone" style="padding:20px;border-color:#d32f2f;">
            <h3 style="margin-top:0;color:#d32f2f;">Delete course</h3>
            <p class="muted small" style="margin-bottom:12px;">
              Permanently deletes all decks, lessons, words, and learner progress.
            </p>
            <button class="btn danger small" onclick={handleDeleteCourse} style="background:#d32f2f;color:#fff;">
              Delete course
            </button>
          </section>
        </aside>
      </div>
    {/if}
  {/if}
</div>


<style>
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
