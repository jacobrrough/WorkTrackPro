/** @type {import('tailwindcss').Config} */
// HYBRID DESIGN SYSTEM (owner decision, 2026-07): Tailwind stays as the LAYOUT
// layer (flex/grid/gap/p-*/text-size/responsive variants); repeated APPEARANCE
// lives in the semantic `.app-*` kit (src/app/app.css) built on the `--c-*`
// theme tokens (src/index.css). Do not add new repeated appearance combos as
// inline utilities — extend the kit. Full Tailwind removal is explicitly NOT
// the goal. NOTE: changes to this file need a dev-server restart (no HMR).
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Direction E: rounded cards. Scale aligned to the public surface
      // (controls/cards ~8px, cards ~12px, large ~14px). `full` keeps Tailwind's
      // 9999px default (extend merges).
      borderRadius: {
        DEFAULT: '6px',
        none: '0',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
        '3xl': '14px',
      },
      // Semantic z-index ladder for app chrome. Values mirror the pre-existing
      // numeric ladder exactly (stacking order unchanged); the names say what
      // sits at each level. Three roles intentionally share 50 (same plane,
      // different jobs): sticky page headers, first-tier full-screen overlays
      // (scanner/file viewer/simple modals), and anchored dropdowns/popovers.
      // Above them: dialogs-on-overlays (60), bottom sheets (70), the standard
      // modal tier (100), pickers stacked on modals (120), confirm dialogs
      // (200), alerts-on-confirms (210), and toasts on top of everything (220 —
      // was an arbitrary z-[9999]). z-10/20/30 stay numeric for local,
      // in-component stacking; they are not chrome layers.
      zIndex: {
        nav: '40',
        fab: '45',
        header: '50',
        overlay: '50',
        dropdown: '50',
        dialog: '60',
        sheet: '70',
        modal: '100',
        picker: '120',
        confirm: '200',
        alert: '210',
        toast: '220',
      },
      colors: {
        // Theme tokens — resolve to CSS variables set per [data-theme] in index.css.
        // `rgb(var(--c-x) / <alpha-value>)` keeps Tailwind opacity modifiers working
        // (e.g. bg-surface/40, text-muted/70).
        primary: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
        },
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',
        // Destructive/error — distinct from the brand accent (see --c-danger).
        // `danger` = solid FILL (pair with text-on-danger). `danger-fg` = legible
        // red for danger TEXT/outlines on dark (the fill fails AA as small text).
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          hover: 'rgb(var(--c-danger-hover) / <alpha-value>)',
          fg: 'rgb(var(--c-danger-fg) / <alpha-value>)',
        },
        'on-danger': 'rgb(var(--c-on-danger) / <alpha-value>)',
        // Overlay tint (hover/zebra/pill fills). Theme-aware: white on dark, dark
        // on light — use bg-overlay/N instead of bg-white/N so light theme works.
        overlay: 'rgb(var(--c-overlay) / <alpha-value>)',
        // Legacy names kept so existing bg-background-dark / bg-card-dark / etc. re-theme.
        'background-dark': 'rgb(var(--c-bg) / <alpha-value>)',
        'background-light': 'rgb(var(--c-bg-2) / <alpha-value>)',
        'card-dark': 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-dark': 'rgb(var(--c-surface-2) / <alpha-value>)',
        // Semantic surface/line/text tokens (sweep targets these).
        app: 'rgb(var(--c-bg) / <alpha-value>)',
        'app-2': 'rgb(var(--c-bg-2) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--c-surface-3) / <alpha-value>)',
        line: 'rgb(var(--c-border) / <alpha-value>)',
        'line-strong': 'rgb(var(--c-border-strong) / <alpha-value>)',
        muted: 'rgb(var(--c-text-muted) / <alpha-value>)',
        subtle: 'rgb(var(--c-text-subtle) / <alpha-value>)',
        // `white` now means "primary foreground" so the thousands of existing
        // text-white usages flip to dark text in the light theme. Accent-filled
        // surfaces use text-on-accent instead (handled in the sweep).
        white: 'rgb(var(--c-text) / <alpha-value>)',
        // Escape hatch for the spots that must stay literally white in every
        // theme: always-black surfaces (camera scanner, lightbox) where the
        // `white`→--c-text token would flip DARK in light mode.
        'pure-white': '#ffffff',
      },
      fontFamily: {
        // Direction E typography, self-hosted (@font-face in src/index.css).
        // Display face (Schibsted) is applied via the kit's `.app-display`
        // class, not a Tailwind alias.
        sans: ['Hanken Grotesk', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'system-ui', 'Arial', 'sans-serif'],
      },
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: 0 },
          '100%': { transform: 'translateX(0)', opacity: 1 },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      },
    },
  },
  plugins: [],
}
