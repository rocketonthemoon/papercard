<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);
  let filter = $state('all'); // 'all', 'learned', 'due', 'new'
  let query = $state('');

  onMount(async () => {
    try {
      loading = true;
      data = await api('/learn/words');
    } catch (e) {
      errorMsg = e.message || 'Failed to load words';
    } finally {
      loading = false;
    }
  });

  let units = $derived(data?.units || []);
  let stats = $derived(data?.stats || {});
  let now = $derived(data?.now || Date.now());
  let allWords = $derived(units.flatMap(u => (u.lessons || []).flatMap(l => l.words || [])));

  function status(w) {
    if (!w.learned) return 'new';
    if (w.dueAt && w.dueAt <= now) return 'due';
    return 'later';
  }

  const FILTERS = [
    ['all', 'All'],
    ['learned', 'Learned'],
    ['due', 'Due'],
    ['new', 'Not yet'],
  ];

  const STATUS = {
    new: { label: 'Not yet', cls: 'bone' },
    due: { label: 'Due', cls: 'pink' },
    later: { label: 'Learned', cls: 'matcha' },
  };

  function matches(w) {
    const s = status(w);
    const filterOk =
      filter === 'all' ||
      s === filter ||
      (filter === 'learned' && w.learned);

    if (!filterOk) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim();
    return `${w.lt || ''} ${w.en || ''}`.toLowerCase().includes(q);
  }

  let groups = $derived(
    units
      .map((u) => ({ id: u.id, title: u.title, words: (u.lessons || []).flatMap((l) => l.words || []).filter(matches) }))
      .filter((g) => g.words.length > 0)
  );
</script>

<div class="words-page">
  {#if loading}
    <p class="page-loading" role="status">Loading your words…</p>
  {:else if errorMsg}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Unable to load words</h2>
        <p class="muted">{errorMsg}</p>
      </header>
    </section>
  {:else}
    <div class="toolbar words-toolbar">
      <div class="page-head">
        <a class="back" href="#/learn">← Home</a>
        <p class="words-summary">
          {stats.learned || 0} of {allWords.length} learned · {stats.due || 0} due for review
        </p>
      </div>
      <div class="toolbar-actions">
        {#if stats.due}
          <a class="btn btn-gate-pill small" href="#/learn/review">Review {stats.due} now →</a>
        {/if}
      </div>
    </div>

    <section class="card words-filter">
      <div class="segmented" role="radiogroup" aria-label="Show">
        {#each FILTERS as [k, l] (k)}
          <button type="button" role="radio" aria-checked={filter === k} onclick={() => (filter = k)}>{l}</button>
        {/each}
      </div>
      <input type="search" class="input-box" placeholder="Search words…" aria-label="Search words" bind:value={query} />
    </section>

    {#each groups as g (g.id)}
      <section class="card word-deck-group">
        <h3>{g.title} <span class="mono-tag group-count">{g.words.length}</span></h3>
        <ul class="word-table">
          {#each g.words as w (w.id ?? w.lt)}
            {@const st = STATUS[status(w)]}
            <li class="word-row">
              <div class="word-main">
                <b lang="lt">{w.lt}</b>
                <span class="word-eq" aria-hidden="true">=</span>
                <span>{w.en}</span>
                {#if w.note}<span class="word-note">{w.note}</span>{/if}
              </div>
              <span class="pill sm {st.cls}">{st.label}</span>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <section class="card word-deck-group words-empty">
        <p>No words match {query.trim() ? `“${query.trim()}”` : 'this filter'}.</p>
      </section>
    {/each}
  {/if}
</div>

<style>
  .words-toolbar {
    margin-bottom: 16px;
  }

  .words-summary {
    margin: 4px 0 0;
    color: var(--color-ink-black);
  }

  .words-filter {
    display: grid;
    gap: 12px;
    margin-bottom: 24px;
  }

  .words-filter .input-box {
    width: 100%;
    box-sizing: border-box;
  }

  .word-deck-group {
    margin-bottom: 20px;
  }

  .word-deck-group h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 14px;
    font-size: 20px;
  }

  .group-count {
    font-size: 12px;
    opacity: 0.6;
  }

  .word-table {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .word-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: var(--color-bone-white);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--r-card);
  }

  .word-main {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .word-main b {
    font-size: 16px;
  }

  .word-eq {
    margin: 0 8px;
    opacity: 0.5;
  }

  .word-note {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    opacity: 0.7;
  }

  .words-empty p {
    margin: 0;
    text-align: center;
  }
</style>
