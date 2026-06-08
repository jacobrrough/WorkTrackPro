-- WorkTrackAccounting — #6 email invoices + reminders / dunning
--
-- Adds ONE additive log table that records every invoice email we send (a manual
-- "Email invoice" from the detail view, or an automated dunning reminder from the
-- scheduled function):
--   • accounting.invoice_emails — one row per email attempt, carrying the recipient,
--                                 the Resend provider id + last delivery event, and
--                                 (for a reminder) which due-date offset rung it covers.
--
-- These rows are pure DELIVERY METADATA. Sending an email moves NO money, so per
-- invariant G3 it posts NO journal entry — the same rationale the attachments (021),
-- dimensions (013), custom-fields (019) and budgets (017) migrations document. There is
-- no debit/credit, no post_journal_entry call and no posting math anywhere here.
--
-- ADDITIVE-ONLY (G1): every object lives in schema `accounting`. This adds NO columns to
-- any existing table. The only cross-schema FK is on the accounting (child) side ->
-- public.profiles(id) for created_by (matches every accounting table's created_by
-- precedent). NO public.* table or column is altered or dropped. invoice_id is a real FK
-- to accounting.invoices(id) ON DELETE CASCADE (an email log only exists for a live
-- invoice). portal_token_id is a PLAIN uuid with NO FK on purpose: accounting.portal_tokens
-- is created in the SIBLING migration 20260608170100 (which sorts AFTER this one), so a hard
-- FK here would create an apply-order dependency; the function layer sets it to the token it
-- minted. The link is informational (which portal link did this email carry).
--
-- REMINDER IDEMPOTENCY: a PARTIAL UNIQUE index on (invoice_id, reminder_offset_days) WHERE
-- kind = 'reminder' guarantees each configured dunning rung is sent AT MOST ONCE per invoice.
-- The scheduled function relies on this: it skips any (invoice, offset) it already logged, and
-- the unique index is the hard backstop against a double-send if two runs overlap. Manual sends
-- (kind = 'manual_send', reminder_offset_days NULL) are intentionally NOT covered by the index,
-- so an admin can re-send an invoice as many times as needed.
--
-- DUNNING CONFIG (no new table): the dunning schedule is stored as ONE row in the existing
-- accounting.settings KV table under setting_key = 'dunning'. The JSON shape is:
--   {
--     "enabled": boolean,            -- UI toggle (the SERVER env ACCOUNTING_DUNNING_ENABLED
--                                    --   is the hard gate; this is the soft, per-tenant switch)
--     "offsetsDays": int[],          -- due-date offsets to remind on, e.g. [-3, 0, 7, 14]
--                                    --   (negative = before due, 0 = on due date, positive = after)
--     "fromEmail": string,           -- From address (must be a Resend-verified sender)
--     "subjectTemplate": string,     -- supports {{invoiceNumber}} {{customerName}} {{balanceDue}}
--     "bodyTemplate": string,        -- same tokens; plain text, rendered to HTML by the function
--     "maxPerRun": int               -- safety cap on emails sent in a single scheduled run
--   }
-- A seed row with enabled=false is inserted so the settings read never 404s; it stays inert
-- until BOTH the server env flag is on AND enabled=true.
--
-- This migration is IDEMPOTENT (CREATE TABLE IF NOT EXISTS, guarded index creation via a
-- pg_indexes check, idempotent _apply_standard_table, on-conflict-do-nothing seed).
--
-- ROLLBACK:
--   DELETE FROM accounting.settings WHERE setting_key = 'dunning';
--   DROP INDEX IF EXISTS accounting.idx_acct_invoice_emails_reminder_rung;
--   DROP INDEX IF EXISTS accounting.idx_acct_invoice_emails_invoice;
--   DROP TABLE IF EXISTS accounting.invoice_emails CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Invoice email log — one row per send attempt
-- ─────────────────────────────────────────────────────────────────────────────
-- kind partitions manual sends from automated dunning reminders. reminder_offset_days is
-- the due-date offset rung this reminder covers (NULL for a manual send). status tracks the
-- provider lifecycle; provider_message_id + provider_last_event mirror what Resend returns
-- (id + last_event), exactly like submit-proposal's last-event poll. error carries the
-- normalized failure text. created_by is the admin who triggered a manual send (NULL for the
-- scheduled cron, which has no auth.uid()).
create table if not exists accounting.invoice_emails (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references accounting.invoices(id) on delete cascade,
  kind text not null check (kind in ('manual_send', 'reminder')),
  reminder_offset_days int,
  to_email text not null,
  from_email text not null,
  subject text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'bounced')),
  provider_message_id text,
  provider_last_event text,
  error text,
  portal_token_id uuid,                  -- plain uuid, NO FK (portal_tokens is a sibling migration)
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Powers "all emails for this invoice" (the detail-view history list), newest first.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_invoice_emails_invoice'
  ) then
    create index idx_acct_invoice_emails_invoice
      on accounting.invoice_emails (invoice_id, created_at desc);
  end if;
end $$;

-- Reminder idempotency: at most ONE reminder per (invoice, offset rung). Manual sends are
-- excluded by the partial predicate so an admin can re-send freely.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_invoice_emails_reminder_rung'
  ) then
    create unique index idx_acct_invoice_emails_reminder_rung
      on accounting.invoice_emails (invoice_id, reminder_offset_days)
      where kind = 'reminder';
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper (read = can_read, write = can_write).
select accounting._apply_standard_table('invoice_emails');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Dunning config seed (KV row, not a new table) — inert by default
-- ─────────────────────────────────────────────────────────────────────────────
-- A disabled seed so the settings read always resolves. The schedule below is a sensible
-- default; an admin edits it on the Settings → Dunning panel. It stays inert until BOTH the
-- server env ACCOUNTING_DUNNING_ENABLED is on AND enabled=true here.
insert into accounting.settings (setting_key, setting_value)
values (
  'dunning',
  jsonb_build_object(
    'enabled', false,
    'offsetsDays', jsonb_build_array(-3, 0, 7, 14),
    'fromEmail', '',
    'subjectTemplate', 'Invoice {{invoiceNumber}} — balance due {{balanceDue}}',
    'bodyTemplate',
      'Hi {{customerName}},' || E'\n\n' ||
      'This is a friendly reminder that invoice {{invoiceNumber}} has a balance due of {{balanceDue}}. ' ||
      'You can view and download it from the secure link in this email.' || E'\n\n' ||
      'Thank you.',
    'maxPerRun', 200
  )
)
on conflict (setting_key) do nothing;

-- Belt-and-suspenders explicit grants (default privileges already cover new objects;
-- restated for unambiguous current-object grants, matching sibling migrations).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
