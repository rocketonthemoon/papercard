<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let activeTab = $state('create'); // 'create' or 'join'
  let loading = $state(true);
  let errorMsg = $state('');

  let courses = $state([]);
  let currentCourse = $state(null);
  let units = $state([]);
  let pickedUnits = $state(new Set());
  let creating = $state(false);

  let joinCode = $state('');
  let myDuels = $state([]);

  function byLevel(us) {
    const groups = [];
    for (const u of us) {
      const lvl = u.level || '';
      const last = groups.at(-1);
      if (last && last[0] === lvl) last[1].push(u);
      else groups.push([lvl, [u]]);
    }
    return groups;
  }

  const unitWords = (u) => (u.lessons || []).reduce((n, l) => n + (l.total || 0), 0);
  const unitLearned = (u) => (u.lessons || []).reduce((n, l) => n + (l.done || 0), 0);

  async function loadDecks(cid) {
    try {
      loading = true;
      const res = await api(`/learn${cid ? `?course=${cid}` : ''}`);
      currentCourse = res.course;
      units = res.units || [];
      courses = res.myCourses || [];

      pickedUnits.clear();
      for (const u of units) {
        if (unitLearned(u) > 0) pickedUnits.add(u.id);
      }
      if (pickedUnits.size === 0 && units[0]) {
        pickedUnits.add(units[0].id);
      }
      pickedUnits = new Set(pickedUnits);
    } catch (e) {
      errorMsg = e.message || 'Failed to load decks';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      const [duelsData] = await Promise.all([
        api('/duels').catch(() => ({ duels: [] })),
        loadDecks(),
      ]);
      myDuels = duelsData.duels || [];
    } catch (e) {
      errorMsg = e.message || 'Failed to load lobby';
    }
  });

  function toggleUnit(uId) {
    if (pickedUnits.has(uId)) {
      pickedUnits.delete(uId);
    } else {
      pickedUnits.add(uId);
    }
    pickedUnits = new Set(pickedUnits);
  }

  function toggleLevelGroup(us) {
    const allSelected = us.every(u => pickedUnits.has(u.id));
    if (allSelected) {
      for (const u of us) pickedUnits.delete(u.id);
    } else {
      for (const u of us) pickedUnits.add(u.id);
    }
    pickedUnits = new Set(pickedUnits);
  }

  let totalWordsInPicked = $derived(
    units.filter(u => pickedUnits.has(u.id)).reduce((n, u) => n + unitWords(u), 0)
  );

  async function handleCreateRoom() {
    if (!currentCourse) {
      appState.showToast('Please start a course first');
      return;
    }
    if (pickedUnits.size === 0) {
      appState.showToast('Pick at least one deck');
      return;
    }

    try {
      creating = true;
      const res = await api('/duels', {
        method: 'POST',
        body: {
          courseId: currentCourse.id,
          unitIds: Array.from(pickedUnits),
        },
      });

      if (res.code) {
        appState.navigate(`#/duel/${res.code}`);
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to create duel';
      appState.showToast(errorMsg);
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

<div class="lobby">
  <section class="card picker">
    <header class="picker-head">
      <h2>Play a friend</h2>
      <p class="muted">Create a word duel and send the link, or join one with a code</p>
    </header>

    <div class="tiles two" role="tablist" aria-label="Duel modes">
      <button
        type="button"
        class="tile"
        role="tab"
        id="tab-create"
        aria-selected={activeTab === 'create'}
        onclick={() => activeTab = 'create'}
      >
        <span class="tile-icon"><Icon name="cards" size={24} /></span>
        <span class="tile-name">Create a room</span>
      </button>

      <button
        type="button"
        class="tile"
        role="tab"
        id="tab-join"
        aria-selected={activeTab === 'join'}
        onclick={() => activeTab = 'join'}
      >
        <span class="tile-icon"><Icon name="play" size={24} /></span>
        <span class="tile-name">Join a room</span>
      </button>
    </div>

    {#if activeTab === 'create'}
      <div class="pane" id="pane-create" role="tabpanel">
        {#if courses.length > 1}
          <label class="field" id="course-pick">
            Course
            <select
              id="duel-course"
              value={currentCourse?.id}
              onchange={(e) => loadDecks(Number(e.target.value))}
            >
              {#each courses as c}
                <option value={c.id}>{c.title}</option>
              {/each}
            </select>
          </label>
        {/if}

        <div class="row spread" style="margin:14px 0 10px;align-items:baseline;">
          <h3>Which decks?</h3>
          <span class="muted small mono-tag" id="deck-count">
            {pickedUnits.size ? `${pickedUnits.size} deck${pickedUnits.size > 1 ? 's' : ''} · ${totalWordsInPicked} words` : 'Pick at least one'}
          </span>
        </div>

        <div class="deck-picker" id="decks">
          {#if loading}
            <p class="muted">Loading decks…</p>
          {:else if !currentCourse}
            <p class="muted">Start a course first: <a href="#/discover">Discover courses</a>.</p>
          {:else}
            {#each byLevel(units) as [lvl, us], idx}
              {@const countSel = us.filter(u => pickedUnits.has(u.id)).length}
              <details class="deck-group" data-level-group={lvl} open={idx === 0}>
                <summary class="deck-group-summary">
                  <div class="row spread deck-summary-row">
                    <span class="deck-summary-title">
                      <b><span class="mono-tag" style="background:#ffd33d;padding:2px 8px;border-radius:100px;border:1.5px solid #000;margin-right:6px;">{lvl || 'General'}</span> <span class="deck-sel-count mono-tag">{countSel} of {us.length} selected</span></b>
                    </span>
                    <button
                      type="button"
                      class="linkbtn small select-all-btn"
                      onclick={(e) => { e.preventDefault(); e.stopPropagation(); toggleLevelGroup(us); }}
                    >
                      {countSel === us.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                </summary>
                <div class="deck-chips">
                  {#each us as u}
                    <label class="deck-chip">
                      <input
                        type="checkbox"
                        value={u.id}
                        checked={pickedUnits.has(u.id)}
                        onchange={() => toggleUnit(u.id)}
                      />
                      <span>
                        <b>{u.title}</b>
                        <small>{unitWords(u)} words{unitLearned(u) ? ` · ${unitLearned(u)} learned` : ''}</small>
                      </span>
                    </label>
                  {/each}
                </div>
              </details>
            {/each}
          {/if}
        </div>

        {#if errorMsg}
          <p id="create-error" class="error">{errorMsg}</p>
        {/if}

        <div class="pane-actions" style="margin-top:20px;padding-top:16px;border-top:1.5px solid rgba(22,21,29,0.1);">
          <span class="muted small mono-tag">10 RANDOM WORDS · YOU PLAY FIRST</span>
          <button
            class="btn btn-gate-pill"
            id="create"
            disabled={creating || pickedUnits.size === 0}
            onclick={handleCreateRoom}
          >
            {creating ? 'Creating...' : 'Create room →'}
          </button>
        </div>
      </div>
    {:else}
      <form class="pane" id="pane-join" role="tabpanel" onsubmit={handleJoinSubmit}>
        <label class="field">Room code
          <span class="row" style="gap:12px;margin-top:4px;">
            <input
              type="text"
              id="join-code"
              placeholder="e.g. K7QX4M"
              maxlength="6"
              autocomplete="off"
              style="flex:1;min-width:160px;text-transform:uppercase;letter-spacing:.12em"
              bind:value={joinCode}
            />
            <button class="btn btn-gate-pill">Join →</button>
          </span>
        </label>
      </form>
    {/if}
  </section>

  <div id="my-duels-wrap" class="lobby-rooms-wrap">
    <aside class="card list-card">
      <div class="list-head">
        <h3>Your rooms <span class="muted" id="duel-count">({myDuels.length})</span></h3>
      </div>
      <ul class="rows" id="my-duels">
        {#if myDuels.length === 0}
          <li class="empty-row"><span class="muted small">No duels played yet.</span></li>
        {:else}
          {#each myDuels as d}
            <li class="room-row">
              <a href="#/duel/{d.code}" class="row spread duel-row" style="width:100%;text-decoration:none;color:inherit;align-items:center;">
                <div class="room-info" style="display:flex;align-items:center;gap:10px;">
                  <span class="code-chip pill yellow mono-tag" style="font-size:12px;font-weight:900;padding:2px 8px;">{d.code}</span>
                  <div>
                    <span style="font-weight:600;font-size:14px;">{d.title || 'Duel'}</span>
                    <br />
                    <span class="muted small mono-tag">by {d.creator || 'Player'} · {d.players || 1} played</span>
                  </div>
                </div>
                <span class="btn small outline" style="font-weight:700;">
                  {d.myPoints != null ? `${d.myPoints} pts` : 'Play →'}
                </span>
              </a>
            </li>
          {/each}
        {/if}
      </ul>
    </aside>
  </div>
</div>
