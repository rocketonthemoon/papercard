<script>
  import { onMount, onDestroy } from 'svelte';
  import { appState } from '../lib/state.svelte.js';
  import { authDev, authGoogle } from '../lib/api.js';

  let config = $derived(appState.config);
  let errorMsg = $state('');
  let isLoggingIn = $state(false);

  // Challenged duel from URL hash if user opened an invite link
  let challenged = $state(null);

  // Slots
  let gsiSlot = $state(null);

  // Interactive / self-playing demo states
  let selectedQuizOpt = $state(1); // 1 = book (right), 2 = house, 3 = water
  let isCardFlipped = $state(false);
  let demoTimer = null;
  let userInteracted = $state(false);

  function duelCodeFromHash() {
    if (typeof window === 'undefined') return null;
    const m = /^#\/duel\/([A-Za-z0-9]{6})$/.exec(window.location.hash);
    return m ? m[1].toUpperCase() : null;
  }

  function loadGoogleScript() {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.google?.accounts?.id) return Promise.resolve();
    if (window.__gsiPromise) return window.__gsiPromise;

    window.__gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your connection or ad blocker."));
      document.head.appendChild(s);
    });

    return window.__gsiPromise;
  }

  async function mountGoogleButton(slot) {
    if (!slot) return;
    const clientId = config?.googleClientId;
    if (!clientId) return;

    try {
      await loadGoogleScript();
      if (!window.google?.accounts?.id) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            isLoggingIn = true;
            errorMsg = '';
            const user = await authGoogle(credential);
            appState.user = user;
            await appState.refreshTopStats();
            if (challenged) {
              appState.navigate(`#/duel/${challenged}`);
            } else {
              appState.navigate('#/learn');
            }
          } catch (x) {
            errorMsg = x.message || 'Google sign-in failed';
          } finally {
            isLoggingIn = false;
          }
        },
      });

      slot.innerHTML = '';
      window.google.accounts.id.renderButton(slot, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        width: 280,
      });
    } catch (x) {
      errorMsg = x.message || 'Could not load Google Sign-In';
    }
  }

  // Reactive effect when config or gsiSlot arrives
  $effect(() => {
    if (gsiSlot && config?.googleClientId) {
      mountGoogleButton(gsiSlot);
    }
  });

  onMount(() => {
    challenged = duelCodeFromHash();

    // Auto-playing loop for landing demos (unless prefers-reduced-motion)
    const prefersReducedMotion = typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion) {
      let tick = 0;
      demoTimer = setInterval(() => {
        if (userInteracted) return;
        tick++;
        // quiz: cycle blank -> wrong guess -> right answer
        selectedQuizOpt = [null, 3, 1][tick % 3];
        if (tick % 2 === 0) {
          isCardFlipped = !isCardFlipped;
        }
      }, 2600);
    }
  });

  onDestroy(() => {
    if (demoTimer) clearInterval(demoTimer);
  });

  async function handleDevLogin() {
    try {
      isLoggingIn = true;
      errorMsg = '';
      const user = await authDev('admin', 'admin');
      appState.user = user;
      await appState.refreshTopStats();
      if (challenged) {
        appState.navigate(`#/duel/${challenged}`);
      } else {
        appState.navigate('#/learn');
      }
    } catch (e) {
      errorMsg = e.message || 'Dev login failed';
    } finally {
      isLoggingIn = false;
    }
  }

  function handleQuizPick(optId) {
    userInteracted = true;
    selectedQuizOpt = optId;
  }

  function handleCardClick() {
    userInteracted = true;
    isCardFlipped = !isCardFlipped;
  }

  function handleCtaClick() {
    const signinEl = document.getElementById('signin');
    if (signinEl) {
      signinEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
</script>

<div class="landing-page-poster">
  {#if challenged}
    <div class="confetti-challenge">
      <b>WORD DUEL:</b> You've been challenged to duel <b>{challenged}</b>. Jump into the arena!
    </div>
  {/if}

  <section class="poster-hero">
    <h1 class="poster-display-title">
      <span class="poster-title-line">
        <span class="txt-hi">PAPER</span><span class="txt-butter">CARD</span>
      </span>
      <span class="poster-title-line">
        <span class="txt-butter">LEARN</span> <span class="txt-hi">LITHUANIAN</span>
      </span>
    </h1>

    <p class="poster-lead">Lessons, flashcards and live word duels. Free, forever.</p>

    <div class="poster-actions poster-signin-actions" id="signin">
      <div id="gsi" class="gsi-slot" bind:this={gsiSlot}>
        {#if !config?.googleClientId}
          <p class="mono-tag gsi-missing">Google Sign-In is required to enter Papercard.</p>
        {/if}
      </div>

      {#if config?.devLogin}
        <div id="dev-signin" class="dev-signin-slot">
          <button
            type="button"
            class="btn btn-gate-pill"
            id="dev-signin-btn"
            onclick={handleDevLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? 'Signing in...' : 'Dev sign in'}
          </button>
        </div>
      {/if}

      {#if errorMsg}
        <p id="signin-error" class="error-msg">{errorMsg}</p>
      {/if}
    </div>

    <!-- Flying papers: sample words as tilted flashcards -->
    <ul class="paper-fan" aria-label="Sample Lithuanian words">
      <li class="paper p1"><b lang="lt">Labas!</b><span>Hello!</span></li>
      <li class="paper p2 tint-pink"><b lang="lt">Ačiū</b><span>Thank you</span></li>
      <li class="paper p3"><b lang="lt">Prašom</b><span>Please</span></li>
      <li class="paper p4 tint-matcha"><b lang="lt">Iki!</b><span>See you!</span></li>
    </ul>
  </section>

  <!-- How It Works Demos -->
  <section class="landing-demos" aria-labelledby="demos-title">
    <h2 class="landing-section-title" id="demos-title">HOW IT WORKS</h2>

    <div class="landing-demos-grid">
      <!-- 01 Learn -->
      <figure class="demo-block">
        <span class="demo-step">01</span>
        <div class="demo-stage">
          <div class="demo-quiz" id="demo-quiz">
            <span class="demo-quiz-prompt">What does this mean?</span>
            <div class="demo-quiz-word" lang="lt">knyga</div>
            <div class="demo-quiz-options">
              <button
                type="button"
                class="qopt"
                class:right={selectedQuizOpt === 1}
                onclick={() => handleQuizPick(1)}
              >
                <i>1</i>book
              </button>
              <button
                type="button"
                class="qopt"
                class:wrong={selectedQuizOpt === 2}
                onclick={() => handleQuizPick(2)}
              >
                <i>2</i>house
              </button>
              <button
                type="button"
                class="qopt"
                class:wrong={selectedQuizOpt === 3}
                onclick={() => handleQuizPick(3)}
              >
                <i>3</i>water
              </button>
            </div>
          </div>
        </div>
        <figcaption><b>Learn</b> in 2-minute rounds</figcaption>
      </figure>

      <!-- 02 Review -->
      <figure class="demo-block">
        <span class="demo-step">02</span>
        <div class="demo-stage">
          <button
            type="button"
            class="demo-fc"
            id="demo-fc"
            class:flipped={isCardFlipped}
            onclick={handleCardClick}
            aria-label="Flip the flashcard"
          >
            <span class="demo-fc-inner">
              <span class="demo-fc-face demo-fc-front">
                <span class="mono-tag">NOUN · M</span>
                <span class="demo-fc-word" lang="lt">universitetas</span>
                <span class="demo-fc-hint">tap to flip ⟲</span>
              </span>
              <span class="demo-fc-face demo-fc-back">
                <span class="mono-tag">ENGLISH</span>
                <span class="demo-fc-word">university</span>
                <span class="demo-srs"><i>1d</i><i>3d</i><i>7d</i><i>30d</i></span>
              </span>
            </span>
          </button>
        </div>
        <figcaption><b>Review</b> right before you forget</figcaption>
      </figure>

      <!-- 03 Duel -->
      <figure class="demo-block">
        <span class="demo-step">03</span>
        <div class="demo-stage">
          <div class="demo-duel">
            <div class="duel-row">
              <span class="duel-ava you">Y</span>
              <div class="duel-track"><i class="duel-fill you" style="--to: 82%"></i></div>
              <b class="duel-score">90</b>
            </div>
            <div class="duel-row">
              <span class="duel-ava foe">A</span>
              <div class="duel-track"><i class="duel-fill foe" style="--to: 64%"></i></div>
              <b class="duel-score">70</b>
            </div>
            <div class="duel-foot">
              <span class="mono-tag">ROUND 4/5</span>
              <span class="duel-timer">0:14</span>
            </div>
          </div>
        </div>
        <figcaption><b>Duel</b> friends in real time</figcaption>
      </figure>
    </div>
  </section>

  <!-- Ready CTA -->
  <section class="landing-cta">
    <h2>READY?</h2>
    <button type="button" class="btn-gate-pill big" id="landing-cta-btn" onclick={handleCtaClick}>
      Start learning →
    </button>
  </section>
</div>

<style>
  .landing-page-poster {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 0 20px;
  }

  .confetti-challenge {
    background: var(--color-hi-vis-yellow);
    color: var(--color-ink-black);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 12px 20px;
    margin-bottom: 24px;
    font-size: 14px;
    box-shadow: 0 4px 0 var(--color-ink-black);
  }

  /* Poster Hero */
  .poster-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 16px 16px 32px;
    gap: 24px;
    position: relative;
    max-width: 960px;
    margin: 0 auto;
    width: 100%;
  }

  /* Headline clamped so LEARN LITHUANIAN / PAPERCARD never break awkwardly */
  .poster-display-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(34px, 5.5vw, 76px);
    line-height: 0.92;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0;
    word-break: keep-all;
    overflow-wrap: normal;
    hyphens: none;
    box-shadow: none !important;
  }

  .poster-title-line {
    display: block;
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .poster-display-title {
      font-size: clamp(24px, 7.5vw, 36px);
      line-height: 0.96;
    }
    .poster-title-line {
      white-space: normal;
    }
  }

  .poster-lead {
    max-width: 660px;
    font-size: clamp(16px, 1.8vw, 20px);
    line-height: 1.45;
    color: var(--color-bone-white);
    margin: 0 auto;
    font-weight: 500;
    opacity: 0.95;
  }

  .poster-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .poster-signin-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: 12px 0 20px;
    gap: 10px;
  }

  .gsi-slot {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 52px;
  }

  .gsi-missing {
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    padding: 10px 20px;
    border-radius: var(--radius-pill);
    border: var(--border-thick);
    font-weight: 700;
  }

  .dev-signin-slot {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  /* Gate pill button strictly following DESIGN.md */
  .btn-gate-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    white-space: nowrap;
    background: var(--color-bone-white);
    color: var(--color-pure-black);
    border: 2.5px solid var(--color-pure-black);
    border-radius: var(--radius-pill);
    box-shadow: 0 4px 0 var(--color-pure-black);
    padding: 0 24px;
    height: 48px;
    font-family: var(--font-body);
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.04em;
    cursor: pointer;
    text-decoration: none;
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
    width: 100%;
    max-width: 280px;
  }

  .btn-gate-pill:hover:not(:disabled) {
    background: var(--color-hi-vis-yellow);
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-pure-black);
  }

  .btn-gate-pill:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-pure-black);
  }

  .btn-gate-pill.big {
    height: 54px;
    padding: 0 36px;
    font-size: 18px;
    max-width: none;
    width: auto;
    box-shadow: 0 5px 0 var(--color-pure-black);
  }

  .btn-gate-pill.big:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 8px 0 var(--color-pure-black);
  }

  .btn-gate-pill.big:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-pure-black);
  }

  .btn-gate-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-msg {
    color: var(--color-firecracker-red);
    background: var(--color-bone-white);
    padding: 6px 16px;
    border-radius: var(--radius-pill);
    border: var(--border-thick);
    font-size: 13px;
    font-weight: 700;
  }

  /* Paper Fan */
  .paper-fan {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .paper {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 130px;
    padding: 14px 20px 12px;
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border: 2.5px solid var(--color-ink-black);
    border-radius: 8px;
    box-shadow: 0 4px 0 var(--color-ink-black);
    transform: rotate(var(--tilt, 0deg));
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease;
    user-select: none;
    cursor: default;
  }

  .paper:hover {
    transform: rotate(0deg) translateY(-8px) scale(1.04);
    box-shadow: 0 8px 0 var(--color-ink-black);
  }

  .paper b {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
  }

  .paper span {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .paper.p1 { --tilt: -6deg; }
  .paper.p2 { --tilt: 4deg; margin-top: 18px; }
  .paper.p3 { --tilt: -2deg; }
  .paper.p4 { --tilt: 7deg; margin-top: 12px; }

  .paper.tint-pink { background: var(--color-bubblegum-pink); }
  .paper.tint-matcha { background: var(--color-matcha-cream); }

  @media (max-width: 480px) {
    .paper-fan { gap: 10px; }
    .paper {
      min-width: 0;
      flex: 0 1 calc(50% - 10px);
      box-sizing: border-box;
      padding: 10px 12px;
    }
    .paper b { font-size: 18px; }
    .paper.p2, .paper.p4 { margin-top: 8px; }
  }

  /* How It Works Section */
  .landing-demos {
    width: 100%;
    max-width: 1100px;
    margin: 56px auto 0;
    padding: 0 20px;
    box-sizing: border-box;
  }

  .landing-section-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(26px, 4vw, 44px);
    color: var(--color-hi-vis-yellow);
    text-align: center;
    letter-spacing: 0.02em;
    line-height: 1;
    margin: 0 0 32px;
  }

  .landing-demos-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28px;
  }

  @media (max-width: 900px) {
    .landing-demos-grid {
      grid-template-columns: 1fr;
      gap: 36px;
      max-width: 420px;
      margin: 0 auto;
    }
  }

  .demo-block {
    position: relative;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .demo-step {
    position: absolute;
    top: -18px;
    left: -8px;
    z-index: 2;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 40px;
    line-height: 1;
    color: var(--color-hi-vis-yellow);
    -webkit-text-stroke: 2px var(--color-ink-black);
    paint-order: stroke fill;
  }

  .demo-stage {
    background: var(--color-lilac-shadow);
    border: 2.5px solid var(--color-ink-black);
    border-radius: 8px;
    box-shadow: 0 4px 0 var(--color-ink-black);
    padding: 32px 22px 24px;
    height: 260px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 900px) {
    .demo-stage {
      height: 240px;
    }
  }

  .demo-block figcaption {
    font-size: 16px;
    color: var(--color-bone-white);
    text-align: center;
    letter-spacing: 0.02em;
  }

  .demo-block figcaption b {
    color: var(--color-hi-vis-yellow);
    font-family: var(--font-display);
    font-size: 18px;
    text-transform: uppercase;
  }

  .demo-block figcaption b {
    color: var(--color-hi-vis-yellow);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-right: 4px;
  }

  /* 01 Quiz */
  .demo-quiz {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .demo-quiz-prompt {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(249, 245, 242, 0.75);
  }

  .demo-quiz-word {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 34px;
    line-height: 1;
    color: var(--color-bone-white);
    margin-bottom: 6px;
  }

  .demo-quiz-options {
    width: 100%;
    display: grid;
    gap: 8px;
  }

  .qopt {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border: 2px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    font-family: var(--font-body);
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.08s ease;
  }

  .qopt i {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 11px;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border: 1.5px solid currentColor;
    border-radius: 4px;
  }

  .qopt:focus-visible {
    outline: 3px solid var(--color-hi-vis-yellow);
    outline-offset: 2px;
  }

  .qopt.right {
    background: var(--color-matcha-cream);
  }

  .qopt.right::after {
    content: "✓";
    margin-left: auto;
    font-size: 16px;
  }

  .qopt.wrong {
    background: var(--color-bubblegum-pink);
    animation: demo-shake 0.3s ease;
  }

  .qopt.wrong::after {
    content: "✕";
    margin-left: auto;
    font-size: 14px;
  }

  @keyframes demo-shake {
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }

  /* 02 Flip card */
  .demo-fc {
    all: unset;
    display: block;
    width: 100%;
    max-width: 230px;
    height: 170px;
    perspective: 900px;
    cursor: pointer;
  }

  .demo-fc:focus-visible {
    outline: 3px solid var(--color-hi-vis-yellow);
    outline-offset: 4px;
    border-radius: var(--radius-card);
  }

  .demo-fc-inner {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    transform: rotate(-3deg);
    transition: transform 0.6s cubic-bezier(0.3, 1.3, 0.5, 1);
  }

  .demo-fc.flipped .demo-fc-inner {
    transform: rotate(2deg) rotateY(180deg);
  }

  .demo-fc-face {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2.5px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    color: var(--color-ink-black);
  }

  .demo-fc-front {
    background: var(--color-bone-white);
  }

  .demo-fc-back {
    background: var(--color-hi-vis-yellow);
    transform: rotateY(180deg);
  }

  .demo-fc-word {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    line-height: 1;
  }

  .demo-fc-hint {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    opacity: 0.6;
  }

  .demo-srs {
    display: flex;
    gap: 4px;
  }

  .demo-srs i {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    border: 1.5px solid var(--color-ink-black);
    border-radius: 100px;
    background: var(--color-bone-white);
  }

  /* 03 Duel */
  .demo-duel {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .duel-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .duel-ava {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 2px solid var(--color-ink-black);
    border-radius: 50%;
    font-weight: 800;
    color: var(--color-ink-black);
  }

  .duel-ava.you {
    background: var(--color-hi-vis-yellow);
  }

  .duel-ava.foe {
    background: var(--color-bubblegum-pink);
  }

  .duel-track {
    flex: 1;
    height: 18px;
    background: var(--color-bone-white);
    border: 2px solid var(--color-ink-black);
    border-radius: 100px;
    overflow: hidden;
  }

  .duel-fill {
    display: block;
    height: 100%;
    width: var(--to);
    border-right: 2px solid var(--color-ink-black);
    animation: duel-race 3.2s cubic-bezier(0.5, 0, 0.3, 1) infinite alternate;
  }

  .duel-fill.you {
    background: var(--color-hi-vis-yellow);
  }

  .duel-fill.foe {
    background: var(--color-bubblegum-pink);
    animation-delay: 0.4s;
  }

  @keyframes duel-race {
    from { width: 8%; }
    to { width: var(--to); }
  }

  .duel-score {
    flex: none;
    width: 28px;
    text-align: right;
    font-size: 17px;
    font-weight: 700;
    color: var(--color-bone-white);
  }

  .duel-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--color-bone-white);
  }

  .duel-timer {
    font-family: var(--font-mono);
    font-size: 13px;
    padding: 3px 10px;
    border: 1.5px solid var(--color-hi-vis-yellow);
    border-radius: 100px;
    color: var(--color-hi-vis-yellow);
  }

  /* Bottom CTA */
  .landing-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    margin: 90px auto 60px;
    text-align: center;
  }

  .landing-cta h2 {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(56px, 11vw, 130px);
    line-height: 0.85;
    color: var(--color-hi-vis-yellow);
    margin: 0;
    letter-spacing: -0.02em;
    text-shadow: 0 4px 0 var(--color-ink-black);
  }

  @media (prefers-reduced-motion: reduce) {
    .duel-fill { animation: none; }
    .demo-fc-inner, .paper { transition: none; }
  }
</style>
