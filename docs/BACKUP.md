# Backups and data safety

WorkTrack Pro uses **Supabase** for database, auth, and storage. Data lives in Supabase’s managed Postgres and object storage, not in a local SQLite or single-file DB.

## Supabase backups

- **Free tier:** Supabase does not guarantee daily backups. Use **Database → Backups** in the dashboard to create manual exports when needed.
- **Pro (and above):** Daily backups are included. Enable **Point-in-Time Recovery (PITR)** in **Project Settings → Database** for 7-day (or longer) recovery.
- **Manual export:** In Supabase Dashboard → **Database → Backups**, use “Backup now” or export via SQL/CSV for critical snapshots before big changes.

## Recommendations

1. **Enable PITR** if you’re on a paid plan — one bad deploy or accidental delete can be reverted.
2. **Before major migrations:** Run a manual backup or note the restore point.
3. **Secrets:** Keep `SUPABASE_SERVICE_ROLE_KEY` and any Resend/Turnstile keys in a password manager or secret store; they’re not recoverable from the DB.

## Netlify / app hosting

The app is static + serverless (Netlify). No app data is stored on the build or runtime host; all persistent data is in Supabase. Backing up “the app” is just backing up Supabase (and your repo).
