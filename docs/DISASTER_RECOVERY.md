# Disaster Recovery & Secret-Custody Note

Operational companion to [`BACKUP.md`](./BACKUP.md). That doc covers _how backups work_;
this one covers _what to do when something goes wrong_ and _how the secrets that protect
the financial data are held and rotated_. Written so an auditor, a CPA, or a future
operator can follow it cold.

**Stack recap.** WorkTrack Pro is a static SPA + Netlify serverless functions in front of
a managed **Supabase** project (Postgres + Auth + Storage). All persistent data —
including the entire accounting module (`accounting` schema) and the QuickBooks
connection — lives in Supabase. The build/runtime hosts (Netlify) hold **no** durable
data. So "recover WorkTrack" = "recover the Supabase project" + "redeploy from git" +
"restore the secrets."

---

## 1. Recovery objectives (RPO / RTO)

| Term                               | Target                          | Depends on                                                                   |
| ---------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| **RPO** (max acceptable data loss) | ≤ 5 min (Pro + PITR) · else ≤ last manual backup | Supabase plan. PITR streams WAL continuously; free tier = manual export age. |
| **RTO** (max time to restore)      | ≤ 2 hours                       | Supabase restore time + a Netlify redeploy (minutes) + secret re-entry.      |

**Action that makes the targets real:** be on Supabase **Pro** with **Point-in-Time
Recovery** enabled (Project Settings → Database → PITR). Without PITR, RPO is only as good
as the last manual backup, and an accidental delete between backups is unrecoverable.
This single setting is the highest-leverage DR control for the accounting data.

---

## 2. What can fail, and the response

### A. Bad migration / accidental mass delete / data corruption

1. **Stop writes** if feasible — put the app in maintenance or pull the Netlify deploy
   (Netlify → Deploys → "Stop auto publishing"), so no new rows fight the restore.
2. **Restore the database:**
   - _PITR (Pro):_ Dashboard → Database → Backups → **Point in Time** → pick a timestamp
     a few minutes before the bad event → Restore.
   - _Daily backup (Pro):_ Database → Backups → restore the most recent good snapshot.
   - _Free tier:_ restore your last manual export (Database → Backups, or `psql` the SQL
     dump). Accept loss back to that export.
3. **Re-run only the _good_ migrations** if the restore predates an intended schema
   change. Migrations live in `supabase/migrations/`; apply in filename (timestamp) order.
4. **Verify** with the monthly-close reconcile pass (see
   [`MONTHLY_CLOSE_CHECKLIST.md`](./MONTHLY_CLOSE_CHECKLIST.md)): trial balance balances,
   control totals match, no orphaned journal lines.

### B. Supabase project lost / region outage

1. Restore from backup into a **new** Supabase project if the original is unrecoverable.
2. Update Netlify env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` to the new project's values.
3. Re-point any external callbacks (QuickBooks redirect URI, Resend/inbound email, DNS)
   to the new project where applicable. Redeploy.

### C. Netlify / app-host failure

No data lives here. Recovery = redeploy from git (`main`) to Netlify or any static host +
serverless runtime, then restore the env vars from §3. The repo is itself a backup of the
entire application surface (code + migrations).

### D. QuickBooks connection broken (tokens unusable)

The QBO access/refresh tokens in `accounting.qbo_connection` are **self-healing**: an admin
**Disconnect → Reconnect** at `/app/accounting/integrations` re-mints them via OAuth. No
backup of the tokens is needed or wanted. This is also the recovery path if `TOKEN_ENC_KEY`
is rotated/lost (see §4) — the old ciphertext becomes unreadable, you reconnect, done. The
QBO replica is read-only and re-syncable, so it is never a source of truth to protect.

---

## 3. Secret inventory & rotation

Secrets are **not recoverable from the database** — keep the authoritative copy in a
password manager / secret store. All live in **Netlify → Site settings → Environment
variables** (server-side ones are never exposed to the browser; only `VITE_`-prefixed
vars reach the client bundle by design).

| Secret                                       | Used by                          | Exposure if leaked                                  | Rotate where                                            |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                  | all functions (admin DB access)  | **Full DB read/write, bypasses RLS** — highest risk | Supabase → Settings → API → roll service_role key       |
| `TOKEN_ENC_KEY`                              | qbo-oauth / qbo-sync (token enc) | nothing alone; needed _with_ a DB dump to decrypt   | Generate new, set in Netlify, then reconnect QBO (§4)   |
| `QBO_CLIENT_SECRET`                          | QBO OAuth                        | impersonate the app to Intuit                       | developer.intuit.com → app → Keys → rotate              |
| `QBO_CLIENT_ID` / `QBO_REDIRECT_URI` / `QBO_ENVIRONMENT` | QBO OAuth             | low (id/URL are not secret)                         | developer.intuit.com / Netlify env                      |
| `RESEND_API_KEY`                             | invoice/proposal email           | send mail as you                                    | Resend dashboard → API keys                             |
| `TURNSTILE_SECRET_KEY`                       | proposal form anti-bot           | bypass bot check                                    | Cloudflare Turnstile dashboard                          |
| `VITE_SUPABASE_ANON_KEY`                     | client (RLS-gated)               | low (public by design, RLS-protected)               | Supabase → Settings → API                               |

### Rotation procedure (the standard drill)

1. **Generate / obtain** the new value at the source (table's "Rotate where" column).
2. **Update Netlify** env var (Production context; also Deploy-preview/Branch if used).
3. **Redeploy** (env changes only take effect on a new deploy/function cold start).
4. **Verify** the dependent feature still works (e.g. admin "Test connection" for QBO;
   send a test invoice email for Resend).
5. **Revoke** the old value at the source once the new one is confirmed live.

> **Service-role key first.** It is the master key to the database. If you suspect _any_
> secret exposure (e.g. a key committed to git history), rotate `SUPABASE_SERVICE_ROLE_KEY`
> before anything else, then the rest.

### Auth hardening (one-time, dashboard)

- **Leaked-password protection:** Supabase → Authentication → Policies / Password security
  → enable "Check against HaveIBeenPwned." Rejects known-breached passwords at signup/reset.
- **MFA** for the Supabase dashboard owner account, and least-privilege on org members.

---

## 4. `TOKEN_ENC_KEY` custody (encryption at rest)

QBO OAuth tokens (and, in future, Plaid tokens / vendor TINs) are encrypted at rest with
**AES-256-GCM** via `netlify/functions/lib/tokenCrypto.mjs`. The key lives **only** in the
Netlify function environment as `TOKEN_ENC_KEY` — never in the database. This is envelope
key separation: a leaked DB dump _or_ a leaked service-role key is insufficient on its own;
an attacker needs the ciphertext **and** the Netlify-held key.

- **Format:** 32 bytes, supplied as 64 hex chars **or** base64. Generate with:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- **Backward-compatible:** if `TOKEN_ENC_KEY` is unset, tokens are stored/read as plaintext
  exactly as before — enabling the key never breaks the live connection, and existing rows
  re-encrypt automatically the next time a token rotates (no migration needed).
- **Custody:** store the key in the same password manager as the other secrets, tagged
  "do not lose — but recoverable." Losing it only makes existing token ciphertext
  unreadable; **recovery is a QBO Disconnect → Reconnect** (§2.D), not a restore.
- **Rotation:** set a new key, redeploy, then reconnect QBO so tokens are re-minted under
  the new key. (Old ciphertext under the previous key is abandoned, which is fine.)

---

## 5. DR drill (do this ~yearly)

1. Spin up a throwaway Supabase project; restore the latest production backup into it.
2. Point a Netlify **branch deploy** at it (per `netlify.toml` context env), reconnect a
   QBO **sandbox** realm, and confirm the app loads + the accounting reports render.
3. Run the reconcile pass from [`MONTHLY_CLOSE_CHECKLIST.md`](./MONTHLY_CLOSE_CHECKLIST.md)
   against the restored data — the books should tie out to the backup's point in time.
4. Tear the throwaway project down. Record the date + restore time (validates the RTO).
