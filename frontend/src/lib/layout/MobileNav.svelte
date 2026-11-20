<script>
  import { appState } from '../state.svelte.js';
  import { activeNav, mobileNavItemsFor } from '../routes.js';
  import Icon from '../components/Icon.svelte';

  let items = $derived(mobileNavItemsFor(appState.user));
  let current = $derived(activeNav(appState.hash));
  let dueCount = $derived(appState.topStats?.due || 0);
</script>

<nav class="mobile-nav" id="mobile-nav" aria-label="Main">
  {#each items as item (item.key)}
    <a href={item.href} class="mobile-tab-item" aria-current={current === item.key ? 'page' : undefined}>
      <span class="mobile-tab-icon">
        <Icon name={item.icon} size={20} />
        {#if item.key === 'review' && dueCount > 0}
          <span class="badge-dot" aria-label="{dueCount} due">{dueCount > 99 ? '99+' : dueCount}</span>
        {/if}
      </span>
      <span class="mobile-tab-label">{item.label}</span>
    </a>
  {/each}
</nav>
