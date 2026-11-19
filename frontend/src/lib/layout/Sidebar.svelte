<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let user = $derived(appState.user);
  let hash = $derived(appState.hash);
  let topStats = $derived(appState.topStats);
  let dueCount = $derived(topStats?.due || 0);

  function isCurrent(key) {
    if (key === 'learn') {
      return hash === '#/' || hash === '#/learn' || hash.startsWith('#/learn/course') || hash.startsWith('#/learn/lesson');
    }
    if (key === 'review') return hash.startsWith('#/learn/review');
    if (key === 'discover') return hash.startsWith('#/discover');
    if (key === 'play') return hash.startsWith('#/play') || hash.startsWith('#/duel');
    if (key === 'leaderboard') return hash.startsWith('#/leaderboard');
    if (key === 'studio') return hash.startsWith('#/studio');
    if (key === 'admin') return hash.startsWith('#/admin');
    return false;
  }
</script>

<aside class="sidebar" id="sidebar">
  <a class="side-brand" href="#/learn" aria-label="Papercard home">
    <span class="brand-wordmark side">PAPERCARD</span>
  </a>

  <nav class="side-links" id="side-links" aria-label="Main">
    <a href="#/learn" class="side-pill" data-nav="learn" aria-current={isCurrent('learn') ? 'page' : undefined}>
      <Icon name="home" size={20} />
      <span>Home</span>
    </a>

    <a href="#/learn/review" class="side-pill" data-nav="review" aria-current={isCurrent('review') ? 'page' : undefined}>
      <Icon name="review" size={20} />
      <span>Review</span>
      {#if dueCount > 0}
        <span class="badge" title="{dueCount} cards due">{dueCount > 99 ? '99+' : dueCount}</span>
      {/if}
    </a>

    <a href="#/discover" class="side-pill" data-nav="discover" aria-current={isCurrent('discover') ? 'page' : undefined}>
      <Icon name="courses" size={20} />
      <span>Discover</span>
    </a>

    <a href="#/play" class="side-pill" data-nav="play" aria-current={isCurrent('play') ? 'page' : undefined}>
      <Icon name="play" size={20} />
      <span>Play</span>
    </a>

    <a href="#/leaderboard" class="side-pill" data-nav="leaderboard" aria-current={isCurrent('leaderboard') ? 'page' : undefined}>
      <Icon name="trophy" size={20} />
      <span>Leaders</span>
    </a>

    <a href="#/studio" class="side-pill" data-nav="studio" aria-current={isCurrent('studio') ? 'page' : undefined}>
      <Icon name="studio" size={20} />
      <span>Studio</span>
    </a>

    {#if user?.isAdmin}
      <a href="#/admin" class="side-pill" data-nav="admin" aria-current={isCurrent('admin') ? 'page' : undefined}>
        <Icon name="admin" size={20} />
        <span>Admin</span>
      </a>
    {/if}
  </nav>

  <div class="side-bottom" id="side-bottom">
    <button class="btn-gate-pill small" id="logout" title="Sign out" aria-label="Sign out" onclick={() => appState.logout()}>
      Sign out
    </button>
  </div>
</aside>
