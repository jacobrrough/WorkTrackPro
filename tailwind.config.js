/** @type {import('tailwindcss').Config} */
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
      colors: {
        // Theme tokens — resolve to CSS variables set per [data-theme] in index.css.
        // `rgb(var(--c-x) / <alpha-value>)` keeps Tailwind opacity modifiers working
        // (e.g. bg-surface/40, text-muted/70).
        primary: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
        },
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
        // Escape hatches for the rare spots that must stay literally white/black
        // in every theme (e.g. light text on a dark status badge).
        'pure-white': '#ffffff',
        'pure-black': '#000000',
      },
      fontFamily: {
        // Direction E typography, self-hosted (@font-face in src/index.css).
        sans: ['Hanken Grotesk', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'system-ui', 'Arial', 'sans-serif'],
        display: ['Schibsted Grotesk', 'Hanken Grotesk', 'system-ui', 'Arial', 'sans-serif'],
      },
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scan-line': 'scanLine 2s ease-in-out infinite',
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
        scanLine: {
          '0%, 100%': { transform: 'translateY(0)', opacity: 0.8 },
          '50%': { transform: 'translateY(256px)', opacity: 1 },
        },
      },
    },
  },
  plugins: [],
}
