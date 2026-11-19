<script>
  import { appState } from '../state.svelte.js';
  import { activeNav, navItemsFor } from '../routes.js';
  import Icon from '../components/Icon.svelte';

  let items = $derived(navItemsFor(appState.user));
  let current = $derived(activeNav(appState.hash));
  let dueCount = $derived(appState.topStats?.due || 0);
</script>

<aside class="sidebar" id="sidebar">
  <a class="side-brand" href="#/learn" aria-label="Papercard home">
    <span class="brand-wordmark side">PAPERCARD</span>
  </a>

  <nav class="side-links" id="side-links" aria-label="Main">
    {#each items as item (item.key)}
      <a href={item.href} class="side-pill" data-nav={item.key} aria-current={current === item.key ? 'page' : undefined}>
        <Icon name={item.icon} size={20} />
        <span>{item.label}</span>
        {#if item.key === 'review' && dueCount > 0}
          <span class="badge" title="{dueCount} cards due">{dueCount > 99 ? '99+' : dueCount}</span>
        {/if}
      </a>
    {/each}
  </nav>

  <div class="side-bottom" id="side-bottom">
    <button class="btn-gate-pill small" id="logout" onclick={() => appState.logout()}>
      Sign out
    </button>
  </div>
</aside>
