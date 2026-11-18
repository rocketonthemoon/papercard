<script>
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';
  import MobileNav from './MobileNav.svelte';
  import Toast from '../components/Toast.svelte';
  import { appState } from '../state.svelte.js';

  let { children } = $props();
  let user = $derived(appState.user);
</script>

<div class="app-layout">
  <Header />

  <div class="layout-body">
    {#if user}
      <Sidebar />
    {/if}

    <main class="main-content" class:full-width={!user}>
      {@render children()}
    </main>
  </div>

  {#if user}
    <MobileNav />
  {/if}

  <Toast />
</div>

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--color-dusk-violet);
  }

  .layout-body {
    flex: 1;
    display: flex;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding-bottom: 70px; /* space for mobile nav */
  }

  @media (min-width: 769px) {
    .layout-body {
      padding-bottom: 40px;
    }
  }

  .main-content {
    flex: 1;
    padding: 24px 20px;
    min-width: 0; /* prevent flex blowout */
  }

  .main-content.full-width {
    max-width: 100%;
    padding: 0;
  }
</style>
