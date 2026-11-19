<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

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
</script>

<div>
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:40px 0;">Loading your words…</p>
  {:else if errorMsg}
    <section class="card picker" style="max-width:540px;margin:20px auto;">
      <header class="picker-head">
        <h2>Unable to load words</h2>
        <p class="muted">{errorMsg}</p>
      </header>
    </section>
  {:else}
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="page-head">
        <a class="back mono-tag" href="#/learn" style="text-decoration:none;color:inherit;font-weight:700;">
          ← Home
        </a>
        <p class="muted" style="margin-top:4px;">
          {stats.learned || 0} of {allWords.length} learned · {stats.due || 0} due for review
        </p>
      </div>
      <div class="toolbar-actions">
        {#if stats.due}
          <a class="btn btn-gate-pill small" href="#/learn/review">Review {stats.due} now →</a>
        {/if}
      </div>
    </div>

    <section class="card words-filter" style="margin-bottom:24px;">
      <div class="segmented" role="radiogroup" aria-label="Show" style="margin-bottom:12px;">
        {#each [['all', 'All'], ['learned', 'Learned'], ['due', 'Due'], ['new', 'Not yet']] as [k, l]}
          <button
            type="button"
            role="radio"
            aria-checked={filter === k}
            onclick={() => filter = k}
          >
            {l}
          </button>
        {/each}
      </div>

      <input
        type="search"
        class="input-box"
        placeholder="Search words..."
        style="width:100%;padding:10px 14px;border:2px solid #000;border-radius:6px;"
        bind:value={query}
      />
    </section>

    <!-- Word list by unit -->
    {#each units as u}
      {@const uWords = (u.lessons || []).flatMap(l => l.words || []).filter(matches)}
      {#if uWords.length > 0}
        <div class="card word-deck-group" style="margin-bottom:20px;">
          <h3 style="margin-bottom:14px;font-family:var(--font-display);font-size:20px;">{u.title}</h3>
          <div class="word-table" style="display:flex;flex-direction:column;gap:8px;">
            {#each uWords as w}
              <div class="row spread" style="padding:10px 14px;background:#f9f5f2;border:1.5px solid #000;border-radius:6px;box-shadow:0 2px 0 #000;">
                <div>
                  <b style="font-size:16px;">{w.lt}</b>
                  <span class="muted" style="margin:0 8px;">=</span>
                  <span>{w.en}</span>
                  {#if w.note}
                    <span class="muted small" style="display:block;margin-top:2px;">{w.note}</span>
                  {/if}
                </div>
                <div>
                  {#if !w.learned}
                    <span class="pill bone sm">Not yet</span>
                  {:else if w.dueAt && w.dueAt <= now}
                    <span class="pill pink sm">Due</span>
                  {:else}
                    <span class="pill matcha sm">Learned</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  {/if}
</div>
