<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let loading = $state(true);
  let errorMsg = $state('');
  let course = $state(null);
  let words = $state([]);
  let stats = $state(null);
  let now = $state(Date.now());

  let deck = $state([]);
  let index = $state(0);
  let flipped = $state(false);
  let direction = $state('lt-en'); // 'lt-en' or 'en-lt'
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

  async function loadWords() {
    try {
      loading = true;
      const res = await api('/learn/words');
      course = res.course;
      stats = res.stats || {};
      now = res.now || Date.now();
      const allWords = (res.units || [])
        .flatMap(u => (u.lessons || []).flatMap(l => l.words || []))
        .filter(w => w.learned);

      words = allWords;
      if (allWords.length > 0) {
        deck = shuffle(allWords);
        index = 0;
        flipped = false;
        mastered = new Set();
        stillLearning = new Set();
        isFinished = false;
      }
    } catch (e) {
      errorMsg = e.message || 'Failed to load review flashcards';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadWords();
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

  let toLanguageName = $derived(course?.toLang || 'Lithuanian');
  let fromLanguageName = $derived(course?.fromLang || 'English');
  let courseBack = $derived(course?.id ? `#/learn/course/${course.id}` : '#/learn');

  let isLtFront = $derived(direction === 'lt-en');
  let frontText = $derived(currentCard ? (isLtFront ? currentCard.lt : currentCard.en) : '');
  let backText = $derived(currentCard ? (isLtFront ? currentCard.en : currentCard.lt) : '');
  let frontLang = $derived(isLtFront ? toLanguageName : fromLanguageName);
  let backLang = $derived(isLtFront ? fromLanguageName : toLanguageName);

  function markMastered() {
    if (!currentCard) return;
    mastered.add(currentCard.id);
    mastered = new Set(mastered);
    api(`/learn/words/${currentCard.id}/answer`, {
      method: 'POST',
      body: { review: true, text: currentCard.lt, kind: 'type_lt' }
    }).catch(() => {});
    nextCard();
  }

  function markLearning() {
    if (!currentCard) return;
    stillLearning.add(currentCard.id);
    stillLearning = new Set(stillLearning);
    nextCard();
  }

  function nextCard() {
    flipped = false;
    if (index + 1 >= deck.length) {
      isFinished = true;
    } else {
      index++;
    }
  }

  function prevCard() {
    if (index > 0) {
      flipped = false;
      index--;
    }
  }

  function skipCard() {
    nextCard();
  }

  function reshuffle() {
    deck = shuffle(words);
    index = 0;
    flipped = false;
    appState.showToast('Cards reshuffled!');
  }

  function toggleDirection() {
    direction = direction === 'lt-en' ? 'en-lt' : 'lt-en';
    flipped = false;
  }
</script>

<div class="fc-review">
  {#if loading}
    <p class="muted loading" style="text-align:center;padding:40px 0;">Loading your review flashcards…</p>
  {:else if errorMsg}
    <div class="card error-box" style="text-align:center;padding:32px;max-width:500px;margin:40px auto;">
      <h2>Failed to load review</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/learn" class="btn btn-gate-pill" style="margin-top:16px;">Back to Home</a>
    </div>
  {:else if words.length === 0}
    <div class="review-empty-stage" style="text-align:center;padding:60px 20px;max-width:520px;margin:0 auto;">
      <span class="finish-icon" style="display:inline-block;margin-bottom:16px;"><Icon name="cards" size={56} /></span>
      <h2>{stats?.learned ? 'All caught up for now!' : 'Nothing to review yet'}</h2>
      <p class="muted" style="margin:12px 0 24px;">
        {stats?.learned ? 'Your words are fresh. Come back when they’re due.' : 'Words you learn in lessons show up here, right before you’d forget them.'}
      </p>
      <a href={courseBack} class="btn btn-gate-pill big">Start a lesson →</a>
    </div>
  {:else if isFinished}
    <section class="card finish" style="text-align:center;max-width:540px;margin:40px auto;padding:40px 24px;">
      <span class="finish-icon" style="display:inline-block;margin-bottom:16px;"><Icon name="cards" size={56} /></span>
      <h1 style="font-family:var(--font-display);font-size:32px;font-weight:900;">Review complete!</h1>
      <p class="muted" style="margin:8px 0 24px;">You reviewed all {words.length} learned words in shuffled order.</p>
      <div class="finish-stats" style="display:flex;justify-content:center;gap:24px;margin-bottom:32px;">
        <div class="fstat xp" style="background:#f4ed36;border:2px solid #000;border-radius:6px;padding:12px 20px;box-shadow:0 3px 0 #000;">
          <span class="mono-tag small" style="display:block;opacity:0.8;">Mastered</span>
          <b style="font-size:22px;font-weight:900;">{mastered.size}</b>
        </div>
        <div class="fstat acc" style="background:#f9f5f2;border:2px solid #000;border-radius:6px;padding:12px 20px;box-shadow:0 3px 0 #000;">
          <span class="mono-tag small" style="display:block;opacity:0.8;">Practiced</span>
          <b style="font-size:22px;font-weight:900;">{stillLearning.size}</b>
        </div>
        <div class="fstat hp" style="background:#ffd33d;border:2px solid #000;border-radius:6px;padding:12px 20px;box-shadow:0 3px 0 #000;">
          <span class="mono-tag small" style="display:block;opacity:0.8;">Cards</span>
          <b style="font-size:22px;font-weight:900;">{words.length}</b>
        </div>
      </div>
      <div class="row" style="justify-content:center;gap:12px;margin-bottom:16px;">
        <button class="btn big btn-gate-pill" onclick={reshuffle}>Shuffle & Review again</button>
        <a class="btn big outline" href={courseBack}>Done</a>
      </div>
      <a class="small" href="#/learn/words" style="color:inherit;font-weight:700;">All your words →</a>
    </section>
  {:else if currentCard}
    <header class="fc-top">
      <div class="fc-top-bar">
        <button type="button" class="icon-btn" id="fc-quit" aria-label="Quit review" onclick={() => appState.navigate(courseBack)}>
          <Icon name="close" size={20} />
        </button>
        <div class="fc-counter">Card <b>{index + 1}</b> / {deck.length}</div>
        <div class="fc-top-actions">
          <button type="button" class="btn outline small" id="fc-shuffle" title="Reshuffle deck" onclick={reshuffle}>
            Shuffle
          </button>
          <button type="button" class="btn outline small" id="fc-dir" title="Change card direction" onclick={toggleDirection}>
            {isLtFront ? `${toLanguageName.slice(0, 2).toUpperCase()} → ${fromLanguageName.slice(0, 2).toUpperCase()}` : `${fromLanguageName.slice(0, 2).toUpperCase()} → ${toLanguageName.slice(0, 2).toUpperCase()}`}
          </button>
        </div>
      </div>
      <div class="progress progress-bar" role="progressbar" aria-valuenow={index + 1} aria-valuemin="1" aria-valuemax={deck.length}>
        <i style="width: {progressPct}%;"></i>
      </div>
    </header>

    <div class="fc-stage">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div
        class="flashcard fc-card"
        class:flipped
        id="fc-card"
        tabindex="0"
        role="button"
        aria-label="Flashcard: {frontText}. Click or press space to flip."
        onclick={() => flipped = !flipped}
      >
        <!-- Front Face -->
        <div class="flashcard-face flashcard-front">
          <div class="fc-head">
            <span class="tag-chip mono-tag">{currentCard.pos || 'Word'}</span>
            {#if currentCard.gender}
              <span class="pill bone">{currentCard.gender}</span>
            {/if}
            {#if currentCard.dueAt && currentCard.dueAt <= now}
              <span class="pill due">Due for review</span>
            {:else}
              <span class="pill ok">Learned</span>
            {/if}
          </div>
          <div class="fc-body">
            <h2 class="fc-word">{frontText}</h2>
            <span class="fc-lang">{frontLang}</span>
          </div>
          <div class="fc-foot">
            <span>Tap card or press <b>Space</b> to flip</span>
          </div>
        </div>

        <!-- Back Face -->
        <div class="flashcard-face flashcard-back">
          <div class="fc-head">
            <span class="tag-chip mono-tag">{currentCard.pos || 'Meaning'}</span>
            <span class="pill ok">Answer</span>
          </div>
          <div class="fc-body">
            <h2 class="fc-word">{backText}</h2>
            <span class="fc-lang">{backLang}</span>
            {#if currentCard.note}
              <p class="fc-note">{currentCard.note}</p>
            {/if}
            {#if currentCard.also}
              <p class="fc-also muted small">Also accepted: {currentCard.also}</p>
            {/if}
          </div>
          <div class="fc-foot">
            <span>Did you recall this correctly?</span>
          </div>
        </div>
      </div>
    </div>

    <div class="fc-controls">
      {#if !flipped}
        <div class="fc-actions" id="fc-actions-unflipped">
          <button type="button" class="btn outline" id="fc-prev" disabled={index === 0} onclick={prevCard}>
            ← Previous
          </button>
          <button type="button" class="btn btn-gate-pill fc-flip" id="fc-flip-btn" onclick={() => flipped = true}>
            Flip card
          </button>
          <button type="button" class="btn outline" id="fc-skip" onclick={skipCard}>
            Skip →
          </button>
        </div>
      {:else}
        <div class="fc-rate-row" id="fc-actions-flipped">
          <button type="button" class="btn outline learning" id="fc-learning" onclick={markLearning}>
            Still learning
          </button>
          <button type="button" class="btn btn-gate-pill mastered" id="fc-mastered" onclick={markMastered}>
            Got it! ✓
          </button>
        </div>
      {/if}
      <p class="fc-keyboard-hints muted small" style="margin-top:12px;text-align:center;">
        Keyboard: <b>Space</b> flip · <b>1</b> Still learning · <b>2</b> Got it · <b>← / →</b>
      </p>
    </div>
  {/if}
</div>
