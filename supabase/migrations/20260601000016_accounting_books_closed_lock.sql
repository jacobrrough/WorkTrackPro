-- WorkTrackAccounting — D1: Books-closed (period lock) date
--
-- Lets an accounting_admin "close the books" through a date. Once set, NO journal
-- entry dated ON OR BEFORE that date may be POSTED or VOIDED — the period is frozen.
-- This is the standard accounting period-lock control.
--
-- WHY THIS SHAPE (purely additive, schema `accounting` only — G1)
--   • No new table. The lock date is a single KV row in the EXISTING accounting.settings
--     table: setting_key = 'closed_through_date', setting_value = a JSON date string
--     "YYYY-MM-DD" or JSON null (no lock / books open). Seeded idempotently with 'null'
--     so the feature ships OFF. Reuses settings' existing RLS (read=can_read, write=
--     can_write) and — via this migration — its audit + touch triggers, so every change
--     to the lock date is captured in accounting.audit_log with actor + before/after.
--   • accounting.closed_through_date() — SECURITY DEFINER helper reading that row, with
--     search_path pinned (mirrors the has_role/can_read helper pattern). Centralizes the
--     read so the three guards stay clean and the key string is not hardcoded in 4 places.
--   • accounting.set_closed_through_date(p_date date) — admin-only RPC. settings' table
--     write policy is can_write() = admin OR accountant; D1 requires accounting_admin-ONLY,
--     so the lock date must NOT be settable by a plain accountant UPDATE. The RPC is the
--     enforcement point (raises insufficient_privilege otherwise). We deliberately DO NOT
--     tighten the settings table policy — that would regress accountant writes to other
--     settings keys. The screen calls this RPC, never a raw settings update.
--
-- GUARD CHANGE (CREATE OR REPLACE in `accounting` only — G3 preserved, nothing removed)
--   The three functions below are replaced to ADD a date gate and NOTHING else — every
--   existing line (permission checks, >=2 lines + balance enforcement, immutability,
--   security definer, search_path) is kept verbatim:
--     • accounting.guard_journal_entry() — the single chokepoint every path to posted/void
--       passes through (RPC or direct). On draft->posted reject if NEW.entry_date is on/before
--       the closed date; on posted->void reject if OLD.entry_date is on/before the closed date.
--       Draft edits are left alone — only posting/voiding is blocked (the task: "posting or voiding").
--     • accounting.post_journal_entry(uuid) — adds an explicit early date check for a clean
--       error message before the UPDATE (defense-in-depth; the trigger still catches any other path).
--     • accounting.void_journal_entry(uuid, text) — adds the same early date check.
--   NULL closed date ⇒ no restriction (feature off). The deferred assert_entry_balanced()
--   net is unchanged (balance only; the date gate lives in the entry guard + RPCs).
--
-- NO MONEY MOVED: this is a period-control feature; it posts no journal entry (G3 vacuous).
--
-- This migration is IDEMPOTENT (insert ... on conflict do nothing; CREATE OR REPLACE
-- FUNCTION; guarded trigger (re)creation).
--
-- ROLLBACK:
--   -- The settings row is harmless and left in place (value 'null' = no lock). To fully
--   -- revert behavior, restore the three pre-D1 function bodies and drop the two new helpers:
--   DROP FUNCTION IF EXISTS accounting.set_closed_through_date(date);
--   DROP FUNCTION IF EXISTS accounting.closed_through_date();
--   -- guard_journal_entry(): pre-D1 body (no date gate)
--   CREATE OR REPLACE FUNCTION accounting.guard_journal_entry()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounting, pg_catalog AS $rb$
--   declare vd numeric(14,2); vc numeric(14,2); vn int;
--   begin
--     if tg_op = 'INSERT' then
--       if new.status = 'posted' then raise exception 'create journal entries as draft, then post them' using errcode = 'check_violation'; end if;
--       return new;
--     elsif tg_op = 'DELETE' then
--       if old.status = 'posted' then raise exception 'posted journal entry % cannot be deleted; void it instead', old.id using errcode = 'check_violation'; end if;
--       return old;
--     end if;
--     if old.status = 'draft' and new.status = 'posted' then
--       select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into vd, vc, vn from accounting.journal_lines where journal_entry_id = new.id;
--       if vn < 2 then raise exception 'journal entry % must have at least 2 lines to post (has %)', new.id, vn using errcode = 'check_violation'; end if;
--       if vd <> vc then raise exception 'journal entry % is unbalanced: debits % <> credits %', new.id, vd, vc using errcode = 'check_violation'; end if;
--       return new;
--     end if;
--     if old.status = 'posted' then
--       if new.status = 'void' and new.entry_number is not distinct from old.entry_number and new.entry_date is not distinct from old.entry_date and new.source_type is not distinct from old.source_type and new.source_id is not distinct from old.source_id then return new; end if;
--       raise exception 'posted journal entry % is immutable (void it or post a reversing entry)', old.id using errcode = 'check_violation';
--     end if;
--     if old.status = 'void' then raise exception 'void journal entry % is immutable', old.id using errcode = 'check_violation'; end if;
--     return new;
--   end; $rb$;
--   -- post_journal_entry(): pre-D1 body (no date gate)
--   CREATE OR REPLACE FUNCTION accounting.post_journal_entry(p_entry_id uuid)
--   RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounting, public, pg_catalog AS $rb$
--   declare v_status text;
--   begin
--     if not accounting.can_write() then raise exception 'insufficient privileges to post journal entries' using errcode = 'insufficient_privilege'; end if;
--     select status into v_status from accounting.journal_entries where id = p_entry_id for update;
--     if not found then raise exception 'journal entry % not found', p_entry_id; end if;
--     if v_status <> 'draft' then raise exception 'only draft journal entries can be posted (entry % is %)', p_entry_id, v_status using errcode = 'check_violation'; end if;
--     update accounting.journal_entries set status = 'posted', posted_at = now(), posted_by = auth.uid() where id = p_entry_id;
--     return p_entry_id;
--   end; $rb$;
--   -- void_journal_entry(): pre-D1 body (no date gate)
--   CREATE OR REPLACE FUNCTION accounting.void_journal_entry(p_entry_id uuid, p_reason text)
--   RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = accounting, public, pg_catalog AS $rb$
--   declare v_status text;
--   begin
--     if not accounting.can_write() then raise exception 'insufficient privileges to void journal entries' using errcode = 'insufficient_privilege'; end if;
--     select status into v_status from accounting.journal_entries where id = p_entry_id for update;
--     if not found then raise exception 'journal entry % not found', p_entry_id; end if;
--     if v_status <> 'posted' then raise exception 'only posted journal entries can be voided (entry % is %)', p_entry_id, v_status using errcode = 'check_violation'; end if;
--     update accounting.journal_entries set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_entry_id;
--     return p_entry_id;
--   end; $rb$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Lock-date setting (KV row in the existing accounting.settings table)
-- ─────────────────────────────────────────────────────────────────────────────
-- 'null'::jsonb means "books are open" (no lock). Idempotent seed.
insert into accounting.settings (setting_key, setting_value) values
  ('closed_through_date', 'null'::jsonb)
on conflict (setting_key) do nothing;

-- Ensure the settings table carries the standard audit + touch triggers so every
-- lock-date change lands in accounting.audit_log (actor + before/after). The
-- settings table was created in migration 1 (before _apply_standard_table existed)
-- and only had RLS attached, so we wire its triggers here, idempotently. (We do NOT
-- call _apply_standard_table — that would also (re)create the read/write policies,
-- which migration 1 already owns; we attach only the two missing triggers.)
drop trigger if exists touch_settings on accounting.settings;
create trigger touch_settings before update on accounting.settings
  for each row execute function accounting.touch_updated_at();

drop trigger if exists audit_settings on accounting.settings;
create trigger audit_settings after insert or update or delete on accounting.settings
  for each row execute function accounting.audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Helper: read the current closed-through date (NULL = books open)
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + pinned search_path so the guards can call it regardless of the
-- caller's role (the guards themselves run as definer). Returns NULL when unset or
-- when the JSON value is null. Centralizing the read avoids hardcoding the key string.
create or replace function accounting.closed_through_date()
returns date
language sql
stable
security definer
set search_path = accounting, pg_catalog
as $$
  select nullif(s.setting_value #>> '{}', '')::date
    from accounting.settings s
   where s.setting_key = 'closed_through_date';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Admin-only RPC: set / clear the closed-through date
-- ─────────────────────────────────────────────────────────────────────────────
-- D1 requires accounting_admin-ONLY (not accountant). This RPC is the enforcement
-- point. p_date NULL re-opens the books (clears the lock). Writes through the table
-- (RLS-checked as the SECURITY DEFINER owner) so the audit trigger records actor +
-- before/after. updated_by = auth.uid() for the human-readable actor on the row.
create or replace function accounting.set_closed_through_date(p_date date)
returns date
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
begin
  if not accounting.has_role('accounting_admin') then
    raise exception 'only accounting_admin may change the books-closed date'
      using errcode = 'insufficient_privilege';
  end if;

  -- NULL p_date re-opens the books. accounting.settings.setting_value is NOT NULL, and
  -- to_jsonb(NULL::date) is SQL NULL (not the JSON 'null' literal), so coalesce to the
  -- JSON null literal — exactly the value the seed uses for "books open". The helper
  -- closed_through_date() maps JSON null back to SQL NULL (nullif(... #>> '{}', '')).
  insert into accounting.settings (setting_key, setting_value, updated_by)
  values ('closed_through_date', coalesce(to_jsonb(p_date), 'null'::jsonb), auth.uid())
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value,
        updated_by    = excluded.updated_by;

  return p_date;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Guard: entry trigger — reject post/void of entries in the closed period
--    (pre-D1 body preserved verbatim; ONLY the two date gates are added)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.guard_journal_entry()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  vd numeric(14,2);
  vc numeric(14,2);
  vn int;
  v_closed date;
begin
  if tg_op = 'INSERT' then
    if new.status = 'posted' then
      raise exception 'create journal entries as draft, then post them' using errcode = 'check_violation';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'posted journal entry % cannot be deleted; void it instead', old.id using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  v_closed := accounting.closed_through_date();

  if old.status = 'draft' and new.status = 'posted' then
    -- D1 period lock: cannot post INTO a closed period.
    if v_closed is not null and new.entry_date <= v_closed then
      raise exception 'cannot post journal entry %: its date % is in the closed period (books closed through %)',
        new.id, new.entry_date, v_closed using errcode = 'check_violation';
    end if;
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
      into vd, vc, vn
      from accounting.journal_lines
     where journal_entry_id = new.id;
    if vn < 2 then
      raise exception 'journal entry % must have at least 2 lines to post (has %)', new.id, vn using errcode = 'check_violation';
    end if;
    if vd <> vc then
      raise exception 'journal entry % is unbalanced: debits % <> credits %', new.id, vd, vc using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'posted' then
    if new.status = 'void'
       and new.entry_number is not distinct from old.entry_number
       and new.entry_date  is not distinct from old.entry_date
       and new.source_type is not distinct from old.source_type
       and new.source_id   is not distinct from old.source_id then
      -- D1 period lock: cannot void an entry that sits in a closed period.
      if v_closed is not null and old.entry_date <= v_closed then
        raise exception 'cannot void journal entry %: its date % is in the closed period (books closed through %)',
          old.id, old.entry_date, v_closed using errcode = 'check_violation';
      end if;
      return new;
    end if;
    raise exception 'posted journal entry % is immutable (void it or post a reversing entry)', old.id using errcode = 'check_violation';
  end if;

  if old.status = 'void' then
    raise exception 'void journal entry % is immutable', old.id using errcode = 'check_violation';
  end if;

  return new; -- draft -> draft edits allowed
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Guard: post RPC — explicit early date check (clean message)
--    (pre-D1 body preserved verbatim; ONLY the date gate is added)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.post_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
  v_date   date;
  v_closed date;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to post journal entries' using errcode = 'insufficient_privilege';
  end if;
  select status, entry_date into v_status, v_date from accounting.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'journal entry % not found', p_entry_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft journal entries can be posted (entry % is %)', p_entry_id, v_status using errcode = 'check_violation';
  end if;
  -- D1 period lock (defense-in-depth; guard_journal_entry also enforces this).
  v_closed := accounting.closed_through_date();
  if v_closed is not null and v_date <= v_closed then
    raise exception 'cannot post into a closed period: entry date % is on or before the books-closed date %', v_date, v_closed using errcode = 'check_violation';
  end if;
  -- balance + >=2 lines enforced by guard_journal_entry on this transition
  update accounting.journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_entry_id;
  return p_entry_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Guard: void RPC — explicit early date check (clean message)
--    (pre-D1 body preserved verbatim; ONLY the date gate is added)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.void_journal_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
  v_date   date;
  v_closed date;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to void journal entries' using errcode = 'insufficient_privilege';
  end if;
  select status, entry_date into v_status, v_date from accounting.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'journal entry % not found', p_entry_id;
  end if;
  if v_status <> 'posted' then
    raise exception 'only posted journal entries can be voided (entry % is %)', p_entry_id, v_status using errcode = 'check_violation';
  end if;
  -- D1 period lock (defense-in-depth; guard_journal_entry also enforces this).
  v_closed := accounting.closed_through_date();
  if v_closed is not null and v_date <= v_closed then
    raise exception 'cannot void an entry in a closed period: entry date % is on or before the books-closed date %', v_date, v_closed using errcode = 'check_violation';
  end if;
  update accounting.journal_entries
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p_entry_id;
  return p_entry_id;
end;
$$;

-- Re-affirm execute grants for the two new functions (default privileges in schema
-- accounting already cover this; explicit for unambiguity).
grant execute on all functions in schema accounting to authenticated, service_role;
