<script>
  import { openQuests, percent, rankLabel } from '../format.js';

  /** stats: /learn stats object; board: /leaderboard?period=week response */
  let { stats = null, board = null } = $props();

  let todayXP = $derived(stats?.days?.at(-1)?.xp ?? stats?.today ?? 0);
  let quests = $derived(openQuests(stats?.xp));
  let rank = $derived(rankLabel(board));
</script>

<aside class="dash-side">
  <details class="card widget dash-collapsible-card dash-today-card profile-card" open>
    <summary class="widget-head dash-collapsible-summary dash-today-summary">
      <div class="dash-collapsible-title-wrap">
        <span class="dash-collapsible-chev" aria-hidden="true">▾</span>
        <h3>Today</h3>
      </div>
      <div class="dash-progress-summary-meta">
        {#if stats?.due}
          <span class="pill due mono-tag">{stats.due} due</span>
        {/if}
        <span class="pill mono-tag" class:ok={todayXP > 0}>{todayXP > 0 ? `+${todayXP}` : 0} XP</span>
        <span class="dash-progress-quick-stats mono-tag">{stats?.streak ?? 0}d · {stats?.learned ?? 0} learned</span>
      </div>
    </summary>

    <div class="dash-collapsible-body dash-progress-body">
      <div class="stat-row">
        <div class="stat-box"><span>Streak</span><b>{stats?.streak ?? 0}d</b></div>
        <div class="stat-box"><span>XP</span><b>{stats?.xp ?? 0}</b></div>
        <div class="stat-box"><span>Learned</span><b>{stats?.learned ?? 0}</b></div>
        <div class="stat-box"><span>Due</span><b>{stats?.due ?? 0}</b></div>
      </div>

      {#if stats?.due}
        <a class="btn btn-gate-pill block" href="#/learn/review">Review {stats.due} words now</a>
      {:else if stats?.learned}
        <p class="stat-note">All caught up! Next review soon.</p>
      {/if}

      {#if quests.length > 0}
        <div class="dash-today-quests">
          <div class="dash-activity-head"><span class="muted small mono-tag">Active quests</span></div>
          <ul class="quests">
            {#each quests as q (q)}
              <li>
                <div class="row spread mono-tag">
                  <span>Earn {q} XP</span>
                  <span class="muted small">{stats?.xp ?? 0}/{q}</span>
                </div>
                <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={q} aria-valuenow={stats?.xp ?? 0}>
                  <i style:width="{percent(stats?.xp, q)}%"></i>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="dash-side-links">
        <a class="small mono-tag" href="#/learn/words">All your words</a>
        {#if stats?.learned}
          <a class="small mono-tag" href="#/learn/review">Shuffled flashcards</a>
        {/if}
      </div>
    </div>
  </details>

  <div class="card widget dash-rank-card">
    <a href="#/leaderboard" class="dash-rank-line">
      <span class="dash-rank-title">Leaderboard</span>
      <span class="dash-rank-val mono-tag">{rank} →</span>
    </a>
  </div>
</aside>
