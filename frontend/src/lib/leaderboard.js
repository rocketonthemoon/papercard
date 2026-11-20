// Leaderboard layout: podium order and the viewer's standing line.

const PODIUM = [
  { index: 1, place: 'second', size: 48 },
  { index: 0, place: 'first', size: 56 },
  { index: 2, place: 'third', size: 44 },
];

/** Top three arranged 2nd · 1st · 3rd; missing places are null (keeps the grid aligned). */
export function podiumSpots(rows) {
  return PODIUM.map(({ index, place, size }) => (rows[index] ? { row: rows[index], place, size, rank: index + 1 } : null));
}

/** Everyone after the podium, capped so the page stays short. */
export function restOfBoard(rows, limit = 20) {
  return rows.slice(3, limit);
}

/** A line about the viewer when they aren't visible in the list above, else null. */
export function standingNote(rows, me, period) {
  if (rows.some((r) => r.isYou)) return null;
  if (me?.rank) return `You're #${me.rank} with ${me.xp} XP.`;
  return period === 'week'
    ? "You're not on this week's board yet. Finish a lesson to earn XP."
    : "You're not on the board yet. Finish a lesson to earn XP.";
}

export function periodFromHash(hash) {
  return hash.includes('/all') ? 'all' : 'week';
}
