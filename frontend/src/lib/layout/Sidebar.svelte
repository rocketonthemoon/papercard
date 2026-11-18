<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let user = $derived(appState.user);
  let hash = $derived(appState.hash);
  let dueCount = $derived(appState.topStats?.due || 0);

  function isActive(prefix) {
    if (prefix === '#/learn') {
      return hash === '#/' || hash === '#/learn' || hash.startsWith('#/learn/course') || hash.startsWith('#/learn/lesson');
    }
    return hash.startsWith(prefix);
  }
</script>

<aside class="sidebar">
  <nav class="nav-links">
    <a href="#/learn" class="nav-item" class:active={isActive('#/learn')}>
      <Icon name="home" size={19} />
      <span>Home</span>
    </a>

    <a href="#/learn/review" class="nav-item" class:active={isActive('#/learn/review')}>
      <Icon name="review" size={19} />
      <span>Review</span>
      {#if dueCount > 0}
        <span class="badge" title="{dueCount} cards due">{dueCount > 99 ? '99+' : dueCount}</span>
      {/if}
    </a>

    <a href="#/learn/words" class="nav-item" class:active={isActive('#/learn/words')}>
      <Icon name="list" size={19} />
      <span>Words</span>
    </a>

    <a href="#/discover" class="nav-item" class:active={isActive('#/discover')}>
      <Icon name="courses" size={19} />
      <span>Courses</span>
    </a>

    <a href="#/play" class="nav-item" class:active={isActive('#/play') || hash.startsWith('#/duel')}>
      <Icon name="play" size={19} />
      <span>Play</span>
    </a>

    <a href="#/leaderboard" class="nav-item" class:active={isActive('#/leaderboard')}>
      <Icon name="trophy" size={19} />
      <span>Leaders</span>
    </a>

    <a href="#/studio" class="nav-item" class:active={isActive('#/studio')}>
      <Icon name="studio" size={19} />
      <span>Studio</span>
    </a>

    {#if user?.isAdmin}
      <a href="#/admin" class="nav-item" class:active={isActive('#/admin')}>
        <Icon name="admin" size={19} />
        <span>Admin</span>
      </a>
    {/if}
  </nav>

  <div class="sidebar-footer">
    <button class="sign-out-btn" onclick={() => appState.logout()}>
      <Icon name="logout" size={17} />
      <span>Sign out</span>
    </button>
  </div>
</aside>

<style>
  .sidebar {
    width: 210px;
    min-width: 210px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 24px 16px;
    background: transparent;
  }

  .nav-links {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: var(--radius-pill);
    color: var(--color-bone-white);
    font-weight: 700;
    font-size: 14px;
    transition: background-color 0.1s ease, color 0.1s ease;
    border: 1.5px solid transparent;
  }

  .nav-item:hover {
    background: rgba(249, 245, 242, 0.15);
    color: var(--color-hi-vis-yellow);
  }

  .nav-item.active {
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border-color: var(--color-ink-black);
  }

  .badge {
    margin-left: auto;
    background: var(--color-hi-vis-yellow);
    color: var(--color-ink-black);
    border: 1px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    padding: 1px 7px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 800;
  }

  .sidebar-footer {
    padding-top: 16px;
    border-top: 1px solid rgba(249, 245, 242, 0.2);
  }

  .sign-out-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 14px;
    border-radius: var(--radius-pill);
    color: rgba(249, 245, 242, 0.7);
    font-size: 13.5px;
    font-weight: 600;
    transition: color 0.1s ease;
  }

  .sign-out-btn:hover {
    color: var(--color-bone-white);
    background: rgba(249, 245, 242, 0.1);
  }

  @media (max-width: 768px) {
    .sidebar {
      display: none;
    }
  }
</style>
