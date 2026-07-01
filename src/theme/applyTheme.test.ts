import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  applyTheme,
  readStoredMode,
  readStoredTheme,
  resolveMode,
  storeMode,
  storeTheme,
} from './applyTheme';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getThemeMeta,
} from './themes';

/** Stub window.matchMedia with a fixed prefers-color-scheme answer. */
function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveMode', () => {
  it('passes explicit light/dark through untouched', () => {
    expect(resolveMode('light')).toBe('light');
    expect(resolveMode('dark')).toBe('dark');
  });

  it("resolves 'system' from the OS preference", () => {
    stubMatchMedia(true);
    expect(resolveMode('system')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveMode('system')).toBe('light');
  });

  it("defaults 'system' to dark when matchMedia is unavailable", () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveMode('system')).toBe('dark');
  });
});

describe('readStoredTheme / readStoredMode (localStorage + daylight migration)', () => {
  it('round-trips a stored palette and mode', () => {
    storeTheme('deep-ocean');
    storeMode('light');
    expect(readStoredTheme()).toBe('deep-ocean');
    expect(readStoredMode()).toBe('light');
  });

  it("coerces a stored removed 'daylight' theme to the default palette", () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'daylight');
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });

  it("migrates 'daylight' users to light MODE when no mode is stored", () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'daylight');
    expect(readStoredMode()).toBe('light');
  });

  it('an explicit stored mode wins over the daylight migration', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'daylight');
    localStorage.setItem(MODE_STORAGE_KEY, 'dark');
    expect(readStoredMode()).toBe('dark');
  });

  it('falls back to defaults for garbage stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'not-a-theme');
    localStorage.setItem(MODE_STORAGE_KEY, 'not-a-mode');
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
    expect(readStoredMode()).toBe(DEFAULT_MODE);
  });
});

describe('applyTheme (DOM attributes + theme-color meta)', () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  });

  afterEach(() => {
    meta.remove();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-mode');
  });

  it('sets data-theme (palette) and RESOLVED data-mode on <html>', () => {
    applyTheme('forest', 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('forest');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });

  it("never writes 'system' to data-mode (system resolves first)", () => {
    stubMatchMedia(false);
    applyTheme('graphite', 'system');
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
  });

  it('updates the mobile theme-color meta per mode (light bg vs accent)', () => {
    applyTheme('ember', 'light');
    expect(meta.getAttribute('content')).toBe(getThemeMeta('ember').bg.light);
    applyTheme('ember', 'dark');
    expect(meta.getAttribute('content')).toBe(getThemeMeta('ember').swatch.accent);
  });

  it('clears the pre-paint inline styles', () => {
    const root = document.documentElement;
    root.style.background = '#000';
    root.style.color = '#fff';
    applyTheme('signal-red', 'dark');
    expect(root.style.background).toBe('');
    expect(root.style.color).toBe('');
  });
});
