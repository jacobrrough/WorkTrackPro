// Theme registry — the single source of truth for the appearance system.
//
// Appearance = a COLOR PALETTE (signal-red, crimson, …) × a MODE (light / dark /
// system). Every palette has both a light and a dark token set in src/index.css
// (`[data-theme='X'][data-mode='dark'|'light']`). `mode: 'system'` follows the OS
// via prefers-color-scheme. Keep the DARK/LIGHT bg maps here and the pre-paint
// script in index.html in sync with those CSS blocks.

export type ThemeId = 'signal-red' | 'deep-ocean' | 'forest' | 'ember' | 'crimson' | 'graphite';

/** How light/dark is chosen. `system` follows the OS setting. */
export type AppearanceMode = 'system' | 'light' | 'dark';

/** The effective light/dark actually applied to the DOM (system already resolved). */
export type ResolvedMode = 'light' | 'dark';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** Page background per mode — used by the no-flash pre-paint and the picker preview. */
  bg: { dark: string; light: string };
  /** Representative colors for the picker swatch (literal preview colors, dark look). */
  swatch: { bg: string; surface: string; accent: string; muted: string };
}

// The shared light background (all palettes use a clean neutral light surface; the
// palette identity in light mode comes through the accent). Mirrors index.css.
const LIGHT_BG = '#f4f6f9';

export const THEMES: ThemeMeta[] = [
  {
    id: 'signal-red',
    label: 'Signal Red',
    description: 'The default — crimson red accent.',
    bg: { dark: '#121214', light: LIGHT_BG },
    swatch: { bg: '#121214', surface: '#1e2024', accent: '#ea4444', muted: '#a8aeb7' },
  },
  {
    id: 'deep-ocean',
    label: 'Deep Ocean',
    description: 'Cool navy with a sky-blue accent.',
    bg: { dark: '#07121f', light: LIGHT_BG },
    swatch: { bg: '#07121f', surface: '#102438', accent: '#0ea5e9', muted: '#8fb4cf' },
  },
  {
    id: 'forest',
    label: 'Forest',
    description: 'Deep green with an emerald accent.',
    bg: { dark: '#07140e', light: LIGHT_BG },
    swatch: { bg: '#07140e', surface: '#102a1d', accent: '#10b981', muted: '#8fc6ae' },
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Warm charcoal with an amber accent.',
    bg: { dark: '#15100a', light: LIGHT_BG },
    swatch: { bg: '#15100a', surface: '#2a1f12', accent: '#f59e0b', muted: '#cdb38c' },
  },
  {
    id: 'crimson',
    label: 'Crimson',
    description: 'A rose-red accent.',
    bg: { dark: '#150407', light: LIGHT_BG },
    swatch: { bg: '#150407', surface: '#2a0f15', accent: '#f43f5e', muted: '#cd8f99' },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral grayscale, minimal color.',
    bg: { dark: '#0c0d10', light: LIGHT_BG },
    swatch: { bg: '#0c0d10', surface: '#1a1c22', accent: '#cbd5e1', muted: '#9aa4b3' },
  },
];

export const DEFAULT_THEME: ThemeId = 'signal-red';
export const DEFAULT_MODE: AppearanceMode = 'system';
export const THEME_STORAGE_KEY = 'worktrack-theme';
export const MODE_STORAGE_KEY = 'worktrack-mode';

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));
const MODES: AppearanceMode[] = ['system', 'light', 'dark'];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value);
}

export function isMode(value: unknown): value is AppearanceMode {
  return typeof value === 'string' && (MODES as string[]).includes(value);
}

/**
 * Coerce a stored value to a valid palette. The removed 'daylight' theme was a
 * standalone light theme, so anyone on it kept the default palette (their light
 * preference is captured separately by setting mode to 'light' — see readStoredMode).
 */
export function coerceThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
