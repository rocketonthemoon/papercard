// Hash routing in one place: which page a hash shows, its title, and which
// navigation item it belongs to. Components read these instead of matching
// hashes themselves.

const PARAM_ROUTES = [
  { name: 'duel', re: /^#\/duel\/([A-Za-z0-9]{6})$/i, param: (m) => m[1].toUpperCase() },
  { name: 'coursePath', re: /^#\/learn\/course\/(\d+)$/, param: (m) => Number(m[1]) },
  { name: 'lesson', re: /^#\/learn\/lesson\/(\d+)$/, param: (m) => Number(m[1]) },
  { name: 'courseDetail', re: /^#\/course\/(\d+)$/, param: (m) => Number(m[1]) },
  { name: 'studioEditor', re: /^#\/studio\/(\d+)$/, param: (m) => Number(m[1]) },
  { name: 'profile', re: /^#\/u\/([A-Za-z0-9_]{1,40})$/, param: (m) => m[1] },
];

// Checked in order after the parameterised routes; first prefix match wins.
const PREFIX_ROUTES = [
  ['#/learn/review', 'review'],
  ['#/learn/words', 'words'],
  ['#/studio', 'studio'],
  ['#/discover', 'discover'],
  ['#/play', 'play'],
  ['#/leaderboard', 'leaderboard'],
  ['#/admin', 'admin'],
];

const PUBLIC_HASHES = new Set(['#/landing', '#/about']);

/** Resolve a location hash to `{ name, param }`. Signed-out visitors always get the landing page. */
export function resolveRoute(hash, signedIn) {
  if (!signedIn || PUBLIC_HASHES.has(hash)) return { name: 'landing', param: null };
  for (const r of PARAM_ROUTES) {
    const m = r.re.exec(hash);
    if (m) return { name: r.name, param: r.param(m) };
  }
  const prefix = PREFIX_ROUTES.find(([p]) => hash.startsWith(p));
  return { name: prefix ? prefix[1] : 'learn', param: null };
}

const TITLES = {
  learn: 'Home',
  coursePath: 'Course',
  lesson: 'Lesson',
  review: 'Review',
  words: 'Your words',
  courseDetail: 'Course',
  discover: 'Discover',
  play: 'Play',
  duel: 'Duel',
  leaderboard: 'Leaderboard',
  studio: 'Studio',
  studioEditor: 'Studio',
  admin: 'Admin',
  profile: 'Profile',
  landing: '',
};

export function pageTitle(hash) {
  return TITLES[resolveRoute(hash, true).name] ?? '';
}

// Which navigation entry is highlighted for each route.
const NAV_FOR_ROUTE = {
  learn: 'learn',
  coursePath: 'learn',
  lesson: 'learn',
  words: 'learn',
  review: 'review',
  discover: 'discover',
  courseDetail: 'discover',
  play: 'play',
  duel: 'play',
  leaderboard: 'leaderboard',
  studio: 'studio',
  studioEditor: 'studio',
  admin: 'admin',
};

export function activeNav(hash) {
  return NAV_FOR_ROUTE[resolveRoute(hash, true).name] ?? null;
}

/** Lesson and duel play run full-screen without the app chrome. */
export function isFocusRoute(hash) {
  return hash.startsWith('#/learn/lesson');
}

export const NAV_ITEMS = [
  { key: 'learn', href: '#/learn', icon: 'home', label: 'Home' },
  { key: 'review', href: '#/learn/review', icon: 'review', label: 'Review' },
  { key: 'discover', href: '#/discover', icon: 'courses', label: 'Discover' },
  { key: 'play', href: '#/play', icon: 'play', label: 'Play' },
  { key: 'leaderboard', href: '#/leaderboard', icon: 'trophy', label: 'Leaders' },
  { key: 'studio', href: '#/studio', icon: 'studio', label: 'Studio' },
  { key: 'admin', href: '#/admin', icon: 'admin', label: 'Admin', adminOnly: true },
];

export function navItemsFor(user) {
  return NAV_ITEMS.filter((item) => !item.adminOnly || user?.isAdmin);
}

/** The bottom bar has room for six tabs; admins get Admin in Studio's place, as before. */
export function mobileNavItemsFor(user) {
  const hidden = user?.isAdmin ? 'studio' : 'admin';
  return NAV_ITEMS.filter((item) => item.key !== hidden);
}

export function avatarLetter(user) {
  const name = user?.name || user?.username || '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function profileHref(user) {
  return user?.username ? `#/u/${user.username}` : '#/learn';
}
