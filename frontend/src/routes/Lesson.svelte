<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let lesson = $state(null);
  let course = $state(null);
  let queue = $state([]);
  let totalCount = $state(0);
  let solvedCount = $state(0);
  let xpEarned = $state(0);
  let mistakes = $state(0);
  let isFinished = $state(false);

  // Current turn state
  let selectedOptionId = $state(null);
  let typedText = $state('');
  let isChecked = $state(false);
  let checking = $state(false);
  let result = $state(null); // API response: { correct, expected, xp, word, correctOptionId, ... }

  onMount(async () => {
    try {
      loading = true;
      const res = await api(`/learn/lessons/${id}`);
      lesson = res.lesson;
      course = res.course;

      const all = res.challenges || [];
      const practice = all.length > 0 && all.every(c => c.completed);
      const initialQueue = practice ? all : all.filter(c => !c.completed);

      queue = initialQueue.length > 0 ? initialQueue : all;
      totalCount = queue.length;
    } catch (e) {
      errorMsg = e.message || 'Failed to load lesson';
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
    if (loading || isFinished || !currentChallenge) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (isChecked) {
        handleContinue();
      } else if (canCheck) {
        handleCheck();
      }
      return;
    }

    if (!isChecked && currentChallenge.options) {
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (currentChallenge.options[idx]) {
          selectedOptionId = currentChallenge.options[idx].id;
        }
      }
    }
  }

  let currentChallenge = $derived(queue[0] || null);
  let progressPct = $derived(totalCount ? Math.round((100 * solvedCount) / totalCount) : 0);

  let canCheck = $derived(() => {
    if (!currentChallenge) return false;
    if (currentChallenge.options) return selectedOptionId !== null;
    return typedText.trim().length > 0;
  });

  async function handleCheck() {
    if (!canCheck() || checking) return;
    try {
      checking = true;
      const body = {
        kind: currentChallenge.kind,
        review: false,
      };

      if (currentChallenge.options) {
        body.optionId = selectedOptionId;
      } else {
        body.text = typedText.trim();
      }

      const res = await api(`/learn/words/${currentChallenge.wordId}/answer`, {
        method: 'POST',
        body,
      });

      result = res;
      isChecked = true;

      if (res.correct) {
        solvedCount++;
        xpEarned += (res.xp || 0);
      } else {
        mistakes++;
        // Retry at the end of the queue
        currentChallenge.retry = true;
      }
    } catch (e) {
      appState.showToast(e.message || 'Failed to submit answer');
    } finally {
      checking = false;
    }
  }

  function handleContinue() {
    isChecked = false;
    result = null;
    selectedOptionId = null;
    typedText = '';

    const prev = queue.shift();
    if (prev && prev.retry) {
      prev.retry = false;
      queue.push(prev);
    }

    queue = [...queue];

    if (queue.length === 0) {
      isFinished = true;
      appState.refreshTopStats();
    }
  }

  function handleExit() {
    const courseUrl = course?.id ? `#/learn/course/${course.id}` : '#/learn';
    if (solvedCount === 0 || confirm('Quit the lesson? Finished words are saved.')) {
      appState.navigate(courseUrl);
    }
  }
</script>

<div class="lesson-runner">
  {#if loading}
    <div class="card loading-box">
      <p class="muted">Loading lesson…</p>
    </div>
  {:else if errorMsg}
    <div class="card error-box">
      <h2>Unable to load lesson</h2>
      <p class="muted">{errorMsg}</p>
      <a href="#/learn" class="btn primary">Back to Home</a>
    </div>
  {:else if isFinished}
    <!-- Finished Screen -->
    <div class="card finish-card">
      <div class="finish-icon">
        <Icon name="trophy" size={56} />
      </div>
      <h2>Lesson complete!</h2>
      <p class="muted">{lesson?.title || 'Lesson'} · {totalCount} words practiced</p>

      <div class="finish-stats">
        <div class="fstat">
          <span class="mono-tag muted">Total XP</span>
          <b class="xp-val">+{xpEarned}</b>
        </div>
        <div class="fstat">
          <span class="mono-tag muted">Accuracy</span>
          <b>{Math.round((100 * solvedCount) / Math.max(1, solvedCount + mistakes))}%</b>
        </div>
      </div>

      <div class="finish-actions">
        <a href="#/learn/course/{course?.id || ''}" class="btn primary">
          Continue course →
        </a>
      </div>
    </div>
  {:else if currentChallenge}
    <!-- Lesson Arena Top -->
    <header class="lesson-topbar">
      <button type="button" class="icon-btn sm" onclick={handleExit} title="Quit lesson">
        <Icon name="close" size={16} />
      </button>

      <div class="progress-track">
        <div class="progress-bar" style="width: {progressPct}%;"></div>
      </div>
    </header>

    <!-- Challenge Card -->
    <main class="challenge-stage">
      <div class="prompt-section">
        <h1 class="prompt-heading">
          {currentChallenge.kind === 'pick_en'
            ? 'What does this mean?'
            : currentChallenge.kind === 'pick_lt'
            ? 'How do you say this in Lithuanian?'
            : 'Write this in Lithuanian'}
        </h1>

        <div class="word-card">
          <b class="prompt-word">{currentChallenge.prompt}</b>
          {#if currentChallenge.pos}
            <span class="pill sm">{currentChallenge.pos}</span>
          {/if}
        </div>
      </div>

      <!-- Multiple Choice Options -->
      {#if currentChallenge.options}
        <div class="options-grid">
          {#each currentChallenge.options as opt, i}
            {@const isSelected = selectedOptionId === opt.id}
            {@const isCorrect = isChecked && result?.correctOptionId === opt.id}
            {@const isWrong = isChecked && isSelected && !result?.correct}

            <button
              type="button"
              class="option-item"
              class:selected={isSelected && !isChecked}
              class:correct={isCorrect}
              class:wrong={isWrong}
              disabled={isChecked}
              onclick={() => selectedOptionId = opt.id}
            >
              <span class="opt-num mono-tag">{i + 1}</span>
              <span class="opt-text">{opt.text}</span>
            </button>
          {/each}
        </div>
      {:else}
        <!-- Text Input -->
        <div class="type-input-wrap">
          <input
            type="text"
            class="type-input"
            placeholder="Type your translation..."
            disabled={isChecked}
            bind:value={typedText}
          />
        </div>
      {/if}
    </main>

    <!-- Bottom Sticky Feedback Footer -->
    <footer
      class="feedback-bar"
      class:correct={isChecked && result?.correct}
      class:wrong={isChecked && !result?.correct}
    >
      <div class="bar-inner">
        <div class="feedback-msg">
          {#if isChecked}
            {#if result.correct}
              <div class="feedback-content">
                <span class="pill matcha mono-tag">CORRECT</span>
                <b class="feedback-title">Nicely done! +{result.xp || 10} XP</b>
                {#if result.word}
                  <p class="trans-pair"><b>{result.word.lt}</b> = {result.word.en}</p>
                {/if}
              </div>
            {:else}
              <div class="feedback-content">
                <span class="pill pink mono-tag">INCORRECT</span>
                <b class="feedback-title">Correct answer:</b>
                <p class="trans-pair"><b>{result.expected || result.word?.lt}</b> = {result.word?.en}</p>
              </div>
            {/if}
          {:else}
            <span class="hint-text mono-tag muted small">
              {currentChallenge.options ? 'Press 1-4 · Enter to check' : 'Type answer · Enter to check'}
            </span>
          {/if}
        </div>

        <div class="action-wrap">
          {#if isChecked}
            <button
              type="button"
              class="btn primary"
              onclick={handleContinue}
            >
              Continue →
            </button>
          {:else}
            <button
              type="button"
              class="btn primary"
              disabled={!canCheck() || checking}
              onclick={handleCheck}
            >
              {checking ? 'Checking...' : 'Check'}
            </button>
          {/if}
        </div>
      </div>
    </footer>
  {/if}
</div>

<style>
  .lesson-runner {
    max-width: 680px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 80vh;
  }

  .loading-box, .error-box, .finish-card {
    text-align: center;
    padding: 48px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .finish-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .finish-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    width: 100%;
    max-width: 340px;
    margin: 10px 0;
  }

  .fstat {
    background: rgba(26, 26, 26, 0.04);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-card);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .xp-val {
    color: var(--color-hi-vis-yellow);
    text-shadow: 1px 1px 0 var(--color-ink-black);
  }

  .lesson-topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .progress-track {
    flex: 1;
    height: 10px;
    background: rgba(26, 26, 26, 0.15);
    border: 1.5px solid var(--color-ink-black);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--color-hi-vis-yellow);
    border-radius: var(--radius-pill);
    transition: width 0.25s ease;
  }

  .challenge-stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding-bottom: 90px;
  }

  .prompt-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .prompt-heading {
    font-size: 18px;
    font-weight: 700;
    color: var(--ink-60);
  }

  .word-card {
    background: var(--color-bone-white);
    border: var(--border-thick);
    border-radius: var(--radius-card);
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    box-shadow: 0 4px 0 rgba(26, 26, 26, 0.2);
  }

  .prompt-word {
    font-family: var(--font-display);
    font-size: clamp(28px, 5vw, 40px);
    font-weight: 800;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  @media (max-width: 560px) {
    .options-grid {
      grid-template-columns: 1fr;
    }
  }

  .option-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    font-size: 15px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    transition: transform 0.08s ease, background-color 0.1s ease;
  }

  .option-item:hover:not(:disabled) {
    background: rgba(244, 237, 54, 0.4);
    transform: translateY(-1px);
  }

  .option-item.selected {
    background: var(--color-hi-vis-yellow);
    box-shadow: 0 2px 0 var(--color-ink-black);
  }

  .option-item.correct {
    background: var(--color-matcha-cream) !important;
  }

  .option-item.wrong {
    background: var(--color-bubblegum-pink) !important;
  }

  .opt-num {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1px solid var(--color-ink-black);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    background: var(--color-bone-white);
  }

  .type-input-wrap {
    width: 100%;
  }

  .type-input {
    width: 100%;
    padding: 14px 18px;
    border: var(--border-thick);
    border-radius: var(--radius-card);
    background: var(--color-bone-white);
    font-family: inherit;
    font-size: 18px;
    font-weight: 600;
  }

  /* Feedback bar */
  .feedback-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    min-height: 80px;
    background: var(--color-bone-white);
    border-top: var(--border-thick);
    z-index: 80;
    display: flex;
    align-items: center;
    padding: 12px 20px;
  }

  .feedback-bar.correct {
    background: #d4eac0;
  }

  .feedback-bar.wrong {
    background: #fcd5d0;
  }

  .bar-inner {
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .feedback-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .trans-pair {
    font-size: 13.5px;
  }
</style>
