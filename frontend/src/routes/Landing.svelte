<script>
  import { appState } from '../lib/state.svelte.js';
  import { authDev } from '../lib/api.js';

  let config = $derived(appState.config);
  let errorMsg = $state('');
  let isLoggingIn = $state(false);

  // Demo 1: Quiz state
  let selectedQuizOpt = $state(null);

  // Demo 2: Flashcard flip state
  let isCardFlipped = $state(false);

  async function handleDevLogin() {
    try {
      isLoggingIn = true;
      errorMsg = '';
      const user = await authDev('Learner', 'learner');
      appState.user = user;
      await appState.refreshTopStats();
      appState.navigate('#/learn');
    } catch (e) {
      errorMsg = e.message || 'Dev login failed';
    } finally {
      isLoggingIn = false;
    }
  }

  function handleCtaClick() {
    const signinEl = document.getElementById('signin-section');
    if (signinEl) {
      signinEl.scrollIntoView({ behavior: 'smooth' });
    }
  }
</script>

<div class="landing-container">
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

    <div class="poster-actions" id="signin-section">
      {#if config.googleClientId}
        <div id="gsi-slot">
          <!-- Google gsi button container -->
        </div>
      {:else}
        <div class="pill-notice">
          Google Sign-In is configured on production. Use Dev Sign In locally:
        </div>
      {/if}

      {#if config.devLogin}
        <button
          type="button"
          class="btn primary big-pill"
          onclick={handleDevLogin}
          disabled={isLoggingIn}
        >
          {isLoggingIn ? 'Signing in...' : '⚡ Dev Sign In'}
        </button>
      {/if}

      {#if errorMsg}
        <p class="error-msg">{errorMsg}</p>
      {/if}
    </div>

    <!-- Flying paper fan: sample words -->
    <ul class="paper-fan" aria-label="Sample Lithuanian words">
      <li class="paper p1"><b lang="lt">Labas!</b><span>Hello!</span></li>
      <li class="paper p2 tint-pink"><b lang="lt">Ačiū</b><span>Thank you</span></li>
      <li class="paper p3"><b lang="lt">Prašom</b><span>Please</span></li>
      <li class="paper p4 tint-matcha"><b lang="lt">Iki!</b><span>See you!</span></li>
    </ul>
  </section>

  <!-- Interactive How It Works Demos -->
  <section class="landing-demos" aria-labelledby="demos-title">
    <h2 class="landing-section-title" id="demos-title">HOW IT WORKS</h2>

    <div class="landing-demos-grid">
      <!-- 01 Learn -->
      <figure class="demo-block">
        <span class="demo-step">01</span>
        <div class="demo-stage">
          <div class="demo-quiz">
            <span class="demo-quiz-prompt">What does this mean?</span>
            <div class="demo-quiz-word" lang="lt">knyga</div>
            <div class="demo-quiz-options">
              <button
                type="button"
                class="qopt"
                class:right={selectedQuizOpt === 1}
                onclick={() => selectedQuizOpt = 1}
              >
                <i>1</i>book
              </button>
              <button
                type="button"
                class="qopt"
                class:wrong={selectedQuizOpt === 2}
                onclick={() => selectedQuizOpt = 2}
              >
                <i>2</i>house
              </button>
              <button
                type="button"
                class="qopt"
                class:wrong={selectedQuizOpt === 3}
                onclick={() => selectedQuizOpt = 3}
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
            class:flipped={isCardFlipped}
            onclick={() => isCardFlipped = !isCardFlipped}
            aria-label="Flip the flashcard"
          >
            <div class="demo-fc-inner">
              <div class="demo-fc-face demo-fc-front">
                <span class="mono-tag">NOUN · M</span>
                <span class="demo-fc-word" lang="lt">universitetas</span>
                <span class="demo-fc-hint">tap to flip ⤾</span>
              </div>
              <div class="demo-fc-face demo-fc-back">
                <span class="mono-tag">ENGLISH</span>
                <span class="demo-fc-word">university</span>
                <span class="demo-srs"><i>1d</i><i>3d</i><i>7d</i><i>30d</i></span>
              </div>
            </div>
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
              <div class="duel-track"><i class="duel-fill you" style="width: 82%"></i></div>
              <b class="duel-score">90</b>
            </div>
            <div class="duel-row">
              <span class="duel-ava foe">A</span>
              <div class="duel-track"><i class="duel-fill foe" style="width: 64%"></i></div>
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

  <section class="landing-cta">
    <h2>READY?</h2>
    <button type="button" class="btn primary big-pill" onclick={handleCtaClick}>
      Start learning →
    </button>
  </section>
</div>

<style>
  .landing-container {
    max-width: 1080px;
    margin: 0 auto;
    padding: 32px 16px 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .poster-hero {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 40px 0 20px;
  }

  .poster-display-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(38px, 8vw, 76px);
    line-height: 0.95;
    letter-spacing: -0.04em;
    margin-bottom: 20px;
    text-transform: uppercase;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .poster-title-line {
    display: block;
  }

  .txt-hi {
    color: var(--color-hi-vis-yellow);
    text-shadow: 2px 2px 0 var(--color-ink-black);
  }

  .txt-butter {
    color: var(--color-bone-white);
    text-shadow: 2px 2px 0 var(--color-ink-black);
  }

  .poster-lead {
    font-size: clamp(17px, 2.5vw, 22px);
    color: var(--color-bone-white);
    max-width: 580px;
    margin-bottom: 32px;
    font-weight: 500;
  }

  .poster-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-bottom: 48px;
    z-index: 10;
  }

  .pill-notice {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    padding: 6px 16px;
  }

  .big-pill {
    padding: 12px 36px;
    font-size: 16px;
  }

  .error-msg {
    color: var(--color-firecracker-red);
    background: var(--color-bone-white);
    padding: 4px 12px;
    border-radius: var(--radius-pill);
    border: 1.5px solid var(--color-ink-black);
    font-size: 13px;
    font-weight: 700;
  }

  /* Flying paper fan */
  .paper-fan {
    list-style: none;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
    padding: 0;
    margin: 20px 0 60px;
  }

  .paper {
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 14px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 110px;
    transition: transform 0.15s ease;
    box-shadow: 0 4px 0 rgba(26, 26, 26, 0.2);
  }

  .paper b {
    font-size: 18px;
    font-family: var(--font-display);
    color: var(--color-ink-black);
  }

  .paper span {
    font-size: 12px;
    color: var(--ink-60);
    font-family: var(--font-mono);
  }

  .paper.tint-pink {
    background: var(--color-bubblegum-pink);
  }

  .paper.tint-matcha {
    background: var(--color-matcha-cream);
  }

  .paper.p1 { transform: rotate(-4deg); }
  .paper.p2 { transform: rotate(3deg); }
  .paper.p3 { transform: rotate(-2deg); }
  .paper.p4 { transform: rotate(5deg); }

  .paper:hover {
    transform: translateY(-6px) scale(1.05) rotate(0deg);
  }

  /* Demos section */
  .landing-demos {
    width: 100%;
    margin: 40px 0;
  }

  .landing-section-title {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 900;
    color: var(--color-bone-white);
    text-align: center;
    letter-spacing: -0.02em;
    margin-bottom: 32px;
  }

  .landing-demos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
  }

  .demo-block {
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    box-shadow: 0 6px 0 rgba(26, 26, 26, 0.25);
  }

  .demo-step {
    position: absolute;
    top: 14px;
    left: 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 800;
    color: var(--ink-60);
  }

  .demo-stage {
    width: 100%;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 20px 0 16px;
  }

  figcaption {
    font-size: 15px;
    color: var(--color-ink-black);
    font-family: var(--font-body);
  }

  figcaption b {
    font-weight: 800;
  }

  /* Quiz Demo */
  .demo-quiz {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .demo-quiz-prompt {
    font-size: 12px;
    color: var(--ink-60);
  }

  .demo-quiz-word {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 800;
  }

  .demo-quiz-options {
    display: flex;
    gap: 8px;
    width: 100%;
    justify-content: center;
  }

  .qopt {
    padding: 8px 14px;
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    background: var(--color-bone-white);
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .qopt i {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-60);
  }

  .qopt:hover {
    background: var(--color-hi-vis-yellow);
    transform: translateY(-1px);
  }

  .qopt.right {
    background: var(--color-matcha-cream);
  }

  .qopt.wrong {
    background: var(--color-bubblegum-pink);
  }

  /* Flashcard Demo */
  .demo-fc {
    width: 220px;
    height: 140px;
    perspective: 800px;
    background: none;
    cursor: pointer;
    border: none;
    padding: 0;
  }

  .demo-fc-inner {
    position: relative;
    width: 100%;
    height: 100%;
    transition: transform 0.4s ease;
    transform-style: preserve-3d;
  }

  .demo-fc.flipped .demo-fc-inner {
    transform: rotateY(180deg);
  }

  .demo-fc-face {
    position: absolute;
    width: 100%;
    height: 100%;
    backface-visibility: hidden;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    box-shadow: 0 4px 0 rgba(26, 26, 26, 0.15);
  }

  .demo-fc-front {
    background: var(--color-hi-vis-yellow);
  }

  .demo-fc-back {
    background: var(--color-matcha-cream);
    transform: rotateY(180deg);
  }

  .demo-fc-word {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
  }

  .demo-fc-hint {
    font-size: 11px;
    color: var(--ink-60);
    font-family: var(--font-mono);
  }

  .demo-srs {
    display: flex;
    gap: 6px;
  }

  .demo-srs i {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--color-bone-white);
    border: 1px solid var(--color-ink-black);
    border-radius: 4px;
    padding: 1px 6px;
  }

  /* Duel Demo */
  .demo-duel {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .duel-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .duel-ava {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-black);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 12px;
  }

  .duel-ava.you { background: var(--color-hi-vis-yellow); }
  .duel-ava.foe { background: var(--color-bubblegum-pink); }

  .duel-track {
    flex: 1;
    height: 12px;
    background: rgba(26, 26, 26, 0.1);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .duel-fill {
    display: block;
    height: 100%;
    background: var(--color-hi-vis-yellow);
    border-radius: var(--radius-pill);
  }

  .duel-fill.foe {
    background: var(--color-bubblegum-pink);
  }

  .duel-score {
    font-family: var(--font-mono);
    font-size: 13px;
    width: 24px;
    text-align: right;
  }

  .duel-foot {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }

  .duel-timer {
    font-family: var(--font-mono);
    font-weight: 700;
  }

  /* CTA */
  .landing-cta {
    margin: 50px 0 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .landing-cta h2 {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 32px;
    color: var(--color-bone-white);
  }
</style>
