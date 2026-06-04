-- WorkTrackAccounting — Foundation 4/11: double-entry general ledger
--
-- journal_entries (header) + journal_lines (debit/credit lines). Integrity model:
--   • Entries are created as 'draft' (lines may be unbalanced while editing).
--   • Posting is a draft -> posted UPDATE; guard_journal_entry validates >=2 lines
--     AND debits = credits at that single enforcement point (any path to 'posted',
--     RPC or direct, is validated). Direct INSERT as 'posted' is rejected.
--   • Posted entries are immutable: only posted -> void is allowed; lines are frozen.
--     Corrections are made with a reversing entry (reversal_of_entry_id).
--   • A DEFERRABLE CONSTRAINT TRIGGER on journal_lines re-checks balance at COMMIT
--     for posted entries as a safety net.
-- post_journal_entry / void_journal_entry RPCs are the app-facing, permission-checked
-- entry points.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.post_journal_entry(uuid);
--   DROP FUNCTION IF EXISTS accounting.void_journal_entry(uuid, text);
--   DROP TABLE IF EXISTS accounting.journal_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.journal_entries CASCADE;
--   DROP SEQUENCE IF EXISTS accounting.journal_entry_number_seq;
--   DROP FUNCTION IF EXISTS accounting.guard_journal_entry() CASCADE;
--   DROP FUNCTION IF EXISTS accounting.guard_journal_line() CASCADE;
--   DROP FUNCTION IF EXISTS accounting.assert_entry_balanced() CASCADE;

create sequence if not exists accounting.journal_entry_number_seq;

create table if not exists accounting.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number bigint not null unique default nextval('accounting.journal_entry_number_seq'),
  entry_date date not null default current_date,
  memo text,
  source_type text not null default 'manual' check (source_type in (
    'manual', 'invoice', 'payment', 'bill', 'vendor_payment', 'bank_txn',
    'payroll', 'depreciation', 'adjustment', 'opening_balance'
  )),
  source_id uuid,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  posted_at timestamptz,
  posted_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  reversal_of_entry_id uuid references accounting.journal_entries(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references accounting.journal_entries(id) on delete cascade,
  account_id uuid not null references accounting.accounts(id) on delete restrict,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  -- Reporting dimensions. job_id is a real cross-schema FK (additive — created on
  -- this child table, public.jobs is untouched). customer_id / vendor_id are plain
  -- denormalized dimensions; the authoritative party link lives on the source
  -- document (invoice/bill).
  job_id uuid references public.jobs(id) on delete set null,
  customer_id uuid,
  vendor_id uuid,
  line_memo text,
  sort_order int not null default 0,
  constraint journal_lines_not_both_positive check (not (debit > 0 and credit > 0)),
  constraint journal_lines_one_positive check (debit > 0 or credit > 0)
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_je_date') then
    create index idx_acct_je_date on accounting.journal_entries(entry_date desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_je_source') then
    create index idx_acct_je_source on accounting.journal_entries(source_type, source_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_je_status') then
    create index idx_acct_je_status on accounting.journal_entries(status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_jl_entry') then
    create index idx_acct_jl_entry on accounting.journal_lines(journal_entry_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_jl_account') then
    create index idx_acct_jl_account on accounting.journal_lines(account_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_jl_job') then
    create index idx_acct_jl_job on accounting.journal_lines(job_id);
  end if;
end $$;

-- ── Integrity triggers ───────────────────────────────────────────────────────

-- Entry guard: rejects posted-on-insert, enforces balance at draft->posted, and
-- freezes posted/void entries (only posted->void allowed).
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
  if old.status = 'draft' and new.status = 'posted' then
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

-- Line guard: lines may change only while the parent entry is draft.
create or replace function accounting.guard_journal_line()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_status text;
begin
  select status into v_status
    from accounting.journal_entries
   where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_status is null then
    -- parent absent (e.g. cascade delete of a draft entry) — allow
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_status <> 'draft' then
    raise exception 'cannot modify lines of % journal entry %', v_status,
      coalesce(new.journal_entry_id, old.journal_entry_id) using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Deferred balance safety net: validates at COMMIT for posted entries.
create or replace function accounting.assert_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  vd numeric(14,2);
  vc numeric(14,2);
  vn int;
  v_status text;
  v_entry uuid := coalesce(new.journal_entry_id, old.journal_entry_id);
begin
  select status into v_status from accounting.journal_entries where id = v_entry;
  if not found or v_status <> 'posted' then
    return null;
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into vd, vc, vn
    from accounting.journal_lines
   where journal_entry_id = v_entry;
  if vn < 2 or vd <> vc then
    raise exception 'journal entry % must be balanced with >=2 lines (lines=%, debit=%, credit=%)',
      v_entry, vn, vd, vc using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists guard_journal_entry on accounting.journal_entries;
create trigger guard_journal_entry before insert or update or delete on accounting.journal_entries
  for each row execute function accounting.guard_journal_entry();

drop trigger if exists touch_journal_entries on accounting.journal_entries;
create trigger touch_journal_entries before update on accounting.journal_entries
  for each row execute function accounting.touch_updated_at();

drop trigger if exists audit_journal_entries on accounting.journal_entries;
create trigger audit_journal_entries after insert or update or delete on accounting.journal_entries
  for each row execute function accounting.audit();

drop trigger if exists guard_journal_line on accounting.journal_lines;
create trigger guard_journal_line before insert or update or delete on accounting.journal_lines
  for each row execute function accounting.guard_journal_line();

drop trigger if exists audit_journal_lines on accounting.journal_lines;
create trigger audit_journal_lines after insert or update or delete on accounting.journal_lines
  for each row execute function accounting.audit();

drop trigger if exists assert_journal_lines_balanced on accounting.journal_lines;
create constraint trigger assert_journal_lines_balanced
  after insert or update or delete on accounting.journal_lines
  deferrable initially deferred
  for each row execute function accounting.assert_entry_balanced();

-- ── App-facing RPCs ──────────────────────────────────────────────────────────

create or replace function accounting.post_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to post journal entries' using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from accounting.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'journal entry % not found', p_entry_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft journal entries can be posted (entry % is %)', p_entry_id, v_status using errcode = 'check_violation';
  end if;
  -- balance + >=2 lines enforced by guard_journal_entry on this transition
  update accounting.journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = p_entry_id;
  return p_entry_id;
end;
$$;

create or replace function accounting.void_journal_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to void journal entries' using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from accounting.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'journal entry % not found', p_entry_id;
  end if;
  if v_status <> 'posted' then
    raise exception 'only posted journal entries can be voided (entry % is %)', p_entry_id, v_status using errcode = 'check_violation';
  end if;
  update accounting.journal_entries
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p_entry_id;
  return p_entry_id;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table accounting.journal_entries enable row level security;
alter table accounting.journal_lines   enable row level security;

drop policy if exists "acct je read" on accounting.journal_entries;
create policy "acct je read" on accounting.journal_entries
  for select to authenticated using (accounting.can_read());
drop policy if exists "acct je write" on accounting.journal_entries;
create policy "acct je write" on accounting.journal_entries
  for all to authenticated using (accounting.can_write()) with check (accounting.can_write());

drop policy if exists "acct jl read" on accounting.journal_lines;
create policy "acct jl read" on accounting.journal_lines
  for select to authenticated using (accounting.can_read());
drop policy if exists "acct jl write" on accounting.journal_lines;
create policy "acct jl write" on accounting.journal_lines
  for all to authenticated using (accounting.can_write()) with check (accounting.can_write());

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
