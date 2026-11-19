/**
 * Papercard Reactive State Management (Svelte 5 Runes)
 */
import { api, getMe, getConfig, authLogout } from './api.js';

class AppState {
  user = $state(null);
  config = $state({ googleClientId: null, devLogin: false });
  topStats = $state(null);
  currentCourse = $state(null);
  toastMessage = $state(null);
  toastTimer = null;
  hash = $state(typeof window !== 'undefined' ? window.location.hash || '#/' : '#/');
  isLoading = $state(true);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.hash = window.location.hash || '#/';
      });
    }
  }

  async init() {
    try {
      this.isLoading = true;
      const [cfg, me] = await Promise.all([
        getConfig().catch(() => ({ googleClientId: null, devLogin: false })),
        getMe().catch(() => null),
      ]);
      this.config = cfg;
      this.user = me;
      if (this.user) {
        await this.refreshTopStats();
      }
    } finally {
      this.isLoading = false;
    }
  }

  async refreshTopStats() {
    if (!this.user) return;
    try {
      const stats = await api('/learn/stats');
      this.topStats = stats;
    } catch {
      // silently ignore stats error
    }
  }

  showToast(msg, duration = 3000) {
    this.toastMessage = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = null;
    }, duration);
  }

  navigate(path) {
    if (typeof window !== 'undefined') {
      window.location.hash = path.startsWith('#') ? path : `#${path}`;
    }
  }

  async logout() {
    try {
      await authLogout();
    } catch {
      // ignore logout failure
    }
    if (typeof window !== 'undefined') {
      window.google?.accounts?.id?.disableAutoSelect?.();
    }
    this.user = null;
    this.topStats = null;
    this.hash = '#/landing';
    if (typeof window !== 'undefined') {
      window.location.hash = '#/landing';
    }
  }
}

export const appState = new AppState();
