<script>
  import { onMount } from 'svelte';
  import { appState } from './lib/state.svelte.js';
  import { authDev } from './lib/api.js';

  import AppShell from './lib/layout/AppShell.svelte';
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

  // Whenever hash changes and user is null, auto-authenticate if in dev mode
  $effect(() => {
    const h = appState.hash;
    const u = appState.user;
    const cfg = appState.config;
    const loading = appState.isLoading;

    if (!loading && !u && cfg?.devLogin) {
      const isAppRoute =
        h.startsWith('#/learn') ||
        h.startsWith('#/course') ||
        h.startsWith('#/discover') ||
        h.startsWith('#/play') ||
        h.startsWith('#/leaderboard') ||
        h.startsWith('#/studio') ||
        h.startsWith('#/duel');

      if (isAppRoute) {
        authDev('Learner', 'learner')
          .then(async (user) => {
            appState.user = user;
            await appState.refreshTopStats();
          })
          .catch(() => {});
      }
    }
  });

  let hash = $derived(appState.hash);
  let user = $derived(appState.user);
  let isLoading = $derived(appState.isLoading);

  // Route matchers
  let duelCode = $derived(/^#\/duel\/([A-Za-z0-9]{6})$/i.exec(hash)?.[1]?.toUpperCase() ?? null);
  let learnCourseId = $derived(/^#\/learn\/course\/(\d+)$/.exec(hash)?.[1] ?? null);
  let lessonId = $derived(/^#\/learn\/lesson\/(\d+)$/.exec(hash)?.[1] ?? null);
  let courseDetailId = $derived(/^#\/course\/(\d+)$/.exec(hash)?.[1] ?? null);
  let studioCourseId = $derived(/^#\/studio\/(\d+)$/.exec(hash)?.[1] ?? null);
  let profileUsername = $derived(/^#\/u\/([A-Za-z0-9_]{1,40})$/.exec(hash)?.[1] ?? null);
</script>

{#if isLoading}
  <div class="app-loading">
    <div class="loading-brand">PAPERCARD</div>
  </div>
{:else}
  <AppShell>
    {#if !user || hash === '#/' || hash === '#/landing'}
      {#if !user}
        <Landing />
      {:else}
        <Learn />
      {/if}
    {:else if duelCode}
      <Duel code={duelCode} />
    {:else if learnCourseId}
      <CoursePath id={Number(learnCourseId)} />
    {:else if lessonId}
      <Lesson id={Number(lessonId)} />
    {:else if hash.startsWith('#/learn/review')}
      <Review />
    {:else if hash.startsWith('#/learn/words')}
      <Words />
    {:else if courseDetailId}
      <CourseDetail id={Number(courseDetailId)} />
    {:else if studioCourseId}
      <StudioEditor id={Number(studioCourseId)} />
    {:else if hash.startsWith('#/studio')}
      <StudioHome />
    {:else if profileUsername}
      <Profile username={profileUsername} />
    {:else if hash.startsWith('#/discover')}
      <Discover />
    {:else if hash.startsWith('#/play')}
      <Play />
    {:else if hash.startsWith('#/leaderboard')}
      <Leaderboard />
    {:else if hash.startsWith('#/admin')}
      <Admin />
    {:else}
      <Learn />
    {/if}
  </AppShell>
{/if}

<style>
  .app-loading {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-dusk-violet);
  }

  .loading-brand {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 32px;
    letter-spacing: -0.04em;
    color: var(--color-hi-vis-yellow);
    animation: pulse 1s infinite alternate;
  }

  @keyframes pulse {
    from { opacity: 0.6; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1.02); }
  }
</style>
