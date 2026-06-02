-- WorkTrackAccounting — D3: fixed assets & depreciation
--
-- Adds the asset register and its depreciation schedule, plus the "run depreciation
-- for a period" action that posts a BALANCED journal entry per due asset and marks
-- the schedule row posted. Straight-line is implemented now; declining_balance is an
-- accepted enum value, deferred (the schedule generator below only emits straight-line
-- rows; a declining-balance generator can be added later with zero schema change).
--
-- Two additive master tables:
--   • accounting.fixed_assets         — one capitalized asset (cost, salvage, life,
--                                        method, in-service date, status) plus the three
--                                        GL accounts its depreciation touches.
--   • accounting.depreciation_schedule — one planned/posted row per (asset, period),
--                                        carrying the period amount and, once posted, the
--                                        balanced journal entry that booked it.
--
-- WHY THIS SHAPE
--   Depreciation is the ONLY money movement here, and it is a single textbook entry:
--       Dr  Depreciation Expense            = period amount
--       Cr  1510 Accumulated Depreciation   = period amount      (contra-asset, credit)
--   Equal by construction (one `amount` on both sides). The schedule rows are generated
--   up front from the straight-line formula when the asset is created/edited; the period
--   runner later posts each DUE (posted=false, period_date <= p_period_date) row through
--   accounting.post_journal_entry — never bypassing the balance trigger (G3). Because it
--   routes through post_journal_entry, the D1 books-closed lock is honored automatically:
--   a schedule row whose period_date falls in a closed period is rejected by the GL guard,
--   surfaced to the caller (not silently skipped).
--
-- ADDITIVE-ONLY (G1)
--   Every object lives in schema `accounting`. The only cross-schema FK is on the
--   accounting (child) side -> public.profiles(id) for created_by, matching every other
--   accounting table. NO public.* table or column is altered or dropped. The GL
--   source_type enum already includes 'depreciation' (migration 004) and accounts 1500
--   Fixed Assets / 1510 Accumulated Depreciation are already seeded (migration 003) — so
--   this migration adds only tables + functions + a view + a settings-blob extension.
--
-- RLS / AUDIT (G2, G7)
--   Both tables are wired with accounting._apply_standard_table (read=can_read(),
--   write=can_write(), plus audit() and touch_updated_at() triggers), exactly like
--   accounting.budgets (017) / inventory_layers (015).
--
-- MONEY MATH (G6)
--   DB columns are numeric(14,2). The straight-line split is computed in INTEGER CENTS
--   (depreciable base = cost*100 - salvage*100; per-period = base / life; the rounding
--   remainder is absorbed into the FINAL period) so the lifetime total of all schedule
--   rows equals the depreciable base to the penny. The same algorithm is mirrored by the
--   JS pure helper (src/features/accounting/depreciation.ts) so DB and client agree.
--
-- IDEMPOTENCY / IMMUTABILITY
--   • generate_depreciation_schedule(asset) deletes only its own UNPOSTED rows and
--     re-inserts; rows already posted (carrying a journal_entry_id) are never touched.
--   • A unique index on (fixed_asset_id, period_date) is the idempotency anchor: at most
--     one schedule row per asset per period.
--   • post_depreciation_row(row) is a no-op if the row is already posted / already carries
--     a journal_entry_id, so re-running a period never double-posts. Posted JEs are
--     immutable (void/reverse only).
--   • CREATE TABLE IF NOT EXISTS + guarded index creation + CREATE OR REPLACE FUNCTION +
--     idempotent _apply_standard_table make the whole migration safely re-runnable.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP VIEW     IF EXISTS accounting.v_fixed_asset_register;
--   DROP FUNCTION IF EXISTS accounting.run_depreciation_for_period(date);
--   DROP FUNCTION IF EXISTS accounting.post_depreciation_row(uuid);
--   DROP FUNCTION IF EXISTS accounting.generate_depreciation_schedule(uuid);
--   DROP TABLE    IF EXISTS accounting.depreciation_schedule CASCADE;
--   DROP TABLE    IF EXISTS accounting.fixed_assets CASCADE;
--   -- (the settings default_accounts keys added below are harmless; leave or prune by hand)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Asset register
-- ─────────────────────────────────────────────────────────────────────────────
-- The three account FKs are ON DELETE RESTRICT so an account in use by an asset
-- can't be removed out from under it. accum_depr_account_id defaults to the seeded
-- 1510 Accumulated Depreciation account (resolved below); asset_account_id and
-- depr_expense_account_id are chosen per asset (defaults pre-filled by the UI from
-- accounting.settings.default_accounts). salvage_value <= cost so the depreciable
-- base is never negative.
create table if not exists accounting.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_account_id uuid not null references accounting.accounts(id) on delete restrict,
  -- accum_depr_account_id defaults to the seeded 1510 account; a column DEFAULT cannot
  -- contain a subquery, so the literal default is wired by the ALTER COLUMN below once
  -- 1510's id is resolved. Until then the column has no default (callers always pass it).
  accum_depr_account_id uuid not null references accounting.accounts(id) on delete restrict,
  depr_expense_account_id uuid not null references accounting.accounts(id) on delete restrict,
  cost numeric(14,2) not null check (cost >= 0),
  salvage_value numeric(14,2) not null default 0 check (salvage_value >= 0),
  useful_life_months int not null check (useful_life_months > 0),
  method text not null default 'straight_line' check (method in ('straight_line', 'declining_balance')),
  in_service_date date not null,
  status text not null default 'active' check (status in ('active', 'fully_depreciated', 'disposed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_assets_salvage_le_cost check (salvage_value <= cost)
);

-- Wire the literal default for accum_depr_account_id to the seeded 1510 account.
-- (A column DEFAULT may not be a subquery, so resolve the id and SET DEFAULT here.)
-- Idempotent + safe: only sets the default when 1510 exists; re-running is a no-op-equivalent.
do $$
declare
  v_accum uuid;
begin
  select id into v_accum from accounting.accounts where account_number = '1510';
  if v_accum is not null then
    execute format('alter table accounting.fixed_assets alter column accum_depr_account_id set default %L', v_accum);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Depreciation schedule — one planned/posted row per (asset, period)
-- ─────────────────────────────────────────────────────────────────────────────
-- period_date is the period-END date the depreciation belongs to. amount is the
-- planned figure for that period, numeric(14,2) per G6. journal_entry_id is NULL until
-- posted; ON DELETE RESTRICT so a posted row can't be orphaned from its ledger proof.
-- fixed_asset_id ON DELETE CASCADE: deleting an asset removes its schedule (its posted
-- JEs survive — they are corrected via void/reverse, not by deleting the asset).
create table if not exists accounting.depreciation_schedule (
  id uuid primary key default gen_random_uuid(),
  fixed_asset_id uuid not null references accounting.fixed_assets(id) on delete cascade,
  period_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  journal_entry_id uuid references accounting.journal_entries(id) on delete restrict,
  posted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Indexes (guarded so the migration is re-runnable)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_fixed_assets_status') then
    create index idx_acct_fixed_assets_status on accounting.fixed_assets(status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_fixed_assets_in_service') then
    create index idx_acct_fixed_assets_in_service on accounting.fixed_assets(in_service_date);
  end if;

  -- One schedule row per asset per period — the idempotency anchor for re-generation
  -- and for the period runner (a row can't be double-created or double-posted).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_depr_sched_asset_period') then
    create unique index uq_acct_depr_sched_asset_period
      on accounting.depreciation_schedule(fixed_asset_id, period_date);
  end if;
  -- "Due this period" hot path: open (unposted) rows ordered by period_date.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_depr_sched_due') then
    create index idx_acct_depr_sched_due
      on accounting.depreciation_schedule(period_date)
      where posted = false;
  end if;
  -- JE drill-through.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_depr_sched_je') then
    create index idx_acct_depr_sched_je on accounting.depreciation_schedule(journal_entry_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS + audit + touch_updated_at via the standard helper (G2)
-- ─────────────────────────────────────────────────────────────────────────────
select accounting._apply_standard_table('fixed_assets');
select accounting._apply_standard_table('depreciation_schedule');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Settings: register depreciation default accounts (additive blob merge)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the existing default_accounts KV blob with the three accounts an asset uses,
-- so the asset-create form can pre-fill its AccountPickers without hardcoding ids.
-- `||` merges the new keys; existing keys are preserved. Re-runnable.
update accounting.settings
   set setting_value = setting_value || jsonb_build_object(
         'fixed_asset',             (select id from accounting.accounts where account_number = '1500'),
         'accumulated_depreciation',(select id from accounting.accounts where account_number = '1510'),
         'depreciation_expense',    (select id from accounting.accounts where account_number = '6000')
       ),
       updated_at = now()
 where setting_key = 'default_accounts';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Generate the straight-line schedule for one asset (integer-cents, penny-exact)
-- ─────────────────────────────────────────────────────────────────────────────
-- Deletes this asset's UNPOSTED rows and re-inserts the straight-line plan. Posted rows
-- (journal_entry_id not null OR posted) are never touched. The depreciable base is split
-- in INTEGER CENTS: each of periods 1..N-1 gets floor(base/N) cents, the FINAL period N
-- absorbs the remainder, so SUM(amount) = cost - salvage to the penny.
--
-- period_date(k) is the END of the k-th month of service: for k = 1..N,
--   (date_trunc('month', in_service_date) + k months - 1 day)::date
-- which is the last day of the in-service month at k=1 and of each subsequent month.
--
-- Idempotent and write-gated. Returns the number of (unposted) rows written. For
-- method = 'declining_balance' it currently emits the SAME straight-line rows (the
-- declining-balance generator is deferred; this keeps the action total-correct rather
-- than emitting nothing). Callers create/edit an asset and then call this.
create or replace function accounting.generate_depreciation_schedule(p_asset_id uuid)
returns int
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_cost numeric(14,2);
  v_salvage numeric(14,2);
  v_life int;
  v_in_service date;
  v_base_cents bigint;
  v_per_cents bigint;
  v_k int;
  v_amount_cents bigint;
  v_period date;
  v_count int := 0;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to generate a depreciation schedule'
      using errcode = 'insufficient_privilege';
  end if;

  select cost, salvage_value, useful_life_months, in_service_date
    into v_cost, v_salvage, v_life, v_in_service
    from accounting.fixed_assets
   where id = p_asset_id;
  if not found then
    raise exception 'fixed asset % not found', p_asset_id using errcode = 'no_data_found';
  end if;

  -- Depreciable base in integer cents (G6). v_life > 0 is guaranteed by the table check.
  v_base_cents := round(v_cost * 100)::bigint - round(v_salvage * 100)::bigint;

  -- Replace only the UNPOSTED rows; never disturb posted history.
  delete from accounting.depreciation_schedule
   where fixed_asset_id = p_asset_id
     and posted = false
     and journal_entry_id is null;

  -- Nothing to depreciate (base <= 0) → no rows; the asset is effectively fully salvage.
  if v_base_cents <= 0 then
    return 0;
  end if;

  v_per_cents := v_base_cents / v_life;   -- floor division (both bigint)

  for v_k in 1 .. v_life loop
    if v_k < v_life then
      v_amount_cents := v_per_cents;
    else
      -- Final period absorbs the rounding remainder so the lifetime total is exact.
      v_amount_cents := v_base_cents - v_per_cents * (v_life - 1);
    end if;

    v_period := (date_trunc('month', v_in_service::timestamp)
                  + make_interval(months => v_k)
                  - interval '1 day')::date;

    -- Upsert: if a row for this (asset, period) already exists but is unposted, refresh
    -- its amount; the unique index makes this safe and keeps re-generation idempotent.
    insert into accounting.depreciation_schedule (fixed_asset_id, period_date, amount, posted)
    values (p_asset_id, v_period, (v_amount_cents::numeric) / 100.0, false)
    on conflict (fixed_asset_id, period_date) do update
      set amount = excluded.amount,
          updated_at = now()
      where accounting.depreciation_schedule.posted = false;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Post ONE due depreciation schedule row (the atomic unit)
-- ─────────────────────────────────────────────────────────────────────────────
-- Builds a DRAFT balanced entry (Dr depreciation expense / Cr 1510 accumulated
-- depreciation) and posts it via post_journal_entry, then stamps the schedule row with
-- the journal_entry_id and posted=true. Idempotent: a row already posted / already
-- carrying a JE returns that JE unchanged (no double-post). A zero-amount row posts
-- nothing (a 0/0 entry can't satisfy the >=2-line balance guard) and is marked posted so
-- the runner doesn't keep re-selecting it. Returns the journal_entry_id (NULL for the
-- zero-amount case). Honors the D1 books-closed lock via post_journal_entry.
create or replace function accounting.post_depreciation_row(p_schedule_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_asset_id uuid;
  v_period date;
  v_amount numeric(14,2);
  v_posted boolean;
  v_existing_je uuid;
  v_name text;
  v_expense_acct uuid;
  v_accum_acct uuid;
  v_entry_id uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to post depreciation'
      using errcode = 'insufficient_privilege';
  end if;

  -- Lock the schedule row so concurrent runners can't post it twice.
  select s.fixed_asset_id, s.period_date, s.amount, s.posted, s.journal_entry_id
    into v_asset_id, v_period, v_amount, v_posted, v_existing_je
    from accounting.depreciation_schedule s
   where s.id = p_schedule_id
   for update;
  if not found then
    raise exception 'depreciation schedule row % not found', p_schedule_id using errcode = 'no_data_found';
  end if;

  -- Idempotency: already posted / already carries a JE → return it, no re-post.
  if v_posted or v_existing_je is not null then
    return v_existing_je;
  end if;

  -- Resolve the asset's posting accounts (expense + accumulated depreciation).
  select fa.name, fa.depr_expense_account_id, fa.accum_depr_account_id
    into v_name, v_expense_acct, v_accum_acct
    from accounting.fixed_assets fa
   where fa.id = v_asset_id;
  if not found then
    raise exception 'fixed asset % not found for schedule row %', v_asset_id, p_schedule_id
      using errcode = 'no_data_found';
  end if;

  -- Zero-amount period: nothing to post (can't form a balanced >=2-line entry). Mark it
  -- posted so the due-runner stops selecting it; leave journal_entry_id NULL.
  if v_amount is null or v_amount = 0 then
    update accounting.depreciation_schedule
       set posted = true, updated_at = now()
     where id = p_schedule_id;
    return null;
  end if;

  -- Build a DRAFT balanced entry, then post it through the permission/lock-checked RPC.
  insert into accounting.journal_entries (entry_date, memo, source_type, source_id, status, created_by)
  values (
    v_period,
    'Depreciation — ' || coalesce(v_name, v_asset_id::text) || ' — ' || v_period::text,
    'depreciation',          -- already allowed by the GL source_type enum (no enum change)
    v_asset_id,
    'draft',
    auth.uid()
  )
  returning id into v_entry_id;

  -- Dr depreciation expense
  insert into accounting.journal_lines
    (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
  values
    (v_entry_id, v_expense_acct, v_amount, 0, 'Depreciation expense', 0);

  -- Cr 1510 Accumulated Depreciation (contra-asset)
  insert into accounting.journal_lines
    (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
  values
    (v_entry_id, v_accum_acct, 0, v_amount, 'Accumulated depreciation', 1);

  -- Posts only if balanced with >=2 lines (guard_journal_entry). Balanced by construction.
  -- Also enforces the D1 books-closed lock: a period_date in a closed period raises here.
  perform accounting.post_journal_entry(v_entry_id);

  -- Stamp the schedule row with its ledger proof.
  update accounting.depreciation_schedule
     set journal_entry_id = v_entry_id, posted = true, updated_at = now()
   where id = p_schedule_id;

  return v_entry_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Run depreciation for a whole period (loops the due rows, posting each)
-- ─────────────────────────────────────────────────────────────────────────────
-- For every UNPOSTED schedule row dated ON OR BEFORE p_period_date (across all active
-- assets), post it via post_depreciation_row. Oldest-period-first, deterministic so a
-- closed-period failure stops at a clean point. Re-running the same period is a no-op for
-- rows already posted (idempotent). Returns one row per JE actually posted:
-- (schedule_id, fixed_asset_id, journal_entry_id, amount). Zero-amount rows are consumed
-- (marked posted) but produce no output row.
create or replace function accounting.run_depreciation_for_period(p_period_date date)
returns table (
  schedule_id uuid,
  fixed_asset_id uuid,
  journal_entry_id uuid,
  amount numeric(14,2)
)
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_row record;
  v_je uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to run depreciation'
      using errcode = 'insufficient_privilege';
  end if;

  for v_row in
    select s.id, s.fixed_asset_id, s.amount
      from accounting.depreciation_schedule s
      join accounting.fixed_assets fa on fa.id = s.fixed_asset_id
     where s.posted = false
       and s.journal_entry_id is null
       and s.period_date <= p_period_date
       and fa.status <> 'disposed'
     order by s.period_date asc, s.fixed_asset_id asc
  loop
    v_je := accounting.post_depreciation_row(v_row.id);
    -- Emit a result row only when an actual JE was posted (skip zero-amount consumes).
    if v_je is not null then
      schedule_id      := v_row.id;
      fixed_asset_id   := v_row.fixed_asset_id;
      journal_entry_id := v_je;
      amount           := v_row.amount;
      return next;
    end if;
  end loop;

  return;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Read-model: fixed-asset register (cost, accumulated depreciation, NBV)
-- ─────────────────────────────────────────────────────────────────────────────
-- Per asset: cost, salvage, total posted depreciation (from POSTED schedule rows), net
-- book value (cost - accumulated, floored at salvage), and remaining unposted plan.
-- security_invoker so the caller's RLS (accounting.can_read) applies. NBV is clamped to
-- salvage as a safety net against any future over-scheduling.
create or replace view accounting.v_fixed_asset_register with (security_invoker = true) as
with posted as (
  select s.fixed_asset_id,
         sum(s.amount) as accumulated_depreciation,
         count(*)      as periods_posted
    from accounting.depreciation_schedule s
   where s.posted = true
   group by s.fixed_asset_id
),
planned as (
  select s.fixed_asset_id,
         sum(s.amount) as remaining_planned,
         count(*)      as periods_remaining
    from accounting.depreciation_schedule s
   where s.posted = false
   group by s.fixed_asset_id
)
select fa.id,
       fa.name,
       fa.asset_account_id,
       fa.accum_depr_account_id,
       fa.depr_expense_account_id,
       fa.cost,
       fa.salvage_value,
       fa.useful_life_months,
       fa.method,
       fa.in_service_date,
       fa.status,
       coalesce(p.accumulated_depreciation, 0)              as accumulated_depreciation,
       coalesce(p.periods_posted, 0)                        as periods_posted,
       greatest(fa.cost - coalesce(p.accumulated_depreciation, 0), fa.salvage_value)
                                                            as net_book_value,
       coalesce(pl.remaining_planned, 0)                    as remaining_planned,
       coalesce(pl.periods_remaining, 0)                    as periods_remaining
  from accounting.fixed_assets fa
  left join posted  p  on p.fixed_asset_id  = fa.id
  left join planned pl on pl.fixed_asset_id = fa.id;

grant select on accounting.v_fixed_asset_register to authenticated, service_role;

-- Belt-and-suspenders explicit grants (default privileges already cover new objects;
-- restated for unambiguous current-object grants, matching migrations 015/017).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
