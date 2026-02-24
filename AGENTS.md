# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

WorkTrack Pro is a job, inventory & time-tracking SaaS for manufacturing. Single-package Vite + React 19 + TypeScript + Tailwind CSS frontend backed by hosted Supabase (auth, DB, storage). See `README.md` for full feature list and available npm scripts.

### Environment variables

The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (gitignored). These are injected as Cursor Cloud secrets.

The update script writes these from the injected shell env vars into `.env.local`. A `sed` strip removes any accidental `VITE_SUPABASE_URL=` prefix in the value (safe no-op if the secret is already correctly formatted).

**Vite env priority:** Shell environment variables override `.env.local`. The update script unsets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the shell after writing `.env.local` so Vite reads the file values.

### Running the dev server

```bash
npm run dev          # Vite dev server on http://localhost:3000
```

### Authentication

Test login credentials are available as `TEST_LOGIN_USERNAME` and `TEST_LOGIN_PASSWORD` secrets. Note: the Supabase instance has email confirmation enabled, so new accounts created via sign-up won't be able to log in until confirmed. To bypass this for test accounts, a `SUPABASE_SERVICE_ROLE_KEY` is needed (not currently configured).

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
