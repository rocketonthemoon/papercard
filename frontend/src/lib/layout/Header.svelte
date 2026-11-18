<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let user = $derived(appState.user);
  let topStats = $derived(appState.topStats);

  function getAvatarLetter(u) {
    if (!u) return '?';
    return (u.name || u.handle || '?').trim().charAt(0).toUpperCase();
  }
</script>

<header class="topbar">
  <div class="topbar-inner">
    <div class="left-group">
      <a href="#/learn" class="brand">PAPERCARD</a>
    </div>

    {#if user}
      <div class="right-group">
        {#if topStats}
          <div class="stat-chips">
            <span class="chip streak" title="Day streak">
              <Icon name="fire" size={16} />
              <b>{topStats.streak || 0}d</b>
            </span>
            {#if topStats.hearts !== undefined}
              <span class="chip hearts" title="Hearts">
                <Icon name="heart" size={16} />
                <b>{topStats.hearts}</b>
              </span>
            {/if}
          </div>
        {/if}

        <a href="#/u/{user.handle || user.name}" class="avatar-link" title="Profile">
          {#if user.picture}
            <img src={user.picture} alt={user.name} class="avatar-img" referrerpolicy="no-referrer" />
          {:else}
            <span class="avatar-fallback">{getAvatarLetter(user)}</span>
          {/if}
        </a>
      </div>
    {:else}
      <div class="right-group">
        <a href="#/" class="btn sm primary">Sign In</a>
      </div>
    {/if}
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    height: 56px;
    background: var(--color-dusk-violet);
    border-bottom: var(--border-thick);
    display: flex;
    align-items: center;
    padding: 0 20px;
  }

  .topbar-inner {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .brand {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 19px;
    letter-spacing: -0.03em;
    color: var(--color-bone-white);
    text-transform: uppercase;
  }

  .brand:hover {
    color: var(--color-hi-vis-yellow);
  }

  .right-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .stat-chips {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--color-bone-white);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-ink-black);
  }

  .chip b {
    font-weight: 700;
  }

  .avatar-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    overflow: hidden;
    background: var(--color-bone-white);
    transition: transform 0.1s ease;
  }

  .avatar-link:hover {
    transform: scale(1.08);
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-fallback {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    color: var(--color-ink-black);
  }
</style>
