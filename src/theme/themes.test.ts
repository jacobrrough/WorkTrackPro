import { describe, it, expect } from 'vitest';

import { THEMES, DEFAULT_THEME, coerceThemeId, getThemeMeta, isThemeId, isMode } from './themes';

describe('theme registry', () => {
  it('every palette has both a dark and a light background (palette × mode contract)', () => {
    for (const t of THEMES) {
      expect(t.bg.dark).toMatch(/^#/);
      expect(t.bg.light).toMatch(/^#/);
    }
  });

  it('DEFAULT_THEME exists in the registry', () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });
});

describe('isThemeId / isMode', () => {
  it('accepts every registered palette id', () => {
    for (const t of THEMES) expect(isThemeId(t.id)).toBe(true);
  });

  it('rejects removed/unknown palettes and non-strings', () => {
    expect(isThemeId('daylight')).toBe(false); // removed palette
    expect(isThemeId('midnight-purple')).toBe(false); // pre-redesign default
    expect(isThemeId('')).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it('accepts exactly system|light|dark as modes', () => {
    expect(isMode('system')).toBe(true);
    expect(isMode('light')).toBe(true);
    expect(isMode('dark')).toBe(true);
    expect(isMode('daylight')).toBe(false);
    expect(isMode(null)).toBe(false);
  });
});

describe('coerceThemeId (stored-value migration)', () => {
  it('passes valid palettes through unchanged', () => {
    for (const t of THEMES) expect(coerceThemeId(t.id)).toBe(t.id);
  });

  it("migrates the removed 'daylight' theme to the default palette", () => {
    expect(coerceThemeId('daylight')).toBe(DEFAULT_THEME);
  });

  it("migrates the old 'midnight-purple' default to the default palette", () => {
    expect(coerceThemeId('midnight-purple')).toBe(DEFAULT_THEME);
  });

  it('falls back to the default for garbage input', () => {
    expect(coerceThemeId(null)).toBe(DEFAULT_THEME);
    expect(coerceThemeId(undefined)).toBe(DEFAULT_THEME);
    expect(coerceThemeId('')).toBe(DEFAULT_THEME);
    expect(coerceThemeId(123)).toBe(DEFAULT_THEME);
  });
});

describe('getThemeMeta', () => {
  it('returns the matching meta for each id', () => {
    for (const t of THEMES) expect(getThemeMeta(t.id).id).toBe(t.id);
  });
});
