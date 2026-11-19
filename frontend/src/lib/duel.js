// Duel helpers: timing, answer bookkeeping and the results summary.

/** 75000 → "1:15". Missing values read as "0:00". */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The next unanswered question after `at`, wrapping to the start; -1 when all are answered. */
export function nextUnanswered(answers, at) {
  const after = answers.indexOf(null, at + 1);
  return after >= 0 ? after : answers.indexOf(null);
}

const storageKey = (code) => `labas-duel-${code}`;

/** Answers saved in this browser for an unfinished duel, else a fresh array. */
export function loadSavedAnswers(code, count) {
  const fresh = Array(count).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(code)) || 'null');
    return Array.isArray(saved) && saved.length === count ? saved : fresh;
  } catch {
    return fresh;
  }
}

export function saveAnswers(code, answers) {
  try {
    localStorage.setItem(storageKey(code), JSON.stringify(answers));
  } catch {
    /* storage may be unavailable (private mode); answers still live in memory */
  }
}

export function clearSavedAnswers(code) {
  try {
    localStorage.removeItem(storageKey(code));
  } catch {
    /* nothing to clear */
  }
}

const POINTS_PER_ANSWER = 10;

/** 'waiting' until someone else has played, then 'won' | 'lost' | 'tie' (players arrive ranked). */
function duelOutcome(winner, tie, players) {
  if (!winner) return 'waiting';
  if (tie) return 'tie';
  return players[0]?.isYou ? 'won' : 'lost';
}

/** The viewer's own numbers; the server sends `you` as null before they've played. */
function yourScore(you, count, maxPoints) {
  const me = you || {};
  const correct = me.correct || 0;
  return {
    correct,
    wrong: count - correct,
    points: me.points || 0,
    maxPoints: maxPoints || count * POINTS_PER_ANSWER,
    elapsed: formatDuration(me.elapsedMs),
  };
}

/** Headline numbers and the outcome line for the results screen. */
export function resultSummary(results) {
  const { count = 0, winner = null, tie = false, maxPoints, you } = results || {};
  const players = results?.players || [];
  return {
    count,
    ...yourScore(you, count, maxPoints),
    players,
    hasOpponent: players.some((p) => !p.isYou),
    outcome: duelOutcome(winner, tie, players),
    winner,
  };
}

export function outcomeText(summary) {
  switch (summary.outcome) {
    case 'won':
      return 'You win!';
    case 'lost':
      return `${summary.winner} wins!`;
    case 'tie':
      return "It's a tie!";
    default:
      return 'Waiting for a friend to play. Send them the invite link!';
  }
}
