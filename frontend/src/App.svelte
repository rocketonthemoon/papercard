<script>
  import { onMount } from 'svelte';
  import { appState } from './lib/state.svelte.js';
  import { resolveRoute, isFocusRoute } from './lib/routes.js';

  import Header from './lib/layout/Header.svelte';
  import Sidebar from './lib/layout/Sidebar.svelte';
  import MobileNav from './lib/layout/MobileNav.svelte';
  import Footer from './lib/layout/Footer.svelte';
  import Toast from './lib/components/Toast.svelte';

  import Landing from './routes/Landing.svelte';
  import Learn from './routes/Learn.svelte';
  import CoursePath from './routes/CoursePath.svelte';
  import Lesson from './routes/Lesson.svelte';
  import Review from './routes/Review.svelte';
  import Words from './routes/Words.svelte';
  import Discover from './routes/Discover.svelte';
  import CourseDetail from './routes/CourseDetail.svelte';
  import Play from './routes/Play.svelte';
  import Duel from './routes/Duel.svelte';
  import Leaderboard from './routes/Leaderboard.svelte';
  import Profile from './routes/Profile.svelte';
  import StudioHome from './routes/StudioHome.svelte';
  import StudioEditor from './routes/StudioEditor.svelte';
  import Admin from './routes/Admin.svelte';

  onMount(async () => {
    await appState.init();
  });

  let hash = $derived(appState.hash);
  let user = $derived(appState.user);
  let isLoading = $derived(appState.isLoading);
  let route = $derived(resolveRoute(hash, !!user));

  // Body classes drive the shell layout in design.css
  $effect(() => {
    if (typeof document === 'undefined') return;
    const isLanding = route.name === 'landing';
    document.body.classList.toggle('shell', !isLanding);
    document.body.classList.toggle('landing', isLanding);
    document.body.classList.toggle('focus', !isLanding && isFocusRoute(hash));
  });
</script>

{#if isLoading}
  <p class="app-loading" role="status">Loading…</p>
{:else}
  <Header />

  {#if user}
    <Sidebar />
  {/if}

  <main id="app-main" class="app" aria-live="polite">
    {#if route.name === 'landing'}
      <Landing />
    {:else if route.name === 'duel'}
      <Duel code={route.param} />
    {:else if route.name === 'coursePath'}
      <CoursePath id={route.param} />
    {:else if route.name === 'lesson'}
      <Lesson id={route.param} />
    {:else if route.name === 'review'}
      <Review />
    {:else if route.name === 'words'}
      <Words />
    {:else if route.name === 'courseDetail'}
      <CourseDetail id={route.param} />
    {:else if route.name === 'studioEditor'}
      <StudioEditor id={route.param} />
    {:else if route.name === 'studio'}
      <StudioHome />
    {:else if route.name === 'profile'}
      <Profile username={route.param} />
    {:else if route.name === 'discover'}
      <Discover />
    {:else if route.name === 'play'}
      <Play />
    {:else if route.name === 'leaderboard'}
      <Leaderboard />
    {:else if route.name === 'admin'}
      <Admin />
    {:else}
      <Learn />
    {/if}
  </main>

  {#if user}
    <MobileNav />
  {/if}

  <Footer />
  <Toast />
{/if}
