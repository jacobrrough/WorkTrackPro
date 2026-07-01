// Theme registry — the single source of truth for selectable themes.
// The actual color values live as CSS variables in src/index.css ([data-theme] blocks).
// Keep `bg` here and the THEME_BG map in index.html in sync with those blocks.

export type ThemeId =
  | 'signal-red'
  | 'deep-ocean'
  | 'forest'
  | 'ember'
  | 'crimson'
  | 'graphite'
  | 'daylight';

export type ThemeMode = 'dark' | 'light';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  mode: ThemeMode;
  /** Page background, used for the no-flash pre-paint and the picker preview. */
  bg: string;
  /** Representative colors for the picker swatch (literal preview colors). */
  swatch: { bg: string; surface: string; accent: string; muted: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'signal-red',
    label: 'Signal Red',
    description: 'The default — crimson red on charcoal.',
    mode: 'dark',
    bg: '#121214',
    swatch: { bg: '#121214', surface: '#1e2024', accent: '#ea4444', muted: '#a8aeb7' },
  },
  {
    id: 'deep-ocean',
    label: 'Deep Ocean',
    description: 'Cool navy with a sky-blue accent.',
    mode: 'dark',
    bg: '#07121f',
    swatch: { bg: '#07121f', surface: '#102438', accent: '#0ea5e9', muted: '#8fb4cf' },
  },
  {
    id: 'forest',
    label: 'Forest',
    description: 'Deep green with an emerald accent.',
    mode: 'dark',
    bg: '#07140e',
    swatch: { bg: '#07140e', surface: '#102a1d', accent: '#10b981', muted: '#8fc6ae' },
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Warm charcoal with an amber accent.',
    mode: 'dark',
    bg: '#15100a',
    swatch: { bg: '#15100a', surface: '#2a1f12', accent: '#f59e0b', muted: '#cdb38c' },
  },
  {
    id: 'crimson',
    label: 'Crimson',
    description: 'Dark with a rose-red accent.',
    mode: 'dark',
    bg: '#150407',
    swatch: { bg: '#150407', surface: '#2a0f15', accent: '#f43f5e', muted: '#cd8f99' },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral grayscale, minimal color.',
    mode: 'dark',
    bg: '#0c0d10',
    swatch: { bg: '#0c0d10', surface: '#1a1c22', accent: '#cbd5e1', muted: '#9aa4b3' },
  },
  {
    id: 'daylight',
    label: 'Daylight',
    description: 'Light mode — dark text on white.',
    mode: 'light',
    bg: '#f4f6f9',
    swatch: { bg: '#f4f6f9', surface: '#ffffff', accent: '#9333ea', muted: '#4a5568' },
  },
];

export const DEFAULT_THEME: ThemeId = 'signal-red';
export const THEME_STORAGE_KEY = 'worktrack-theme';

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value);
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
