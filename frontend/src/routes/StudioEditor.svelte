<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let content = $state(null);
  let activeView = $state('content'); // 'content' | 'arrange' | 'settings'

  let selectedLessonId = $state(null);
  let editingWord = $state(null); // null or { id?, lt, en, pos, gender, also, note }
  let closedUnits = $state(new Set());

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

  $effect(() => {
    if (activeView === 'settings') {
      loadTokens();
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
    <div class="toolbar" style="margin-bottom:20px;">
      <div class="page-head">
        <a class="back mono-tag" href="#/studio">← Studio</a>
        <h1 style="margin:4px 0 2px;">{course.title}</h1>
        <p class="muted small mono-tag" style="margin:0;">
          {course.toLang} · {units.length} decks · {course.words} words · {course.learners || 0} learners
        </p>
      </div>

      <div class="toolbar-actions" style="display:flex;align-items:center;gap:12px;">
        <div class="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            class:selected={activeView === 'content'}
            onclick={() => activeView = 'content'}
          >
            Content
          </button>
          <button
            type="button"
            role="tab"
            class:selected={activeView === 'arrange'}
            onclick={() => activeView = 'arrange'}
          >
            Arrange
          </button>
          <button
            type="button"
            role="tab"
            class:selected={activeView === 'settings'}
            onclick={() => activeView = 'settings'}
          >
            Settings
          </button>
        </div>

        <a class="btn outline small" href="#/course/{course.id}">View</a>
        {#if activeView === 'content'}
          <button class="btn btn-gate-pill small" onclick={handleAddUnit}>+ New deck</button>
        {/if}
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
              <div class="segmented" role="radiogroup" aria-label="Part of speech" style="margin-bottom:14px;">
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

              <div class="form-two" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
                <label class="field">
                  {course.toLang}
                  <input
                    type="text"
                    maxlength="100"
                    bind:value={editingWord.lt}
                    required
                    style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
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
                    style="width:100%;padding:10px;margin-top:4px;border:2px solid #000;border-radius:4px;"
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
      <p class="muted small" style="margin-bottom:14px;">
        Arrange decks and lessons. Click names to rename in place. Use up/down controls in Content view or add lessons directly.
      </p>

      <div class="board" style="display:flex;gap:16px;overflow-x:auto;padding-bottom:16px;">
        {#each units as u, ui (u.id)}
          <section class="board-col card" style="min-width:260px;max-width:300px;padding:16px;display:flex;flex-direction:column;gap:12px;">
            <header class="board-col-head row spread" style="align-items:center;">
              <div class="row" style="gap:6px;align-items:center;">
                <span class="module-no mono-tag" style="font-weight:700;">{ui + 1}</span>
                <button class="rename linkbtn" onclick={() => handleEditUnit(u)} style="font-weight:700;text-align:left;">
                  {u.title}
                </button>
              </div>
              <div class="row" style="gap:4px;">
                {#if u.level}<span class="pill bone sm">{u.level}</span>{/if}
                <button class="icon-btn sm danger" onclick={() => handleDeleteUnit(u.id)} title="Delete deck">🗑</button>
              </div>
            </header>

            <ul class="board-cards" style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">
              {#each (u.lessons || []) as l (l.id)}
                <li class="board-card card" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;background:#fff;">
                  <div>
                    <button class="rename linkbtn" onclick={() => handleEditLesson(l)} style="font-weight:600;font-size:14px;text-align:left;">
                      {l.title}
                    </button>
                    <div class="muted small mono-tag">{(l.words || []).length} words</div>
                  </div>
                  <button
                    class="icon-btn sm"
                    title="Edit words in Content"
                    onclick={() => { selectedLessonId = l.id; activeView = 'content'; }}
                  >
                    →
                  </button>
                </li>
              {/each}
            </ul>

            <button
              class="linkbtn small"
              style="margin-top:auto;padding-top:8px;"
              onclick={() => handleAddLesson(u.id)}
            >
              + Add a lesson
            </button>
          </section>
        {/each}

        <!-- New Deck column -->
        <button
          class="board-col board-new card"
          style="min-width:220px;border:2px dashed #000;display:flex;align-items:center;justify-content:center;padding:24px;background:none;cursor:pointer;"
          onclick={handleAddUnit}
        >
          <b>+ New deck</b>
        </button>
      </div>
    {/if}

    <!-- VIEW 3: SETTINGS (1:1 with web/game.js:3163) -->
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
