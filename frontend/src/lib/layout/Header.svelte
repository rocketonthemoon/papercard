<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let user = $derived(appState.user);
  let topStats = $derived(appState.topStats);
  let hash = $derived(appState.hash);

  const TITLES = {
    learn: 'Home',
    review: 'Review',
    discover: 'Discover',
    play: 'Play',
    leaderboard: 'Leaderboard',
    studio: 'Studio',
    admin: 'Admin',
    words: 'Your Words'
  };

  let pageTitle = $derived(() => {
    if (hash.startsWith('#/learn/course')) return 'Course Path';
    if (hash.startsWith('#/learn/lesson')) return 'Lesson';
    if (hash.startsWith('#/learn/review')) return 'Review';
    if (hash.startsWith('#/learn/words')) return 'Your Words';
    if (hash.startsWith('#/learn')) return 'Home';
    if (hash.startsWith('#/play') || hash.startsWith('#/duel')) return 'Play';
    if (hash.startsWith('#/leaderboard')) return 'Leaderboard';
    if (hash.startsWith('#/discover')) return 'Discover';
    if (hash.startsWith('#/studio')) return 'Studio';
    if (hash.startsWith('#/admin')) return 'Admin';
    if (hash.startsWith('#/u/')) return 'Profile';
    return '';
  });

  function getAvatarLetter(u) {
    if (!u) return '?';
    return (u.name || u.handle || u.username || '?').trim().charAt(0).toUpperCase();
  }
</script>

<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="#/" aria-label="Papercard home">
      <span class="brand-wordmark">PAPERCARD</span>
    </a>

    {#if user}
      <h1 class="page-title" id="page-title">{pageTitle()}</h1>
    {/if}

    <nav class="links" aria-label="Main">
      {#if !user}
        <a href="#/about" class="link-item">About</a>
        <a href="https://github.com/rocketonthemoon/papercard" target="_blank" rel="noopener noreferrer" class="link-item">GitHub</a>
      {/if}
    </nav>

    <div id="top-chips" class="top-chips">
      {#if user && topStats}
        <span class="top-chip stat-chip mono-tag" title="Day streak">
          <Icon name="fire" size={16} />
          <b>{topStats.streak || 0}d</b>
        </span>
      {/if}
    </div>

    <div id="account" class="account">
      {#if user}
        <a
          class="who-pill profile-pill"
          href="#/u/{user.username || user.handle || user.name}"
          title="Your profile (@{user.username || user.handle || user.name})"
        >
          <span class="avatar" aria-hidden="true">
            {#if user.picture}
              <img src={user.picture} alt="" referrerpolicy="no-referrer" />
            {:else}
              {getAvatarLetter(user)}
            {/if}
          </span>
          <span>{user.name}</span>
        </a>
      {:else if hash !== '#/' && hash !== '#/landing' && hash !== ''}
        <a href="#/" class="btn btn-gate-pill small">Sign In</a>
      {/if}
    </div>
  </div>
</header>
