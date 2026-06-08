# Archived one-off SQL scripts — DO NOT RUN

These files are **historical, non-timestamped, hand-run scripts** from early development. They were
used to reconcile the live database by hand and are kept here **for reference only**. They are **not**
Supabase migrations: `supabase db push` ignores files that don't match the `<timestamp>_name.sql`
pattern, and these live in a subfolder so they are excluded entirely.

**Do not paste any of these into the SQL editor against production.** Several are destructive:

| File | What it does | Risk |
|---|---|---|
| `WIPE_IMPORTED_DATA.sql` | Unconditional `DELETE FROM shifts/jobs/inventory` (no WHERE, no txn) | **Destroys all operational data** |
| `DELETE_ADMIN_IMPORT.sql` | Bulk-deletes admin-board jobs + children | **Data loss** |
| `CATCH_UP_LIVE_DB.sql` | Ad-hoc schema catch-up (incl. the `part_materials` sync trigger) | Double-apply / drift |
| `APPLY_ALL_MIGRATIONS.sql` | Consolidated re-apply of older changes | Double-apply |
| `ADD_JOBS_PART_ID.sql`, `ADD_JOBS_REVISION_AND_DASH.sql`, `add_labor_hours_column.sql` | One-off column adds, already in live | Double-apply |
| `FIX_ATTACHMENTS_CONSTRAINT.sql`, `FIX_STORAGE_RLS_FOR_PARTS.sql` | One-off fixes, already in live | Double-apply |
| `CREATE_STORAGE_BUCKETS.sql` | Storage bucket setup, already applied | Re-run usually harmless but unnecessary |

**The authoritative schema is the timestamped migrations in `supabase/migrations/` plus the live
database.** As of the audit (2026-06-08), the repo migration list was brought back in sync with the
live project (`bbqudyybacwbubkgktwf`) by capturing the `20260608*` accounting migrations that had been
applied to production but were missing from this branch.
