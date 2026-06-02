/**
 * Build-time feature flags.
 *
 * Values come from Vite env (import.meta.env.VITE_*) and are baked at build time.
 * Written as a direct `=== 'true'` comparison so Vite/Rollup can fold it to a
 * compile-time constant and dead-strip gated branches (and their lazy chunks) when
 * the flag is off.
 */

/**
 * WorkTrackAccounting module gate.
 *
 * When false (the default), the accounting routes are never registered, so the
 * module is unreachable and its lazy chunks are stripped from the production build —
 * the main app is completely unaffected. Set VITE_ACCOUNTING_ENABLED=true in
 * .env.local to develop the module locally, or in Netlify/Railway env + redeploy to
 * graduate it to production.
 */
export const ACCOUNTING_BUILD_ENABLED = import.meta.env.VITE_ACCOUNTING_ENABLED === 'true';
