# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

WorkTrack Pro is a job/inventory/time-tracking SaaS for Rough Cut Manufacturing. It is a single-page React 19 + TypeScript + Vite frontend that talks to a hosted Supabase backend. See `README.md` for the full feature list and `package.json` `scripts` for available commands.

### Running the app

- **Dev server:** `npm run dev` (Vite on port 3000, HTTP by default)
- The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. Without valid Supabase credentials, the UI renders fully but auth/data calls will fail.
- HTTPS is optional and only activates if `key.pem` and `cert.pem` exist in the project root (used for mobile camera access on the shop floor).

### Lint / Test / Build

Standard commands from `package.json`:

| Task | Command |
|------|---------|
| Lint | `npm run lint` |
| Format check | `npx prettier --check "src/**/*.{ts,tsx,css,json}"` |
| Tests | `npm run test` |
| Build | `npm run build` |

- TypeScript `tsc --noEmit` is intentionally disabled in CI due to TS6305 / strict-type issues; Vite handles transpilation.
- ESLint uses flat config (`eslint.config.js`, ESLint 9).

### Gotchas

- The Vite config imports a custom Trello proxy plugin from `vite/trelloProxyPlugin.ts`. This is always loaded, but only relevant if Trello env vars are set.
- PocketBase proxy rules in `vite.config.ts` only activate when HTTPS certs are present; they are ignored in the standard HTTP dev setup.
- The project uses `@` path alias mapped to `src/` (configured in `vite.config.ts`).
