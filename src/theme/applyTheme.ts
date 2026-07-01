import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  coerceThemeId,
  getThemeMeta,
  isMode,
  type AppearanceMode,
  type ResolvedMode,
  type ThemeId,
} from './themes';

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true; // default dark when unknown
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Turn the user's mode choice into the concrete light/dark that hits the DOM. */
export function resolveMode(mode: AppearanceMode): ResolvedMode {
  return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode;
}

/**
 * Activate a palette + mode by setting data-theme (palette) and data-mode
 * (resolved light/dark) on <html>. The per-block CSS in index.css drives every
 * color and color-scheme, so here we only flip the attributes, refresh the mobile
 * theme-color meta, and clear the inline styles the pre-paint script set.
 */
export function applyTheme(theme: ThemeId, mode: AppearanceMode): void {
  if (typeof document === 'undefined') return;
  const meta = getThemeMeta(theme);
  const resolved = resolveMode(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', resolved);
  root.style.removeProperty('background');
  root.style.removeProperty('color');
  root.style.removeProperty('color-scheme');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', resolved === 'light' ? meta.bg.light : meta.swatch.accent);
  }
}

export function readStoredTheme(): ThemeId {
  try {
    return coerceThemeId(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore (private mode / storage disabled)
  }
}

export function readStoredMode(): AppearanceMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isMode(stored)) return stored;
    // Migration: anyone on the removed 'daylight' theme was choosing light mode.
    if (localStorage.getItem(THEME_STORAGE_KEY) === 'daylight') return 'light';
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function storeMode(mode: AppearanceMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

/** Subscribe to OS light/dark changes (only meaningful while mode is 'system'). */
export function watchSystemMode(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
