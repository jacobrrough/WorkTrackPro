-- WorkTrackAccounting — NOTIFICATION DELIVERY (HELD / UNVERIFIED — NOT FOR FILING)
--                        config + the single sanctioned cross-schema delivery seam
--
-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  UNVERIFIED — NOT FOR FILING. This module is built FLAG-DARK and UNVERIFIED.   ║
-- ║  It requires CPA and/or security sign-off before it is enabled. Every screen,  ║
-- ║  report, export, AND delivered notification this module produces must carry    ║
-- ║  the UnverifiedBanner / "UNVERIFIED — NOT FOR FILING" disclaimer (enforced in   ║
-- ║  the UI + delivery lanes; the DB cannot render a banner).                      ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- WHAT THIS MODULE DOES
--   Wires accounting EVENTS into the EXISTING app notification feed
--   (public.system_notifications, surfaced by the existing bell/feed UI). Five events:
--     • invoice_sent            — an invoice was sent to a customer (event-driven, app-side).
--     • invoice_overdue         — a sent invoice is past due with a balance (time-based).
--     • bill_due_soon           — an open bill comes due within N days (time-based).
--     • low_bank_balance        — a bank account dips below a $ floor (time-based).
--     • tax_deadline_upcoming   — a C1 tax-filing deadline is within N days (time-based).
--   Event-driven dispatch is app-side (the browser, under the user's own RLS). The
--   time-based events are swept by an ENV-GATED (default OFF) Netlify scheduled function
--   (separate server lane: gate ACCOUNTING_NOTIFICATIONS_ENABLED). Both delivery paths
--   funnel through ONE audited seam: accounting.dispatch_notification(...) below.
--
-- ── CROSS-SCHEMA DELIVERY IS IN SCOPE FOR THIS MODULE (and ONLY for delivery) ──────
--   Every OTHER accounting migration keeps all data inside schema `accounting` and never
--   writes public.* (e.g. TAX-SYNC migration 022 explicitly states "no public.* /
--   system_notifications writes"). This module is the deliberate, authorized exception:
--   its WHOLE PURPOSE is to deliver accounting notifications through the EXISTING app
--   notification API. We honor the boundary precisely:
--     • All accounting DATA (rules, dedupe ledger) stays in schema `accounting`.
--     • The ONLY thing that touches public.* is the DELIVERY insert — and it is funneled
--       through a SINGLE SECURITY DEFINER function (accounting.dispatch_notification) so the
--       cross-schema write lives in ONE greppable, audited, owner-privileged place instead
--       of being scattered. This mirrors the EXISTING public.notify_job_status_change /
--       public.notify_low_stock / public.notify_mention definer functions, which are the
--       app's established pattern for "a definer function inserts into system_notifications
--       after a should_notify() gate". The only difference: ours lives in `accounting` and
--       is reused by both the app-side path and the env-gated scheduled function.
--
-- WHY THIS SHAPE (purely additive, schema `accounting` only — G1; ZERO public.* DDL)
--   public.system_notifications.type is free-text (`text not null`) — confirmed against
--   migration 20260508000001 — so the five new event-type strings need NO change to that
--   table or to any public.* object. We add, in schema `accounting` only:
--     1) accounting.notification_rules           — the additive config the spec names
--        (event_type, threshold, enabled, optional bank-account scope). Ships DISABLED.
--     2) accounting.notification_dispatch_log     — append-only dedupe ledger so the daily
--        sweep does not re-notify the same subject every run (NOT money — a bookkeeping
--        ledger of what was already delivered). Mirrors audit_log: no authenticated write
--        policy; written only by the definer RPC.
--     3) accounting.dispatch_notification(...)    — the one sanctioned delivery RPC.
--   Both tables use accounting._apply_standard_table (RLS read=can_read / write=can_write,
--   audit + touch triggers) exactly like every other accounting table. Every FK is on the
--   accounting (child) side; the only cross-schema FKs are *_by -> public.profiles(id) ON
--   DELETE SET NULL (same additive pattern as dimensions.created_by in migration 013 —
--   public.profiles is NOT altered).
--
-- NO MONEY MOVED, NO JOURNAL ENTRY (G3 is VACUOUS):
--   This module posts ZERO journal entries and moves ZERO money. It only READS accounting
--   data (overdue invoices, bills due soon, bank balances, the C1 tax calendar) and WRITES
--   notification rows. There is no post_journal_entry call anywhere here. The "unbalanced-JE
--   rejected" proof is therefore N/A; the substitute adversarial proofs are:
--     (1) a DISABLED rule delivers nothing (the RPC gates on notification_rules.enabled);
--     (2) the RPC honors public.should_notify (suppresses an opted-out recipient);
--     (3) the dedupe ledger prevents a duplicate delivery for the same (event, dedupe_key);
--     (4) a non-role user is denied by RLS on both new tables;
--     (5) the env-gated scheduled function is inert when ACCOUNTING_NOTIFICATIONS_ENABLED
--         is OFF (server lane — not exercised by this migration, but the DB-side enabled
--         gate is defense-in-depth for it).
--
-- MONEY MATH (G6): the low_bank_balance threshold is a DOLLAR amount stored numeric(14,2);
--   the JS dispatcher compares it in integer cents (accountingViewModel.toCents). The day-
--   based thresholds (overdue / due-soon / tax-deadline) are plain integers.
--
-- LEGAL / UNVERIFIED (G9 + held-module override): the tax_deadline_upcoming event derives
--   from the C1 tax_filing_calendar settings seed (migration 020) — REPRESENTATIVE CDTFA
--   cadence only, NOT verified for filing. A CPA/EA must verify the actual filing frequency
--   and due dates before any deadline reminder is trusted. Every surface and every delivered
--   notification must show the UNVERIFIED banner/prefix (enforced in the UI + delivery lanes).
--
-- This migration is IDEMPOTENT (create table if not exists; guarded index creation; insert
--   ... on conflict do nothing for the seed; create or replace function; _apply_standard_table
--   is drop/create of policies+triggers).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.dispatch_notification(text, uuid, text, text, text, jsonb, text, uuid);
--   DROP TABLE IF EXISTS accounting.notification_dispatch_log CASCADE;
--   DROP TABLE IF EXISTS accounting.notification_rules CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) notification_rules — additive config (event_type, threshold, enabled, scope)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per event (per bank account for the low_bank_balance case). Ships DISABLED
-- (enabled default false) to honor the flag-dark posture: even the rules are inert until
-- an admin turns them on AND the server/app paths are graduated.
create table if not exists accounting.notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'invoice_sent',
    'invoice_overdue',
    'bill_due_soon',
    'low_bank_balance',
    'tax_deadline_upcoming'
  )),
  -- enabled is the per-event kill switch. DEFAULT OFF (flag-dark). The dispatch RPC also
  -- re-checks this in-DB (defense in depth) so a stale app/cron cannot deliver for a
  -- disabled event.
  enabled boolean not null default false,
  -- threshold meaning is per-event and nullable:
  --   • bill_due_soon / tax_deadline_upcoming : days-ahead (notify when due within N days).
  --   • invoice_overdue                       : days-overdue (notify once past due by >= N).
  --   • low_bank_balance                       : MINIMUM BALANCE IN DOLLARS (numeric(14,2));
  --                                              compared in integer cents by the JS layer.
  --   • invoice_sent                           : unused (NULL).
  threshold numeric(14,2),
  -- low_bank_balance may be scoped to a single account; NULL => all active bank accounts.
  -- FK is on this (accounting) child side; ON DELETE CASCADE drops a rule if its account is.
  bank_account_id uuid references accounting.bank_accounts(id) on delete cascade,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one rule per event (per account for the bank case). Two NULL bank_account_ids are
  -- distinct under a UNIQUE constraint, so a partial unique index guarantees a single
  -- "all-accounts" rule per event_type as well (see below).
  unique (event_type, bank_account_id)
);

-- Guarantee at most ONE rule per event_type when bank_account_id IS NULL (the unique
-- constraint above treats NULLs as distinct, which would otherwise permit duplicates).
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_notif_rules_event_nullacct') then
    create unique index uq_acct_notif_rules_event_nullacct
      on accounting.notification_rules(event_type)
      where bank_account_id is null;
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_notif_rules_enabled') then
    create index idx_acct_notif_rules_enabled
      on accounting.notification_rules(event_type) where enabled;
  end if;
  -- Covering index for the bank_account_id FK (the ON DELETE CASCADE target + the
  -- per-account scope key for low_bank_balance rules). Keeps cascade deletes and
  -- account-scoped lookups index-backed (silences unindexed_foreign_keys for this FK).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_notif_rules_bank_account') then
    create index idx_acct_notif_rules_bank_account
      on accounting.notification_rules(bank_account_id) where bank_account_id is not null;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) notification_dispatch_log — append-only dedupe ledger (NOT money)
-- ─────────────────────────────────────────────────────────────────────────────
-- Prevents re-notifying the same subject (invoice/bill/account/deadline) on every sweep.
-- The dispatch RPC upserts a row keyed by (event_type, dedupe_key) and only delivers when
-- the row is NEW (first time this exact subject/state was seen). "State-advanced" re-
-- notification (e.g. an invoice crossing a new overdue bucket) is expressed by the caller
-- choosing a NEW dedupe_key for the new state. Written ONLY by the definer RPC (no
-- authenticated write policy — mirrors audit_log).
create table if not exists accounting.notification_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  -- stable, caller-computed key (e.g. 'invoice_overdue:<invoice_id>:bucket30'). Identical on
  -- the app-side and server-side paths so they share one dedupe ledger.
  dedupe_key text not null,
  -- the invoice/bill/bank_account id this delivery concerns (NULL for tax deadlines). Plain
  -- uuid (NO FK) on purpose: a dedupe row must never fail to write because a subject row was
  -- later deleted, and it is bookkeeping that should outlive the subject.
  subject_id uuid,
  -- how many times delivery fired for this key (1 on first insert; bumped on later matches
  -- only if the caller deliberately re-delivers — by default it does not).
  notification_count int not null default 0,
  last_dispatched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (event_type, dedupe_key)
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_notif_dispatch_subject') then
    create index idx_acct_notif_dispatch_subject
      on accounting.notification_dispatch_log(event_type, subject_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Seed one DISABLED rule per event_type (sane default thresholds)
-- ─────────────────────────────────────────────────────────────────────────────
-- So an admin sees all five toggles on a fresh DB. enabled=false (flag-dark). Idempotent:
-- on conflict (the partial unique index for NULL bank_account_id) do nothing — never clobbers
-- an admin's later edits. Default thresholds are starting points a human MUST review:
--   bill_due_soon = 7 days, invoice_overdue = 1 day, tax_deadline_upcoming = 14 days,
--   low_bank_balance = NULL (admin must set a $ floor), invoice_sent = NULL (no threshold).
insert into accounting.notification_rules (event_type, enabled, threshold, notes) values
  ('invoice_sent',          false, null, 'Notify when an invoice is sent. Event-driven (app-side). UNVERIFIED — requires sign-off.'),
  ('invoice_overdue',       false, 1,    'Notify when a sent invoice is past due by >= N days with a balance. UNVERIFIED — requires sign-off.'),
  ('bill_due_soon',         false, 7,    'Notify when an open bill comes due within N days. UNVERIFIED — requires sign-off.'),
  ('low_bank_balance',      false, null, 'Notify when a bank balance drops below the $ threshold (dollars; compared in cents). Set a floor before enabling. UNVERIFIED — requires sign-off.'),
  ('tax_deadline_upcoming', false, 14,   'Notify when a C1 tax-filing deadline is within N days. Representative CDTFA cadence — NOT verified for filing. UNVERIFIED — requires sign-off.')
on conflict (event_type) where bank_account_id is null do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Standard RLS + audit + touch wiring (read=can_read, write=can_write)
-- ─────────────────────────────────────────────────────────────────────────────
-- notification_rules carries updated_at (touch trigger). The dispatch log is append-only
-- history (no updated_at -> pass false) AND must have NO authenticated write policy — so we
-- DROP the write policy _apply_standard_table creates, leaving only the can_read() read
-- policy (the definer RPC, running as owner, is the sole writer; mirrors audit_log).
select accounting._apply_standard_table('notification_rules');
select accounting._apply_standard_table('notification_dispatch_log', false);

-- Remove the authenticated write policy on the dedupe ledger (definer-RPC-only writes).
drop policy if exists "notification_dispatch_log write" on accounting.notification_dispatch_log;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) accounting.dispatch_notification(...) — the ONE sanctioned cross-schema seam
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER (owner-privileged) so it can:
--   (a) read accounting.notification_rules to confirm the event is ENABLED (defense in
--       depth — the app/cron also gate, but the DB is the backstop),
--   (b) write the accounting.notification_dispatch_log dedupe row, and
--   (c) INSERT the single delivery row into public.system_notifications — the authorized
--       cross-schema action — after honoring public.should_notify(p_user_id, <type>,'in_app').
-- This is the EXACT pattern of the existing public.notify_* definer functions, centralized
-- in ONE place and reused by both delivery paths.
--
-- SAFETY / NON-ABUSE (security review point #1 + #2 in the report):
--   • The function ONLY ever inserts a notification for the p_user_id it is given. Callers
--     resolve the audience (accounting-role holders + approved admins) BEFORE calling and
--     invoke once per recipient. The function does not broadcast.
--   • It maps the accounting event_type -> a fixed in-app preference key (acct_*) and gates
--     on should_notify for THAT key, so an opted-out user is never delivered to.
--   • It is idempotent per (event_type, dedupe_key): a second identical call inserts NO
--     second notification (returns null), so retries / overlapping sweeps cannot spam.
--   • search_path is pinned; SQL is fully schema-qualified.
--   • enabled-gate: if the rule for the event is absent or disabled, it delivers nothing.
--
-- Returns the new public.system_notifications.id on delivery, or NULL when suppressed
-- (disabled rule / opted-out user / duplicate dedupe key).
create or replace function accounting.dispatch_notification(
  p_event_type text,
  p_user_id    uuid,
  p_title      text,
  p_message    text,
  p_link       text default null,
  p_metadata   jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_subject_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_enabled    boolean;
  v_pref_type  text;
  -- v_inserted holds GET DIAGNOSTICS ROW_COUNT, which is an INTEGER (0 on conflict,
  -- 1 on a fresh insert). It must NOT be boolean (boolean = integer has no operator).
  v_inserted   int := 0;
  v_notif_id   uuid;
  v_dedupe     text;
begin
  -- 0) Basic argument hygiene — never deliver to a null recipient / unknown event.
  if p_user_id is null then
    return null;
  end if;
  if p_event_type not in ('invoice_sent','invoice_overdue','bill_due_soon','low_bank_balance','tax_deadline_upcoming') then
    raise exception 'unknown accounting notification event_type: %', p_event_type
      using errcode = 'check_violation';
  end if;

  -- 1) Enabled-gate (defense in depth). Any enabled rule for this event_type is sufficient
  -- (covers the per-account low_bank_balance rules as well). Absent/disabled => deliver nothing.
  select exists (
    select 1 from accounting.notification_rules nr
     where nr.event_type = p_event_type and nr.enabled = true
  ) into v_enabled;
  if not v_enabled then
    return null;
  end if;

  -- 2) Map the accounting event -> the fixed in-app preference key, then honor the EXISTING
  -- per-user preference. should_notify defaults to TRUE when the user has no row/key.
  v_pref_type := case p_event_type
    when 'invoice_sent'          then 'acct_invoice_sent'
    when 'invoice_overdue'       then 'acct_invoice_overdue'
    when 'bill_due_soon'         then 'acct_bill_due_soon'
    when 'low_bank_balance'      then 'acct_low_bank_balance'
    when 'tax_deadline_upcoming' then 'acct_tax_deadline'
  end;
  if not public.should_notify(p_user_id, v_pref_type, 'in_app') then
    return null;
  end if;

  -- 3) Dedupe. Default the key to event:subject:user when the caller omitted one, so even a
  -- careless caller cannot double-deliver the same subject to the same user. Insert the
  -- ledger row; only proceed to deliver if it was NEWLY inserted for this (event, key).
  v_dedupe := coalesce(
    nullif(trim(p_dedupe_key), ''),
    p_event_type || ':' || coalesce(p_subject_id::text, 'na') || ':' || p_user_id::text
  );

  insert into accounting.notification_dispatch_log
    (event_type, dedupe_key, subject_id, notification_count, last_dispatched_at)
  values
    (p_event_type, v_dedupe, p_subject_id, 1, now())
  on conflict (event_type, dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;  -- 1 => newly inserted; 0 => already delivered

  if v_inserted = 0 then
    return null;  -- already delivered for this (event, dedupe_key): no duplicate.
  end if;

  -- 4) DELIVER: the single authorized cross-schema insert into the EXISTING feed. The
  -- event_type string is stored verbatim in public.system_notifications.type (free-text).
  insert into public.system_notifications (user_id, type, title, message, link, metadata)
  values (
    p_user_id,
    p_event_type,
    p_title,
    p_message,
    p_link,
    coalesce(p_metadata, '{}'::jsonb)
      -- the UNVERIFIED marker travels WITH the delivered notification so the existing bell/
      -- feed UI (which this module does not modify) can surface the disclaimer.
      || jsonb_build_object('unverified', true, 'module', 'accounting', 'event_type', p_event_type)
  )
  returning id into v_notif_id;

  return v_notif_id;
end;
$$;

-- Execute is granted to authenticated (Path A, app-side, under the caller's session) and
-- service_role (Path B, the env-gated scheduled function). The definer body — not the
-- caller's role — performs the privileged cross-schema insert, so authenticated callers
-- cannot insert into public.system_notifications except through this audited seam.
grant execute on function accounting.dispatch_notification(text, uuid, text, text, text, jsonb, text, uuid)
  to authenticated, service_role;

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already cover
-- new objects; restated for unambiguous current-object grants, matching the convention in
-- migrations 007/013/016/022).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
