# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

WorkTrack Pro is a job, inventory & time-tracking SaaS for manufacturing. Single-package Vite + React 19 + TypeScript + Tailwind CSS frontend backed by hosted Supabase (auth, DB, storage). See `README.md` for full feature list and available npm scripts.

### Environment variables

The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (gitignored). These are injected as Cursor Cloud secrets.

**Important gotcha:** The `VITE_SUPABASE_URL` secret is currently stored with the key name duplicated in the value (i.e., the value is `VITE_SUPABASE_URL=https://...` instead of just `https://...`). The update script strips this prefix automatically when generating `.env.local`. If the secret is corrected in the future, the `sed` strip is harmless (no-op on a value that doesn't start with the prefix).

Shell environment variables override `.env.local` in Vite's env resolution. The update script unsets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the shell and writes corrected values to `.env.local` so Vite picks them up cleanly.

### Running the dev server

```bash
npm run dev          # Vite dev server on http://localhost:3000
```

Before starting, ensure no stale env vars override `.env.local`:

```bash
unset VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
```

### Key commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Format | `npm run format` |
| Test | `npm run test` |
| Build | `npm run build` |

### App routes

- `/` — Public landing page (Rough Cut Manufacturing)
- `/app` — Employee login → WorkTrack Pro dashboard
- Sign-up available via the login page

### Notes

- TypeScript type-checking (`tsc --noEmit`) is intentionally disabled in CI (see `.github/workflows/ci.yml`). Only ESLint + Vite build are used for validation.
- The Vite config conditionally enables HTTPS and PocketBase proxy only when `key.pem`/`cert.pem` exist; in Cloud Agent environments these files don't exist, so the dev server runs on plain HTTP — this is fine.
- Supabase is cloud-hosted (no local Supabase CLI setup needed). Migrations in `supabase/migrations/` are reference only.
- The Trello proxy (`npm run trello-proxy`) is optional and only needed for Trello import features.
