<script>
  import { api } from '../lib/api.js';
  import { appState } from '../lib/state.svelte.js';
  import { tintClass, percent, plural } from '../lib/format.js';
  import { findCurrentLessonId, activeUnitId, unitSummary, unitAction, lessonRow, ringDash } from '../lib/coursePath.js';
  import Icon from '../lib/components/Icon.svelte';
  import TodayCard from '../lib/components/TodayCard.svelte';

  let { id } = $props();

  let loading = $state(true);
  let errorMsg = $state('');
  let course = $state(null);
  let units = $state([]);
  let stats = $state(null);
  let board = $state(null);
  let openUnits = $state(new Set());

  async function loadData(cid) {
    try {
      loading = true;
      errorMsg = '';
      const [data, boardData] = await Promise.all([
        api(`/learn?course=${cid}`),
        api('/leaderboard?period=week').catch(() => ({ rows: [] })),
      ]);
      course = data.course;
      units = data.units || [];
      stats = data.stats || null;
      board = boardData || { rows: [] };
      if (stats) appState.topStats = stats;

      const unitId = activeUnitId(units, findCurrentLessonId(units));
      openUnits = new Set(unitId ? [unitId] : []);
    } catch (e) {
      errorMsg = e.message || 'Failed to load course path';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (id) loadData(id);
  });

  let current = $derived(findCurrentLessonId(units));
  let totalWords = $derived(course?.words || 0);
  let learnedWords = $derived(course?.learned || 0);
  let coursePct = $derived(percent(learnedWords, totalWords));

  function toggleUnit(unitId) {
    const next = new Set(openUnits);
    if (next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    openUnits = next;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  // ---- deck feedback
  const FEEDBACK_CATEGORIES = [
    ['typo', 'Typo or mistake'],
    ['accepted', 'Missing answer'],
    ['confusing', 'Confusing'],
    ['other', 'Other'],
  ];
  let feedbackUnit = $state(null);
  let feedbackRating = $state(5);
  let feedbackCategory = $state(null);
  let feedbackText = $state('');
  let feedbackError = $state('');
  let sendingFeedback = $state(false);

  function openFeedback(u, rating = 5) {
    feedbackUnit = u;
    feedbackRating = rating;
    feedbackCategory = null;
    feedbackText = '';
    feedbackError = '';
  }

  async function submitFeedback(e) {
    e.preventDefault();
    if (!feedbackUnit) return;
    try {
      sendingFeedback = true;
      await api(`/learn/units/${feedbackUnit.id}/feedback`, {
        method: 'POST',
        body: { rating: feedbackRating, category: feedbackCategory, text: feedbackText.trim() },
      });
      feedbackUnit.feedbackSent = true;
      feedbackUnit = null;
      appState.showToast('Thanks for the suggestion!');
    } catch (err) {
      feedbackError = err.message || 'Failed to submit feedback';
    } finally {
      sendingFeedback = false;
    }
  }

  function onModalKey(e) {
    if (e.key === 'Escape') feedbackUnit = null;
  }
</script>

<svelte:window onkeydown={feedbackUnit ? onModalKey : undefined} />

<div>
  {#if loading}
    <p class="page-loading" role="status">Loading course path…</p>
  {:else if errorMsg || !course}
    <section class="card picker page-error">
      <header class="picker-head">
        <h2>Course not found</h2>
        <p class="muted">{errorMsg || 'Could not load this course.'}</p>
      </header>
      <div class="row picker-actions">
        <a class="btn btn-gate-pill" href="#/learn">Back to my courses</a>
      </div>
    </section>
  {:else}
    <div class="dash">
      <div class="dash-main course-path">
        <nav class="toolbar course-breadcrumb-bar" aria-label="Breadcrumb">
          <div class="breadcrumb-trail">
            <a class="back" href="#/learn">← My courses</a>
            <span class="breadcrumb-sep" aria-hidden="true">/</span>
            <span class="breadcrumb-current" aria-current="page">{course.title}</span>
          </div>
          <div class="toolbar-actions">
            {#if course.mine}
              <a class="btn outline small" href="#/studio/{course.id}">Edit in Studio</a>
            {/if}
            <a class="linkbtn small quiet-link" href="#/course/{course.id}">About course</a>
          </div>
        </nav>

        <section class="card course-hero-path {tintClass(course.id)}">
          <div class="course-hero-inner">
            <div class="course-hero-text">
              <h1 class="course-hero-title">{course.title}</h1>
              <div class="course-hero-meta mono-tag">
                {#if course.creator?.official}<span>Official</span>{/if}
                <span>{course.fromLang} → {course.toLang}</span>
                <span>{plural(totalWords, 'word')}</span>
                <span>{plural(units.length, 'deck')}</span>
              </div>
              {#if course.description}
                <p class="course-hero-desc">{course.description}</p>
              {/if}
              <div class="course-path-progress">
                <div class="row spread small mono-tag">
                  <span><b>{coursePct}%</b> complete</span>
                  <span class="meta-words">{totalWords > learnedWords ? `${totalWords - learnedWords} words left` : 'All learned!'}</span>
                </div>
                <div class="bar"><i style="width:{coursePct}%"></i></div>
              </div>
              {#if current}
                <div class="course-hero-cta">
                  <a class="btn btn-gate-pill small" href="#/learn/lesson/{current}">{learnedWords > 0 ? 'Continue →' : 'Start →'}</a>
                </div>
              {/if}
            </div>
          </div>
        </section>

        <div class="unit-cards-list">
          {#each units as u, ui (u.id)}
            {@const s = unitSummary(u, current)}
            {@const action = unitAction(s)}
            {@const isOpen = openUnits.has(u.id)}

            <section class="card module-card unit-card" class:open={isOpen} data-unit={u.id}>
              <!-- The chevron button is the keyboard control; the whole header is a larger click target. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="module-head" onclick={() => toggleUnit(u.id)}>
                <span class="module-no mono-tag">Unit {pad2(ui + 1)}<small>/{pad2(units.length)}</small></span>
                <div class="module-info">
                  <div class="module-title-row">
                    <h2>{u.title}</h2>
                    {#if u.level}<span class="pill level-pill mono-tag">{u.level}</span>{/if}
                  </div>
                  {#if u.description}<p class="module-desc">{u.description}</p>{/if}
                </div>
                <button
                  type="button"
                  class="chev icon-btn"
                  aria-label="{isOpen ? 'Hide' : 'Show'} lessons in {u.title}"
                  aria-expanded={isOpen}
                  onclick={(e) => { e.stopPropagation(); toggleUnit(u.id); }}
                >
                  <Icon name="chev" size={14} />
                </button>
              </div>

              <div class="module-progress">
                <div class="row spread mono-tag unit-progress-label">
                  <span><b>{s.pct}%</b> complete</span>
                  <span class="muted small">{s.left ? `${s.left} words left` : 'All learned'}</span>
                </div>
                <div class="bar unit-bar"><i style="width:{s.pct}%"></i></div>

                {#if action?.kind === 'primary'}
                  <div class="module-action">
                    <a class="btn unit-primary-btn" href={action.href}>
                      <span>{action.label}</span>
                      <small class="unit-btn-sub">{action.sub}</small>
                    </a>
                  </div>
                {:else if action}
                  <div class="module-action">
                    <a class="btn outline unit-secondary-btn" href={action.href}>
                      <span>{action.label}</span> <span class="btn-arrow" aria-hidden="true">{action.arrow}</span>
                    </a>
                  </div>
                {/if}
              </div>

              <ul class="lesson-rows">
                {#each s.lessons as l, li (l.id)}
                  {@const row = lessonRow(l, l.id === current)}
                  <li>
                    <a
                      class="lesson-row-link lesson-node link-plain"
                      class:current={row.state === 'current'}
                      class:done={row.state === 'done'}
                      href="#/learn/lesson/{l.id}"
                    >
                      <span class="lesson-num step-badge" class:done={row.state === 'done'} class:current={row.state === 'current'}>
                        {#if row.state === 'done'}
                          <Icon name="check" size={12} /><span class="sr-only">Completed</span>
                        {:else}
                          {#if row.state === 'current'}<span class="badge-dot-inner"></span>{/if}{li + 1}
                        {/if}
                      </span>

                      <div class="lesson-step-content">
                        <span class="lesson-title">Lesson {li + 1}: {l.title}</span>
                        <span class="lesson-step-meta mono-tag">{row.meta}</span>
                      </div>

                      <span class="lesson-state mono-tag">
                        <svg class="ring" viewBox="0 0 20 20" aria-hidden="true">
                          {#if row.state === 'done'}
                            <circle cx="10" cy="10" r="9" fill="var(--green)" />
                            <path d="M6 10.3l2.6 2.6L14 7.6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                          {:else if !l.done}
                            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="2.2 2.4" />
                          {:else}
                            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" stroke-width="2" />
                            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--green)" stroke-width="2" stroke-dasharray={ringDash(l.done, l.total)} stroke-linecap="round" transform="rotate(-90 10 10)" />
                          {/if}
                        </svg>
                        <span class="lesson-cta-text">{row.cta}</span>
                      </span>

                      <span class="lesson-end" aria-hidden="true"><Icon name="chev" size={14} /></span>
                    </a>
                  </li>
                {:else}
                  <li class="lesson-rows-empty muted small mono-tag">No lessons yet.</li>
                {/each}
              </ul>

              {#if s.done && !u.feedbackSent}
                <div class="unit-done compact">
                  <div>
                    <b>Deck complete! How was it?</b>
                    <p class="muted small mono-tag">Tell the creator what to improve.</p>
                  </div>
                  <div class="stars" role="group" aria-label="Rate this deck">
                    {#each [1, 2, 3, 4, 5] as n (n)}
                      <button type="button" class="star-btn" onclick={() => openFeedback(u, n)} aria-label={plural(n, 'star')}>
                        <Icon name="star" size={20} />
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              <div class="module-foot mono-tag">
                <span class="muted small">{plural(s.lessons.length, 'lesson')} · {plural(s.words, 'word')}</span>
              </div>
            </section>
          {:else}
            <section class="card picker">
              <header class="picker-head">
                <h2>No lessons yet</h2>
                <p class="muted">The creator has not added any lessons to this course yet.</p>
              </header>
            </section>
          {/each}
        </div>
      </div>

      <TodayCard {stats} {board} />
    </div>

    {#if feedbackUnit}
      <div class="modal-back" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <form class="modal modal-box card feedback-modal" onsubmit={submitFeedback}>
          <button type="button" class="icon-btn modal-close" aria-label="Close" onclick={() => (feedbackUnit = null)}>
            <Icon name="close" size={16} />
          </button>
          <h2 id="fb-title">Suggest an improvement</h2>
          <p class="muted small">Deck: <b>{feedbackUnit.title}</b></p>

          <div class="stars big" role="radiogroup" aria-label="How was this deck?">
            {#each [1, 2, 3, 4, 5] as n (n)}
              <button
                type="button"
                class="star-btn"
                class:on={n <= feedbackRating}
                role="radio"
                aria-checked={n === feedbackRating}
                aria-label={plural(n, 'star')}
                onclick={() => (feedbackRating = n)}
              >
                <Icon name="star" size={30} />
              </button>
            {/each}
          </div>

          <div class="fb-cats" role="group" aria-label="What kind of suggestion?">
            {#each FEEDBACK_CATEGORIES as [k, label] (k)}
              <button
                type="button"
                class="pill mono-tag small {feedbackCategory === k ? 'yellow' : 'bone'}"
                aria-pressed={feedbackCategory === k}
                onclick={() => (feedbackCategory = feedbackCategory === k ? null : k)}
              >
                {label}
              </button>
            {/each}
          </div>

          <label class="field fb-field">
            <span>What should change?</span>
            <textarea
              bind:value={feedbackText}
              maxlength="1000"
              required
              placeholder="For example: “stotelė” should also accept “autobusų stotelė”…"
            ></textarea>
          </label>

          {#if feedbackError}
            <p class="form-error" role="alert">{feedbackError}</p>
          {/if}

          <div class="row modal-actions">
            <button type="button" class="btn outline small" onclick={() => (feedbackUnit = null)}>Cancel</button>
            <button type="submit" class="btn btn-gate-pill small" disabled={sendingFeedback}>
              {sendingFeedback ? 'Sending…' : 'Send suggestion'}
            </button>
          </div>
        </form>
      </div>
    {/if}
  {/if}
</div>
