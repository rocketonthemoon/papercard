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
    gap: 8px;
  }

  .filter-btn {
    padding: 6px 16px;
    border-radius: var(--radius-pill);
    border: var(--border-thick);
    background: var(--color-bone-white);
    font-size: 13px;
    font-weight: 800;
    box-shadow: 0 2px 0 var(--color-ink-black);
    cursor: pointer;
    transition: transform 0.08s ease, box-shadow 0.08s ease, background-color 0.1s ease;
  }

  .filter-btn:hover {
    background: var(--color-buttery-yellow);
    transform: translateY(-1px);
    box-shadow: 0 3px 0 var(--color-ink-black);
  }

  .filter-btn.active {
    background: var(--color-hi-vis-yellow);
    box-shadow: 0 2px 0 var(--color-ink-black);
  }

  .search-input {
    flex: 1;
    min-width: 220px;
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    padding: 8px 16px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    background: var(--color-bone-white);
    box-shadow: 0 2px 0 var(--color-ink-black);
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
    gap: 14px;
    padding: 10px 14px;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    box-shadow: 0 2px 0 var(--color-ink-black);
    transition: transform 0.08s ease, box-shadow 0.08s ease;
  }

  .word-row:hover {
    transform: translateX(2px);
    box-shadow: 0 3px 0 var(--color-ink-black);
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
    gap: 10px;
  }

  .lt-text {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
  }

  .speaker-btn {
    border: 1.5px solid var(--color-ink-black);
    border-radius: 50%;
    width: 28px;
    height: 28px;
    background: var(--color-bone-white);
    box-shadow: 0 1px 0 var(--color-ink-black);
    cursor: pointer;
    color: var(--color-ink-black);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.08s ease, background 0.1s ease;
  }

  .speaker-btn:hover {
    background: var(--color-hi-vis-yellow);
    transform: scale(1.08);
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
