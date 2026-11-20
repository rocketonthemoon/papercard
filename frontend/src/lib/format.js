// Small display helpers shared by the route components.

const LANGUAGE_CODES = {
  lithuanian: 'LT',
  english: 'EN',
  spanish: 'ES',
  french: 'FR',
  german: 'DE',
};

/** Two-letter badge for a course's target language, e.g. "LT". */
export function courseFlag(course) {
  if (course?.toCode) return course.toCode.toUpperCase();
  const lang = (course?.toLang || '').trim().toLowerCase();
  if (!lang) return 'LT';
  return LANGUAGE_CODES[lang] ?? lang.slice(0, 2).toUpperCase();
}

/** One of six card tints, stable per id. */
export function tintClass(id) {
  return `tint-${Math.abs(Number(id) || 0) % 6}`;
}

/** Whole-number percentage of part/total, clamped to 0–100; 0 when total is 0. */
export function percent(part, total) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((100 * (part || 0)) / total)));
}

/** "1 deck", "12 decks". Pass the plural when it isn't word + "s". */
export function plural(n, word, many = `${word}s`) {
  const count = Number(n) || 0;
  return `${count} ${count === 1 ? word : many}`;
}

/** First letter of a person's display name, for avatar placeholders. */
export function initial(person) {
  const name = (person?.name || person?.username || '').trim();
  return name ? name.charAt(0).toUpperCase() : '?';
}

/** "#3 this week" when the viewer is on the board, otherwise a nudge to earn XP. */
export function rankLabel(board) {
  const rank = board?.rows?.find((r) => r.isYou)?.rank ?? board?.me?.rank;
  return rank ? `#${rank} this week` : 'Not ranked yet';
}

/** XP milestones the learner hasn't reached yet (at most three). */
export function openQuests(xp, milestones = [100, 250, 500, 1000, 2500]) {
  return milestones.filter((q) => q > (xp || 0)).slice(0, 3);
}
