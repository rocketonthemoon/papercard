<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let course = $state(null);
  let words = $state([]);
  let now = $state(Date.now());

  let deck = $state([]);
  let index = $state(0);
  let flipped = $state(false);
  let direction = $state('lt-en'); // lt-en or en-lt
  let mastered = $state(new Set());
  let stillLearning = $state(new Set());
  let isFinished = $state(false);

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function playAudio(text, lang = 'lt-LT') {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  }

  onMount(async () => {
    try {
      loading = true;
      const res = await api('/learn/words');
      course = res.course;
      now = res.now || Date.now();
      const allWords = (res.units || [])
        .flatMap(u => (u.lessons || []).flatMap(l => l.words || []))
        .filter(w => w.learned);

      words = allWords;
      if (allWords.length > 0) {
        deck = shuffle(allWords);
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load review flashcards';
    } finally {
      loading = false;
    }

    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown);
    }
  });

  function handleKeydown(e) {
    if (isFinished || loading || !currentCard) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      flipped = !flipped;
    } else if (flipped) {
      if (e.key === '1') {
        e.preventDefault();
        markLearning();
      } else if (e.key === '2') {
        e.preventDefault();
        markMastered();
      }
    } else {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipCard();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevCard();
      }
    }
  }

  let currentCard = $derived(deck[index] || null);
  let progressPct = $derived(deck.length ? Math.round((index / deck.length) * 100) : 0);

  let toLangName = $derived(course?.toLang || 'Lithuanian');
  let fromLangName = $derived(course?.fromLang || 'English');

  let isLtFront = $derived(direction === 'lt-en');
  let frontText = $derived(currentCard ? (isLtFront ? currentCard.lt : currentCard.en) : '');
  let backText = $derived(currentCard ? (isLtFront ? currentCard.en : currentCard.lt) : '');
  let frontLang = $derived(isLtFront ? toLangName : fromLangName);
  let backLang = $derived(isLtFront ? fromLangName : toLangName);

  function prevCard() {
    if (index > 0) {
      index--;
      flipped = false;
    }
  }

  function skipCard() {
    if (index + 1 < deck.length) {
      index++;
      flipped = false;
    } else {
      finishReview();
    }
  }

  function markLearning() {
    if (!currentCard) return;
    stillLearning.add(currentCard.id);
    deck.push(currentCard); // Re-queue at the end
    advance();
  }

  function markMastered() {
    if (!currentCard) return;
    mastered.add(currentCard.id);
    if (currentCard.dueAt && currentCard.dueAt <= now) {
      api(`/learn/words/${currentCard.id}/answer`, {
        method: 'POST',
        body: { review: true, text: currentCard.lt, kind: 'type_lt' }
      }).catch(() => {});
    }
    advance();
  }

  function advance() {
    if (index + 1 < deck.length) {
      index++;
      flipped = false;
    } else {
      finishReview();
    }
  }

  function finishReview() {
    isFinished = true;
    appState.refreshTopStats();
  }

  function handleShuffle() {
    deck = shuffle(words);
    index = 0;
    flipped = false;
    isFinished = false;
    appState.showToast('Cards shuffled!');
  }

  function toggleDirection() {
    direction = direction === 'lt-en' ? 'en-lt' : 'lt-en';
    flipped = false;
  }
</script>

<div class="review-page">
  {#if loading}
    <div class="card loading-state">
      <p class="muted">Loading flashcards…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Unable to load review</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/learn" class="btn primary">Back to Home</a>
    </div>
  {:else if words.length === 0}
    <!-- Empty State -->
    <div class="card empty-card">
      <div class="empty-icon"><Icon name="cards" size={56} /></div>
      <h2>Nothing to review yet</h2>
      <p class="muted">Words you learn in lessons show up here so you can review them and lock them into memory.</p>
      <div class="btn-row">
        <a href="#/learn" class="btn primary">Start a lesson →</a>
      </div>
    </div>
  {:else if isFinished}
    <!-- Finished State -->
    <div class="card finish-card">
      <div class="finish-icon"><Icon name="cards" size={56} /></div>
      <h2>Review complete!</h2>
      <p class="muted">You reviewed all {words.length} learned words.</p>

      <div class="finish-stats">
        <div class="fstat">
          <span class="mono-tag muted">Mastered</span>
          <b>{mastered.size}</b>
        </div>
        <div class="fstat">
          <span class="mono-tag muted">Practiced</span>
          <b>{stillLearning.size}</b>
        </div>
        <div class="fstat">
          <span class="mono-tag muted">Total cards</span>
          <b>{words.length}</b>
        </div>
      </div>

      <div class="finish-actions">
        <button class="btn primary" onclick={handleShuffle}>
          <Icon name="shuffle" size={16} />
          <span>Shuffle & Review again</span>
        </button>
        <a href="#/learn" class="btn outline">Done</a>
      </div>

      <a href="#/learn/words" class="word-list-link">
        <Icon name="list" size={15} />
        <span>View all learned words</span>
      </a>
    </div>
  {:else if currentCard}
    <!-- Active Review Stage -->
    <div class="fc-container">
      <header class="fc-header">
        <div class="fc-topbar">
          <a href="#/learn" class="icon-btn sm" title="Exit review">
            <Icon name="close" size={16} />
          </a>
          <span class="fc-counter mono-tag">
            CARD <b>{index + 1}</b> / {deck.length}
          </span>
          <div class="fc-tools">
            <button class="btn sm outline" onclick={handleShuffle} title="Shuffle deck">
              <Icon name="shuffle" size={14} />
              <span>Shuffle</span>
            </button>
            <button class="btn sm outline" onclick={toggleDirection} title="Switch front/back">
              <Icon name="flip" size={14} />
              <span>{isLtFront ? 'LT → EN' : 'EN → LT'}</span>
            </button>
          </div>
        </div>

        <div class="fc-progress-track">
          <div class="fc-progress-fill" style="width: {progressPct}%"></div>
        </div>
      </header>

      <!-- 3D Flashcard with Tactile Ink Shadows -->
      <div
        class="flashcard"
        class:flipped={flipped}
        onclick={() => flipped = !flipped}
        onkeydown={(e) => e.key === 'Enter' && (flipped = !flipped)}
        tabindex="0"
        role="button"
        aria-label="Flashcard: {frontText}. Click or press space to flip."
      >
        <div class="flashcard-inner">
          <!-- Front Face -->
          <div class="card-face front-face">
            <div class="face-top">
              <span class="pill yellow">{currentCard.pos || 'Word'}</span>
              {#if currentCard.dueAt && currentCard.dueAt <= now}
                <span class="pill pink">DUE</span>
              {:else}
                <span class="pill matcha">LEARNED</span>
              {/if}
            </div>

            <div class="face-body">
              <h2 class="word-heading">{frontText}</h2>
              <span class="lang-label mono-tag">{frontLang}</span>
              {#if isLtFront}
                <button
                  type="button"
                  class="audio-btn"
                  title="Listen pronunciation"
                  onclick={(e) => { e.stopPropagation(); playAudio(frontText); }}
                >
                  <Icon name="speaker" size={18} />
                </button>
              {/if}
            </div>

            <div class="face-foot mono-tag muted">
              <span>Tap card or press <b>Space</b> to flip ⤾</span>
            </div>
          </div>

          <!-- Back Face -->
          <div class="card-face back-face">
            <div class="face-top">
              <span class="pill yellow">{currentCard.pos || 'Meaning'}</span>
              <span class="pill matcha">ANSWER</span>
            </div>

            <div class="face-body">
              <h2 class="word-heading">{backText}</h2>
              <span class="lang-label mono-tag">{backLang}</span>
              {#if !isLtFront}
                <button
                  type="button"
                  class="audio-btn"
                  title="Listen pronunciation"
                  onclick={(e) => { e.stopPropagation(); playAudio(backText); }}
                >
                  <Icon name="speaker" size={18} />
                </button>
              {/if}
              {#if currentCard.note}
                <p class="word-note">{currentCard.note}</p>
              {/if}
            </div>

            <div class="face-foot mono-tag muted">
              <span>Did you recall this correctly?</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Control Buttons -->
      <div class="fc-controls">
        {#if !flipped}
          <div class="control-row">
            <button class="btn outline" onclick={prevCard} disabled={index === 0}>
              ← Previous
            </button>
            <button class="btn primary flip-action" onclick={() => flipped = true}>
              <Icon name="flip" size={16} />
              <span>Flip card (Space)</span>
            </button>
            <button class="btn outline" onclick={skipCard}>
              Skip →
            </button>
          </div>
        {:else}
          <div class="control-row rate-row">
            <button class="btn learning-btn" onclick={markLearning}>
              Still learning (1)
            </button>
            <button class="btn gotit-btn" onclick={markMastered}>
              <Icon name="check" size={16} />
              <span>Got it! (2)</span>
            </button>
          </div>
        {/if}

        <p class="keyboard-hints mono-tag muted small">
          Keyboard: <b>Space</b> flip · <b>1</b> Still learning · <b>2</b> Got it · <b>← / →</b> Prev / Skip
        </p>
      </div>
    </div>
  {/if}
</div>

<style>
  .review-page {
    max-width: 680px;
    margin: 0 auto;
    padding: 10px 0 40px;
  }

  .loading-state, .error-box, .empty-card, .finish-card {
    text-align: center;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .empty-icon, .finish-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }

  .btn-row, .finish-actions {
    display: flex;
    gap: 12px;
    margin-top: 10px;
  }

  .finish-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin: 16px 0;
    width: 100%;
    max-width: 440px;
  }

  .fstat {
    background: rgba(26, 26, 26, 0.04);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    box-shadow: 0 2px 0 var(--color-ink-black);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .fstat b {
    font-family: var(--font-mono);
    font-size: 24px;
  }

  .word-list-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    margin-top: 8px;
    text-decoration: underline;
    color: var(--color-bone-white);
  }

  .word-list-link:hover {
    color: var(--color-hi-vis-yellow);
  }

  /* Flashcard Arena */
  .fc-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  .fc-header {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .fc-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .fc-counter {
    font-size: 12px;
    font-weight: 800;
    color: var(--color-bone-white);
  }

  .fc-tools {
    display: flex;
    gap: 8px;
  }

  .fc-progress-track {
    height: 8px;
    background: rgba(26, 26, 26, 0.2);
    border: var(--border-thick);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .fc-progress-fill {
    height: 100%;
    background: var(--color-hi-vis-yellow);
    border-radius: var(--radius-pill);
    transition: width 0.2s ease;
  }

  /* 3D Flashcard */
  .flashcard {
    width: 100%;
    min-height: 290px;
    perspective: 1000px;
    cursor: pointer;
    user-select: none;
    outline: none;
  }

  .flashcard-inner {
    position: relative;
    width: 100%;
    min-height: 290px;
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    transform-style: preserve-3d;
  }

  .flashcard.flipped .flashcard-inner {
    transform: rotateY(180deg);
  }

  .card-face {
    position: absolute;
    width: 100%;
    height: 100%;
    backface-visibility: hidden;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 28px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    box-shadow: 0 6px 0 var(--color-ink-black);
  }

  .front-face {
    background: var(--color-bone-white);
  }

  .back-face {
    transform: rotateY(180deg);
    background: var(--color-matcha-cream);
  }

  .face-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .face-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    margin: 20px 0;
  }

  .word-heading {
    font-family: var(--font-display);
    font-size: clamp(32px, 6vw, 46px);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  .lang-label {
    font-size: 11px;
    color: var(--ink-60);
  }

  .audio-btn {
    margin-top: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: var(--border-thick);
    box-shadow: 0 2px 0 var(--color-ink-black);
    background: var(--color-bone-white);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }

  .audio-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 3px 0 var(--color-ink-black);
    background: var(--color-hi-vis-yellow);
  }

  .word-note {
    font-size: 14px;
    font-style: italic;
    color: var(--ink-60);
    margin-top: 6px;
  }

  .face-foot {
    text-align: center;
    font-size: 11px;
  }

  /* Controls */
  .fc-controls {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }

  .control-row {
    display: flex;
    gap: 12px;
    width: 100%;
    justify-content: center;
  }

  .flip-action {
    padding: 10px 36px;
  }

  .rate-row {
    max-width: 440px;
  }

  .learning-btn {
    flex: 1;
    background: var(--color-bubblegum-pink);
    border: var(--border-thick);
    box-shadow: 0 3px 0 var(--color-ink-black);
  }

  .learning-btn:hover {
    background: #ffffff;
    box-shadow: 0 4px 0 var(--color-ink-black);
  }

  .gotit-btn {
    flex: 1;
    background: var(--color-matcha-cream);
    border: var(--border-thick);
    box-shadow: 0 3px 0 var(--color-ink-black);
  }

  .gotit-btn:hover {
    background: #ffffff;
    box-shadow: 0 4px 0 var(--color-ink-black);
  }

  .keyboard-hints {
    font-size: 11px;
    text-align: center;
    color: var(--color-bone-white);
  }
</style>
