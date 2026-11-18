<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let data = $state(null);
  let filter = $state('all'); // all, learned, due, new
  let searchQuery = $state('');

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
  let stats = $derived(data?.stats || null);
  let now = $derived(data?.now || Date.now());

  function wordStatus(w) {
    if (!w.learned) return 'new';
    if (w.dueAt && w.dueAt <= now) return 'due';
    return 'learned';
  }

  function matches(w) {
    const st = wordStatus(w);
    const passFilter =
      filter === 'all' ||
      st === filter ||
      (filter === 'learned' && w.learned);

    if (!passFilter) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.trim().toLowerCase();
    return (w.lt || '').toLowerCase().includes(q) || (w.en || '').toLowerCase().includes(q);
  }

  function playAudio(text) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'lt-LT';
    window.speechSynthesis.speak(u);
  }
</script>

<div class="words-view">
  <div class="words-top">
    <div>
      <a href="#/learn" class="back-link mono-tag">
        <Icon name="back" size={16} />
        <span>Learn</span>
      </a>
      {#if stats}
        <p class="muted small stats-summary">
          {stats.learned || 0} words learned · {stats.due || 0} due for review
        </p>
      {/if}
    </div>

    {#if stats?.due > 0}
      <a href="#/learn/review" class="btn primary sm">
        <Icon name="refresh" size={15} />
        <span>Review {stats.due} now</span>
      </a>
    {/if}
  </div>

  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading dictionary…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Unable to load words</h2>
      <p class="muted">{errorMsg}</p>
    </div>
  {:else}
    <!-- Filter bar -->
    <section class="card filter-card">
      <div class="filter-pills">
        {#each [['all', 'All'], ['learned', 'Learned'], ['due', 'Due'], ['new', 'Not yet']] as [k, label]}
          <button
            type="button"
            class="filter-btn"
            class:active={filter === k}
            onclick={() => filter = k}
          >
            {label}
          </button>
        {/each}
      </div>

      <input
        type="text"
        class="search-input"
        placeholder="Search Lithuanian or English..."
        bind:value={searchQuery}
      />
    </section>

    <!-- Units Words List -->
    <div class="units-words">
      {#each units as u}
        {@const filteredWords = (u.lessons || []).flatMap(l => l.words || []).filter(matches)}
        {#if filteredWords.length > 0}
          <section class="card unit-words-card">
            <header class="unit-words-head">
              <div class="unit-head-title">
                {#if u.level}
                  <span class="pill yellow">{u.level}</span>
                {/if}
                <h3>{u.title}</h3>
              </div>
              <span class="mono-tag muted small">
                {filteredWords.length} {filteredWords.length === 1 ? 'word' : 'words'}
              </span>
            </header>

            <ul class="words-table">
              {#each filteredWords as w}
                {@const st = wordStatus(w)}
                <li class="word-row">
                  <div class="word-primary">
                    <b class="lt-text">{w.lt}</b>
                    <button
                      type="button"
                      class="speaker-btn"
                      title="Listen"
                      onclick={() => playAudio(w.lt)}
                    >
                      <Icon name="speaker" size={15} />
                    </button>
                    {#if w.pos}
                      <span class="pill sm">{w.pos}</span>
                    {/if}
                  </div>

                  <div class="word-translation">
                    <span>{w.en}</span>
                    {#if w.note}
                      <small class="muted note-text">({w.note})</small>
                    {/if}
                  </div>

                  <div class="word-status">
                    {#if st === 'due'}
                      <span class="pill pink sm">DUE</span>
                    {:else if st === 'learned'}
                      <span class="pill matcha sm">LEARNED</span>
                    {:else}
                      <span class="pill sm">NEW</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .words-view {
    max-width: 780px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .words-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .stats-summary {
    color: var(--color-bone-white);
    margin-top: 4px;
  }

  .filter-card {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
  }

  .filter-pills {
    display: flex;
    gap: 6px;
  }

  .filter-btn {
    padding: 6px 14px;
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--color-ink-black);
    background: var(--color-bone-white);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .filter-btn:hover {
    background: rgba(244, 237, 54, 0.4);
  }

  .filter-btn.active {
    background: var(--color-hi-vis-yellow);
  }

  .search-input {
    flex: 1;
    min-width: 200px;
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    padding: 6px 14px;
    font-family: inherit;
    font-size: 13.5px;
  }

  .units-words {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .unit-words-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .unit-words-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1.5px solid rgba(26, 26, 26, 0.1);
  }

  .unit-head-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .unit-head-title h3 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
  }

  .words-table {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
  }

  .word-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid rgba(26, 26, 26, 0.1);
    border-radius: var(--radius-card);
  }

  @media (max-width: 580px) {
    .word-row {
      grid-template-columns: 1fr auto;
    }
    .word-translation {
      grid-column: 1 / -1;
    }
  }

  .word-primary {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .lt-text {
    font-family: var(--font-display);
    font-size: 16px;
  }

  .speaker-btn {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--ink-60);
    display: inline-flex;
    align-items: center;
  }

  .speaker-btn:hover {
    color: var(--color-ink-black);
  }

  .word-translation {
    font-size: 14px;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .note-text {
    font-style: italic;
  }
</style>
