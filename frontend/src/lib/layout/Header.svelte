<script>
  import { appState } from '../state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import { pageTitle, avatarLetter, profileHref } from '../routes.js';

  let user = $derived(appState.user);
  let topStats = $derived(appState.topStats);
  let hash = $derived(appState.hash);
  let title = $derived(pageTitle(hash));
</script>

<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="#/" aria-label="Papercard home">
      <span class="brand-wordmark">PAPERCARD</span>
    </a>

    {#if user}
      <h1 class="page-title" id="page-title">{title}</h1>
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
          href={profileHref(user)}
          title="Your profile"
        >
          <span class="avatar" aria-hidden="true">
            {#if user.picture}
              <img src={user.picture} alt="" referrerpolicy="no-referrer" />
            {:else}
              {avatarLetter(user)}
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
