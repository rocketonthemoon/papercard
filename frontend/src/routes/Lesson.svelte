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

  // Turn state: mode is 'check' or 'continue'
  let turnMode = $state('check');
  let selectedOptionId = $state(null);
  let typedText = $state('');
  let builtTiles = $state([]);
  let availableTiles = $state([]);
  let checking = $state(false);
  let lastResult = $state(null);

  onMount(async () => {
    try {
      loading = true;
      const res = await api(`/learn/lessons/${id}`);
      lesson = res.lesson;
      course = res.course;

      const challenges = res.challenges || [];
      queue = [...challenges];
      totalCount = queue.length;
      setupChallenge(queue[0]);
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

  let currentChallenge = $derived(queue[0] || null);
  let progressPct = $derived(totalCount ? (100 * solvedCount) / totalCount : 0);

  function setupChallenge(c) {
    turnMode = 'check';
    selectedOptionId = null;
    typedText = '';
    lastResult = null;
    if (c?.tiles) {
      availableTiles = c.tiles.map((t, idx) => ({ id: idx, text: t, used: false }));
      builtTiles = [];
    } else {
      availableTiles = [];
      builtTiles = [];
    }
  }

  function handleKeydown(e) {
    if (loading || isFinished || !currentChallenge) return;
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    if (e.key === 'Enter') {
      e.preventDefault();
      if (turnMode === 'continue') {
        handleContinue();
      } else if (canCheck()) {
        handleCheck();
      }
      return;
    }

    if (!typing && turnMode === 'check' && currentChallenge.options && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (currentChallenge.options[idx]) {
        selectedOptionId = currentChallenge.options[idx].id;
      }
    }
  }

  function canCheck() {
    if (!currentChallenge || checking) return false;
    if (currentChallenge.options) return selectedOptionId !== null;
    if (currentChallenge.tiles) return builtTiles.length > 0;
    return typedText.trim().length > 0;
  }

  function toggleTile(tile) {
    if (turnMode !== 'check') return;
    if (tile.used) {
      // Remove from built
      builtTiles = builtTiles.filter(t => t.id !== tile.id);
      tile.used = false;
    } else {
      builtTiles.push(tile);
      tile.used = true;
    }
    availableTiles = [...availableTiles];
    builtTiles = [...builtTiles];
  }

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
      } else if (currentChallenge.tiles) {
        body.text = builtTiles.map(t => t.text).join(' ');
      } else {
        body.text = typedText.trim();
      }

      const res = await api(`/learn/words/${currentChallenge.wordId}/answer`, {
        method: 'POST',
        body,
      });

      lastResult = res;
      turnMode = 'continue';

      if (res.stats) {
        appState.topStats = res.stats;
      }

      if (res.correct) {
        solvedCount++;
        xpEarned += (res.xp || 0);
        currentChallenge.retry = false;
      } else {
        mistakes++;
        currentChallenge.retry = true;
      }
    } catch (e) {
      appState.showToast(e.message || 'Failed to submit answer');
    } finally {
      checking = false;
    }
  }

  function handleContinue() {
    const prev = queue.shift();
    if (prev && prev.retry) {
      queue.push(prev);
    }
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
    if (solvedCount === 0 || confirm('Quit the lesson? Finished words are saved.')) {
      appState.navigate(courseUrl);
    }
  }
</script>

<div class="lesson lesson-frame">
  <header class="lesson-top">
    <button type="button" class="icon-btn" id="quit" aria-label="Quit" onclick={handleExit}>
      <Icon name="close" size={20} />
    </button>
    <div class="progress progress-bar lesson-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax={totalCount}>
      <i id="prog" style="width: {progressPct}%;"></i>
    </div>
  </header>

  <main class="lesson-body" id="stage">
    {#if loading}
      <p class="muted loading" style="text-align:center;padding:40px;">Loading lesson…</p>
    {:else if errorMsg}
      <div class="card error-card" style="text-align:center;padding:40px;">
        <h2>Failed to load lesson</h2>
        <p class="muted">{errorMsg}</p>
        <button class="btn btn-gate-pill" onclick={handleExit}>Go Back</button>
      </div>
    {:else if isFinished}
      <section class="card finish" style="text-align:center;max-width:540px;margin:40px auto;padding:40px 24px;">
        <span class="finish-icon" style="display:inline-block;margin-bottom:16px;">
          <Icon name="cup" size={56} />
        </span>
        <h1 style="font-family:var(--font-display);font-size:32px;font-weight:900;letter-spacing:-0.03em;">Lesson complete!</h1>
        <p class="muted" style="margin:8px 0 24px;">{lesson ? `${lesson.unitTitle || ''} · ${lesson.title}` : ''}</p>
        <div class="finish-stats" style="display:flex;justify-content:center;gap:24px;margin-bottom:32px;">
          <div class="fstat xp" style="background:#f4ed36;border:2px solid #000;border-radius:6px;padding:12px 20px;box-shadow:0 3px 0 #000;">
            <span class="small mono-tag" style="display:block;opacity:0.8;">Total XP</span>
            <b style="font-size:22px;font-weight:900;">+{xpEarned}</b>
          </div>
          <div class="fstat acc" style="background:#f9f5f2;border:2px solid #000;border-radius:6px;padding:12px 20px;box-shadow:0 3px 0 #000;">
            <span class="small mono-tag" style="display:block;opacity:0.8;">Accuracy</span>
            <b style="font-size:22px;font-weight:900;">{Math.round((100 * totalCount) / (totalCount + mistakes))}%</b>
          </div>
        </div>
        <button class="btn big btn-gate-pill" style="min-width:200px;" onclick={handleExit}>Continue</button>
      </section>
    {:else if currentChallenge}
      <div class="challenge-stage">
        <h2 class="prompt-text" style="font-family:var(--font-display);font-size:28px;font-weight:900;margin-bottom:24px;text-align:center;">
          {currentChallenge.prompt || 'Choose the correct answer'}
        </h2>

        <!-- Options (Multiple Choice) -->
        {#if currentChallenge.options}
          <div class="options-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;max-width:600px;margin:0 auto;">
            {#each currentChallenge.options as opt, idx}
              {@const isSel = selectedOptionId === opt.id}
              {@const isCorrectOpt = turnMode === 'continue' && lastResult && opt.id === lastResult.correctOptionId}
              {@const isWrongSel = turnMode === 'continue' && lastResult && !lastResult.correct && isSel}
              <button
                type="button"
                class="option option-tile"
                class:selected={isSel && turnMode === 'check'}
                class:right={isCorrectOpt}
                class:wrong={isWrongSel}
                data-id={opt.id}
                aria-pressed={isSel}
                disabled={turnMode === 'continue'}
                onclick={() => selectedOptionId = opt.id}
                style="display:flex;align-items:center;padding:16px 20px;background:#f9f5f2;border:2px solid #000;border-radius:6px;box-shadow:0 3px 0 #000;font-size:17px;font-weight:700;text-align:left;cursor:pointer;"
              >
                <span class="mono-tag" style="display:inline-block;width:24px;height:24px;line-height:20px;border-radius:4px;border:1.5px solid #000;text-align:center;font-size:12px;margin-right:12px;background:#fff;">{idx + 1}</span>
                <span>{opt.text}</span>
              </button>
            {/each}
          </div>
        {:else if currentChallenge.tiles}
          <!-- Word Building Tiles -->
          <div class="build-stage" style="max-width:600px;margin:0 auto;">
            <div class="built-slot" style="min-height:56px;padding:12px;border-bottom:2px dashed #000;display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;">
              {#each builtTiles as t}
                <button type="button" class="tile-chip" onclick={() => toggleTile(t)} style="padding:8px 16px;background:#ffd33d;border:2px solid #000;border-radius:6px;font-weight:700;cursor:pointer;">
                  {t.text}
                </button>
              {/each}
            </div>
            <div class="available-tiles" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
              {#each availableTiles as t}
                <button
                  type="button"
                  class="tile-chip"
                  disabled={t.used}
                  onclick={() => toggleTile(t)}
                  style="padding:8px 16px;background:{t.used ? '#ddd' : '#f9f5f2'};border:2px solid #000;border-radius:6px;font-weight:700;cursor:pointer;opacity:{t.used ? 0.3 : 1};"
                >
                  {t.text}
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <!-- Text Typing -->
          <div class="type-stage" style="max-width:500px;margin:0 auto;text-align:center;">
            <input
              type="text"
              id="typed"
              class="typed-input"
              placeholder="Type your translation in Lithuanian..."
              bind:value={typedText}
              disabled={turnMode === 'continue'}
              autocomplete="off"
              autofocus
              style="width:100%;padding:14px 18px;font-size:18px;border:2px solid #000;border-radius:6px;box-shadow:0 3px 0 #000;margin-bottom:12px;"
            />
          </div>
        {/if}
      </div>
    {/if}
  </main>

  <footer class="lesson-foot {turnMode === 'continue' ? (lastResult?.correct ? 'right' : 'wrong') : ''}" id="foot">
    <div class="foot-inner">
      <div class="feedback" id="feedback">
        {#if turnMode === 'continue' && lastResult}
          {#if lastResult.correct}
            <div class="fb-body">
              <div class="fb-title" style="font-weight:900;font-size:18px;color:#000;">Nicely done!</div>
              <div class="fb-answer" style="margin-top:4px;">
                <b class="fb-main">{lastResult.word?.lt}</b> = <span class="fb-trans">{lastResult.word?.en}</span>
              </div>
              {#if lastResult.xp}
                <div class="fb-extra" style="font-weight:700;margin-top:4px;">+{lastResult.xp} XP</div>
              {/if}
            </div>
          {:else}
            <div class="fb-body">
              <div class="fb-title" style="font-weight:900;font-size:18px;color:#c94245;">Correct answer:</div>
              <div class="fb-answer" style="margin-top:4px;">
                <b class="fb-main">{lastResult.word?.lt}</b> = <span class="fb-trans">{lastResult.word?.en}</span>
              </div>
              <div class="fb-status" style="font-size:13px;opacity:0.8;margin-top:4px;">It'll come back at the end.</div>
            </div>
          {/if}
        {/if}
      </div>

      <div class="foot-actions">
        <span class="foot-hint mono-tag" id="foot-hint">
          {turnMode === 'continue' ? 'Press Enter to continue' : 'Press 1-4 · Enter to check'}
        </span>
        <button
          type="button"
          class="btn big action-btn"
          id="action"
          disabled={turnMode === 'check' && !canCheck()}
          onclick={turnMode === 'continue' ? handleContinue : handleCheck}
        >
          {turnMode === 'continue' ? 'Continue →' : 'Check'}
        </button>
      </div>
    </div>
  </footer>
</div>
