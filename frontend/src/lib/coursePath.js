// Progress logic for the course path: which lesson is next, and how each
// unit and lesson should be labelled.

const lessonsOf = (unit) => unit?.lessons || [];

export const isLessonDone = (lesson) => lesson.total > 0 && lesson.done >= lesson.total;

/** The first unfinished lesson in course order, else the very first lesson. */
export function findCurrentLessonId(units) {
  for (const unit of units) {
    const next = lessonsOf(unit).find((l) => l.total > 0 && l.done < l.total);
    if (next) return next.id;
  }
  return units[0]?.lessons?.[0]?.id ?? null;
}

/** The unit holding the current lesson (falls back to the first unit). */
export function activeUnitId(units, currentLessonId) {
  const unit = units.find((u) => lessonsOf(u).some((l) => l.id === currentLessonId));
  return (unit ?? units[0])?.id ?? null;
}

function sum(lessons, key) {
  return lessons.reduce((n, l) => n + (l[key] || 0), 0);
}

/** Everything the unit card shows, derived once per render. */
export function unitSummary(unit, currentLessonId) {
  const lessons = lessonsOf(unit);
  const words = sum(lessons, 'total');
  const learned = sum(lessons, 'done');
  const currentIndex = lessons.findIndex((l) => l.id === currentLessonId);
  return {
    lessons,
    words,
    learned,
    left: words - learned,
    pct: words ? Math.round((100 * learned) / words) : 0,
    done: lessons.length > 0 && lessons.every(isLessonDone),
    currentIndex,
    currentLesson: currentIndex >= 0 ? lessons[currentIndex] : null,
  };
}

/** The unit's main button: continue the current lesson, practise a finished deck, or start it. */
export function unitAction(summary) {
  if (summary.currentLesson) {
    return {
      kind: 'primary',
      href: `#/learn/lesson/${summary.currentLesson.id}`,
      label: summary.learned ? 'Continue →' : 'Start →',
      sub: `Lesson ${summary.currentIndex + 1}: ${summary.currentLesson.title} · ${summary.currentLesson.total} words`,
    };
  }
  const first = summary.lessons[0];
  if (!first) return null;
  if (summary.done) return { kind: 'secondary', href: `#/learn/lesson/${first.id}`, label: 'Practise deck', arrow: '↺' };
  return { kind: 'secondary', href: `#/learn/lesson/${first.id}`, label: summary.learned ? 'Continue deck' : 'Start deck', arrow: '→' };
}

/** Row state for one lesson: 'done' | 'current' | 'started' | 'new', plus its labels. */
export function lessonRow(lesson, isCurrent) {
  const done = isLessonDone(lesson);
  const started = lesson.done > 0;
  const state = done ? 'done' : isCurrent ? 'current' : started ? 'started' : 'new';
  const meta = {
    done: `${lesson.total} words · Completed`,
    started: `${lesson.done}/${lesson.total} learned`,
  }[state] ?? `${lesson.total} words`;
  const cta = { done: 'Review', current: 'Start →', started: 'Continue' }[state] ?? 'Start';
  return { state, meta, cta };
}

const RING_C = 2 * Math.PI * 8;

/** Stroke dash for a partial progress ring (r = 8). */
export function ringDash(done, total) {
  if (!total) return `0 ${RING_C.toFixed(1)}`;
  return `${((RING_C * Math.min(done, total)) / total).toFixed(1)} ${RING_C.toFixed(1)}`;
}
