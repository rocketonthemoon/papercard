<script>
  import { onMount } from 'svelte';
  import { appState } from './lib/state.svelte.js';
  import { authDev } from './lib/api.js';

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

  // Sync body classes strictly according to design.css
  $effect(() => {
    if (typeof document === 'undefined') return;
    const isLanding = !user || hash === '#/landing' || hash === '#/about';
    const isFocus = hash.startsWith('#/learn/lesson') || hash.startsWith('#/learn/review');

    document.body.classList.toggle('shell', !isLanding);
    document.body.classList.toggle('landing', isLanding);
    document.body.classList.toggle('focus', isFocus);
  });

  // Route matchers
  let duelCode = $derived(/^#\/duel\/([A-Za-z0-9]{6})$/i.exec(hash)?.[1]?.toUpperCase() ?? null);
  let learnCourseId = $derived(/^#\/learn\/course\/(\d+)$/.exec(hash)?.[1] ?? null);
  let lessonId = $derived(/^#\/learn\/lesson\/(\d+)$/.exec(hash)?.[1] ?? null);
  let courseDetailId = $derived(/^#\/course\/(\d+)$/.exec(hash)?.[1] ?? null);
  let studioCourseId = $derived(/^#\/studio\/(\d+)$/.exec(hash)?.[1] ?? null);
  let profileUsername = $derived(/^#\/u\/([A-Za-z0-9_]{1,40})$/.exec(hash)?.[1] ?? null);
</script>

{#if isLoading}
  <p class="muted loading" style="text-align:center;padding:100px 0;">Loading…</p>
{:else}
  <Header />

  {#if user}
    <Sidebar />
  {/if}

  <main id="app-main" class="app" aria-live="polite">
    {#if !user || hash === '#/landing' || hash === '#/about'}
      <Landing />
    {:else if hash === '#/' || hash === '#/learn'}
      <Learn />
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
  </main>

  {#if user}
    <MobileNav />
  {/if}

  <Footer />
  <Toast />
{/if}
