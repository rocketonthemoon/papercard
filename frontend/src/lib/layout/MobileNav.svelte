<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let user = $derived(appState.user);
  let hash = $derived(appState.hash);

  function isCurrent(key) {
    if (key === 'learn') {
      return hash === '#/' || hash === '#/learn' || hash.startsWith('#/learn/course') || hash.startsWith('#/learn/lesson');
    }
    if (key === 'review') return hash.startsWith('#/learn/review');
    if (key === 'discover') return hash.startsWith('#/discover');
    if (key === 'play') return hash.startsWith('#/play') || hash.startsWith('#/duel');
    if (key === 'studio') return hash.startsWith('#/studio');
    return false;
  }
</script>

<nav class="mobile-nav" id="mobile-nav">
  <a href="#/learn" class="mobile-tab-item" class:active={isCurrent('learn')} aria-current={isCurrent('learn') ? 'page' : undefined}>
    <Icon name="home" size={20} />
    <span>Home</span>
  </a>

  <a href="#/learn/review" class="mobile-tab-item" class:active={isCurrent('review')} aria-current={isCurrent('review') ? 'page' : undefined}>
    <Icon name="review" size={20} />
    <span>Review</span>
  </a>

  <a href="#/discover" class="mobile-tab-item" class:active={isCurrent('discover')} aria-current={isCurrent('discover') ? 'page' : undefined}>
    <Icon name="courses" size={20} />
    <span>Courses</span>
  </a>

  <a href="#/play" class="mobile-tab-item" class:active={isCurrent('play')} aria-current={isCurrent('play') ? 'page' : undefined}>
    <Icon name="play" size={20} />
    <span>Play</span>
  </a>

  {#if user?.isAdmin}
    <a href="#/admin" class="mobile-tab-item" class:active={hash.startsWith('#/admin')} aria-current={hash.startsWith('#/admin') ? 'page' : undefined}>
      <Icon name="admin" size={20} />
      <span>Admin</span>
    </a>
  {:else}
    <a href="#/studio" class="mobile-tab-item" class:active={isCurrent('studio')} aria-current={isCurrent('studio') ? 'page' : undefined}>
      <Icon name="studio" size={20} />
      <span>Studio</span>
    </a>
  {/if}
</nav>
