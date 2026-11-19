<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import Icon from '../lib/components/Icon.svelte';
  import {
    inputKind,
    instructionFor,
    keyHint,
    hasAnswer,
    answerBody,
    optionForKey,
    tilesFor,
    accuracy,
  } from '../lib/lessonSession.js';

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

  // Turn state: 'check' while answering, 'continue' while showing the result
  let turnMode = $state('check');
  let selectedOptionId = $state(null);
  let typedText = $state('');
  let builtTiles = $state([]);
  let availableTiles = $state([]);
  let checking = $state(false);
  let lastResult = $state(null);
  let showHint = $state(false);

  function focusOnMount(node) {
    node.focus();
  }

  onMount(async () => {
    try {
      const res = await api(`/learn/lessons/${id}`);
      lesson = res.lesson;
      course = res.course;
      queue = [...(res.challenges || [])];
      totalCount = queue.length;
      setupChallenge(queue[0]);
    } catch (e) {
      errorMsg = e.message || 'Failed to load lesson';
    } finally {
      loading = false;
    }
  });

  let currentChallenge = $derived(queue[0] || null);
  let kind = $derived(inputKind(currentChallenge));
  let targetLang = $derived(course?.toLang || 'Lithuanian');
  let progressPct = $derived(totalCount ? (100 * solvedCount) / totalCount : 0);
  let answer = $derived({ selectedOptionId, builtTiles, typedText });
  let canCheck = $derived(!!currentChallenge && !checking && hasAnswer(currentChallenge, answer));
  let resultState = $derived(turnMode === 'continue' ? (lastResult?.correct ? 'right' : 'wrong') : '');

  function setupChallenge(c) {
    turnMode = 'check';
    selectedOptionId = null;
    showHint = false;
    typedText = '';
    lastResult = null;
    availableTiles = tilesFor(c);
    builtTiles = [];
  }

  function handleKeydown(e) {
    if (loading || isFinished || !currentChallenge) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (turnMode === 'continue') handleContinue();
      else if (canCheck) handleCheck();
      return;
    }
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if (typing || turnMode !== 'check') return;
    const picked = optionForKey(currentChallenge, e.key);
    if (picked !== null) selectedOptionId = picked;
  }

  function toggleTile(tile) {
    if (turnMode !== 'check') return;
    tile.used = !tile.used;
    builtTiles = tile.used ? [...builtTiles, tile] : builtTiles.filter((t) => t.id !== tile.id);
    availableTiles = [...availableTiles];
  }

  function recordResult(res) {
    lastResult = res;
    turnMode = 'continue';
    if (res.stats) appState.topStats = res.stats;
    currentChallenge.retry = !res.correct;
    if (res.correct) {
      solvedCount++;
      xpEarned += res.xp || 0;
    } else {
      mistakes++;
    }
  }

  async function handleCheck() {
    if (!canCheck) return;
    try {
      checking = true;
      const res = await api(`/learn/words/${currentChallenge.wordId}/answer`, {
        method: 'POST',
        body: answerBody(currentChallenge, answer),
      });
      recordResult(res);
    } catch (e) {
      appState.showToast(e.message || 'Failed to submit answer');
    } finally {
      checking = false;
    }
  }

  function handleContinue() {
    const prev = queue.shift();
    if (prev?.retry) queue.push(prev);
    queue = [...queue];
    if (queue.length === 0) {
      isFinished = true;
      appState.refreshTopStats();
    } else {
      setupChallenge(queue[0]);
    }
  }

  function handleExit() {
    const courseUrl = course?.id ? `#/learn/course/${course.id}` : '#/learn';
    if (isFinished || solvedCount === 0 || confirm('Quit the lesson? Finished words are saved.')) {
      appState.navigate(courseUrl);
    }
  }

  function optionState(opt) {
    if (turnMode !== 'continue' || !lastResult) return '';
    if (opt.id === lastResult.correctOptionId) return 'right';
    if (!lastResult.correct && opt.id === selectedOptionId) return 'wrong';
    return '';
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="lesson lesson-frame">
  <header class="lesson-top">
    <button type="button" class="icon-btn" id="quit" aria-label="Quit lesson" onclick={handleExit}>
      <Icon name="close" size={20} />
    </button>
    <div
      class="progress progress-bar lesson-bar"
      role="progressbar"
      aria-label="Lesson progress"
      aria-valuemin="0"
      aria-valuemax={totalCount}
      aria-valuenow={solvedCount}
    >
      <i id="prog" style="width: {progressPct}%;"></i>
    </div>
  </header>

  <main class="lesson-body" id="stage">
    {#if loading}
      <p class="page-loading lesson-loading" role="status">Loading lesson…</p>
    {:else if errorMsg}
      <section class="card finish">
        <h2>Couldn't load this lesson</h2>
        <p class="muted">{errorMsg}</p>
        <button class="btn btn-gate-pill" onclick={handleExit}>Go back</button>
      </section>
    {:else if isFinished}
      <section class="card finish">
        <span class="finish-icon"><Icon name="cup" size={56} /></span>
        <h1>Lesson complete!</h1>
        {#if lesson}
          <p class="muted">{[lesson.unitTitle, lesson.title].filter(Boolean).join(' · ')}</p>
        {/if}
        <div class="finish-stats">
          <div class="fstat xp"><span>XP earned</span><b>+{xpEarned}</b></div>
          <div class="fstat"><span>Accuracy</span><b>{accuracy(totalCount, mistakes)}%</b></div>
        </div>
        <button class="btn big btn-gate-pill finish-cta" onclick={handleExit}>Continue</button>
      </section>
    {:else if currentChallenge}
      <div class="challenge-stage">
        <p class="challenge-kicker mono-tag">{instructionFor(currentChallenge, targetLang)}</p>
        <h2 class="prompt-text" lang={currentChallenge.kind === 'pick_en' ? 'lt' : 'en'}>
          {currentChallenge.prompt || 'Choose the correct answer'}
        </h2>

        <div class="hint-container">
          {#if currentChallenge.note}
            {#if showHint}
              <div class="hint-card" role="note">
                <span class="hint-label">Hint</span>
                <span class="hint-text">{currentChallenge.note}</span>
              </div>
            {:else}
              <button type="button" class="hint-btn" onclick={() => (showHint = true)}>
                <span class="hint-bulb" aria-hidden="true">?</span>
                Show hint
              </button>
            {/if}
          {/if}
        </div>

        {#if kind === 'pick'}
          <div class="options lesson-options" role="group" aria-label="Answers">
            {#each currentChallenge.options as opt, idx (opt.id)}
              {@const state = optionState(opt)}
              <button
                type="button"
                class="option option-tile"
                class:selected={selectedOptionId === opt.id && turnMode === 'check'}
                class:right={state === 'right'}
                class:wrong={state === 'wrong'}
                data-id={opt.id}
                aria-pressed={selectedOptionId === opt.id}
                disabled={turnMode === 'continue'}
                onclick={() => (selectedOptionId = opt.id)}
              >
                <span class="key" aria-hidden="true">{idx + 1}</span>
                <span class="option-text">{opt.text}</span>
              </button>
            {/each}
          </div>
        {:else if kind === 'build'}
          <div class="build-stage">
            <div class="built-slot" aria-label="Your answer" aria-live="polite">
              {#each builtTiles as t (t.id)}
                <button type="button" class="tile-chip placed" onclick={() => toggleTile(t)} disabled={turnMode === 'continue'}>{t.text}</button>
              {:else}
                <span class="built-placeholder">Tap the words in order</span>
              {/each}
            </div>
            <div class="available-tiles">
              {#each availableTiles as t (t.id)}
                <button type="button" class="tile-chip" class:used={t.used} disabled={t.used || turnMode === 'continue'} onclick={() => toggleTile(t)}>
                  {t.text}
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="type-stage">
            <input
              type="text"
              id="typed"
              class="type-box"
              class:right={resultState === 'right'}
              class:wrong={resultState === 'wrong'}
              lang="lt"
              placeholder="Type in {targetLang}…"
              aria-label="Your answer in {targetLang}"
              bind:value={typedText}
              disabled={turnMode === 'continue'}
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              use:focusOnMount
            />
          </div>
        {/if}
      </div>
    {/if}
  </main>

  {#if !isFinished && !loading && !errorMsg}
    <footer class="lesson-foot {resultState}" id="foot">
      <div class="foot-inner">
        <div class="feedback" id="feedback" aria-live="polite">
          {#if turnMode === 'continue' && lastResult}
            <div class="fb-body">
              <div class="fb-title">{lastResult.correct ? 'Nicely done!' : 'Correct answer:'}</div>
              <div class="fb-answer">
                <b class="fb-main" lang="lt">{lastResult.word?.lt}</b> = <span class="fb-trans">{lastResult.word?.en}</span>
              </div>
              {#if lastResult.correct && lastResult.xp}
                <div class="fb-extra">+{lastResult.xp} XP</div>
              {:else if !lastResult.correct}
                <div class="fb-status">It'll come back at the end.</div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="foot-actions">
          <span class="foot-hint mono-tag" id="foot-hint">{keyHint(currentChallenge, turnMode)}</span>
          <button
            type="button"
            class="btn big action-btn"
            id="action"
            disabled={turnMode === 'check' && !canCheck}
            onclick={turnMode === 'continue' ? handleContinue : handleCheck}
          >
            {turnMode === 'continue' ? 'Continue →' : checking ? 'Checking…' : 'Check'}
          </button>
        </div>
      </div>
    </footer>
  {/if}
</div>

<style>
  .challenge-stage {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .challenge-kicker {
    margin: 0 0 8px;
    text-align: center;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ink-black);
  }

  .prompt-text {
    margin: 0 0 16px;
    text-align: center;
    font-family: var(--font-degulardisplay-bold);
    font-size: clamp(28px, 5vw, 40px);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--color-ink-black);
    overflow-wrap: anywhere;
  }

  .hint-container {
    display: flex;
    justify-content: center;
    min-height: 8px;
    margin-bottom: 20px;
  }

  .hint-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 7px;
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border: 2px solid var(--color-ink-black);
    border-radius: var(--r-pill);
    font-family: var(--font-degularvariable);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .hint-btn:hover {
    background: #fff;
  }

  .hint-btn:focus-visible {
    outline: 3px solid var(--color-hi-vis-yellow);
    outline-offset: 2px;
  }

  .hint-bulb {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--color-hi-vis-yellow);
    border: 1.5px solid var(--color-ink-black);
    font-family: var(--font-bergenmonoregular);
    font-size: 12px;
    font-weight: 800;
  }

  .hint-card {
    display: flex;
    align-items: baseline;
    gap: 10px;
    max-width: 560px;
    padding: 10px 16px;
    background: var(--color-hi-vis-yellow);
    color: var(--color-ink-black);
    border: 2px solid var(--color-ink-black);
    border-radius: var(--r-card);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    text-align: left;
  }

  .hint-label {
    flex-shrink: 0;
    padding: 2px 7px;
    background: var(--color-ink-black);
    color: var(--color-hi-vis-yellow);
    border-radius: 4px;
    font-family: var(--font-bergenmonoregular);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .lesson-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 560px) {
    .lesson-options {
      grid-template-columns: 1fr;
    }
  }

  .option-text {
    overflow-wrap: anywhere;
  }

  /* Build: tap tiles into the answer line */
  .build-stage {
    display: grid;
    gap: 24px;
  }

  .built-slot {
    min-height: 60px;
    padding: 10px 4px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    border-bottom: 2px dashed var(--color-ink-black);
  }

  .built-placeholder {
    font-family: var(--font-bergenmonoregular);
    font-size: 13px;
    color: var(--color-ink-black);
    opacity: 0.55;
  }

  .available-tiles {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .tile-chip {
    min-height: 44px;
    padding: 8px 16px;
    background: var(--color-bone-white);
    color: var(--color-ink-black);
    border: 2px solid var(--color-ink-black);
    border-radius: var(--r-card);
    font-family: var(--font-degularvariable);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }

  .tile-chip.placed {
    background: var(--color-hi-vis-yellow);
  }

  .tile-chip.used {
    opacity: 0.25;
    cursor: default;
  }

  .tile-chip:focus-visible {
    outline: 3px solid var(--color-hi-vis-yellow);
    outline-offset: 2px;
  }

  .type-stage {
    width: 100%;
  }

  .type-stage :global(.type-box) {
    width: 100%;
    box-sizing: border-box;
  }

  /* Result footer text */
  .fb-title {
    font-weight: 800;
    font-size: 18px;
    color: var(--color-ink-black);
  }

  .wrong .fb-title {
    color: var(--color-firecracker-red);
  }

  .fb-answer,
  .fb-extra {
    margin-top: 4px;
  }

  .fb-extra {
    font-weight: 700;
  }

  .fb-status {
    margin-top: 4px;
    font-size: 13px;
    opacity: 0.8;
  }
</style>
