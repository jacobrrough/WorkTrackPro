import { DEFAULT_THEME, THEME_STORAGE_KEY, getThemeMeta, isThemeId, type ThemeId } from './themes';

/**
 * Activate a theme by setting data-theme on <html>. The per-theme CSS variable
 * block in index.css drives every color (including the html background and
 * color-scheme), so here we only flip the attribute, refresh the mobile
 * theme-color meta, and clear the inline styles the pre-paint script set in
 * index.html to avoid a first-paint flash.
 */
export function applyTheme(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const meta = getThemeMeta(id);
  const root = document.documentElement;
  root.setAttribute('data-theme', id);
  root.style.removeProperty('background');
  root.style.removeProperty('color');
  root.style.removeProperty('color-scheme');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', meta.swatch.accent);
}

export function readStoredTheme(): ThemeId {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // ignore (private mode / storage disabled)
  }
}
