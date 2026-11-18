<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let hash = $derived(appState.hash);
  let dueCount = $derived(appState.topStats?.due || 0);

  function isActive(prefix) {
    if (prefix === '#/learn') {
      return hash === '#/' || hash === '#/learn' || hash.startsWith('#/learn/course') || hash.startsWith('#/learn/lesson');
    }
    return hash.startsWith(prefix);
  }
</script>

<nav class="mobile-nav">
  <a href="#/learn" class="tab" class:active={isActive('#/learn')}>
    <div class="icon-wrap">
      <Icon name="home" size={20} />
    </div>
    <span>Home</span>
  </a>

  <a href="#/learn/review" class="tab" class:active={isActive('#/learn/review')}>
    <div class="icon-wrap">
      <Icon name="review" size={20} />
      {#if dueCount > 0}
        <span class="badge-dot">{dueCount > 99 ? '99+' : dueCount}</span>
      {/if}
    </div>
    <span>Review</span>
  </a>

  <a href="#/discover" class="tab" class:active={isActive('#/discover')}>
    <div class="icon-wrap">
      <Icon name="courses" size={20} />
    </div>
    <span>Courses</span>
  </a>

  <a href="#/play" class="tab" class:active={isActive('#/play') || hash.startsWith('#/duel')}>
    <div class="icon-wrap">
      <Icon name="play" size={20} />
    </div>
    <span>Play</span>
  </a>

  <a href="#/leaderboard" class="tab" class:active={isActive('#/leaderboard')}>
    <div class="icon-wrap">
      <Icon name="trophy" size={20} />
    </div>
    <span>Leaders</span>
  </a>

  <a href="#/studio" class="tab" class:active={isActive('#/studio')}>
    <div class="icon-wrap">
      <Icon name="studio" size={20} />
    </div>
    <span>Studio</span>
  </a>
</nav>

<style>
  .mobile-nav {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: var(--color-bone-white);
    border-top: var(--border-thick);
    z-index: 60;
    padding: 0 4px;
    justify-content: space-around;
    align-items: center;
  }

  @media (max-width: 768px) {
    .mobile-nav {
      display: flex;
    }
  }

  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    height: 100%;
    color: var(--color-ink-black);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.65;
    transition: opacity 0.1s ease, color 0.1s ease;
  }

  .tab.active {
    opacity: 1;
    color: var(--color-ink-black);
  }

  .tab.active .icon-wrap {
    transform: translateY(-2px);
  }

  .icon-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 2px;
    transition: transform 0.1s ease;
  }

  .badge-dot {
    position: absolute;
    top: -4px;
    right: -8px;
    background: var(--color-hi-vis-yellow);
    border: 1px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    font-size: 9px;
    font-weight: 800;
    font-family: var(--font-mono);
    padding: 0 4px;
  }
</style>
