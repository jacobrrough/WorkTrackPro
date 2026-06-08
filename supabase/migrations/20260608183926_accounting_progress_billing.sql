-- WorkTrackAccounting — #10: progress billing + retainage + change orders (AIA-style)
--
-- Construction-style progressive billing. A PROJECT carries a contract sum and a default
-- retainage percent. Its Schedule of Values (SOV) breaks the contract into line items, each
-- with a scheduled value and an income account. CHANGE ORDERS add (or subtract, when their
-- amount is negative) scope; an approved change order's delta is represented by SOV line(s)
-- that reference it (sov_lines.change_order_id). Each billing period a PROGRESS INVOICE
-- records the percent-complete per SOV line, computes the work-completed-to-date (W) and the
-- retainage-to-date (R), and bills the current period (W − previously-billed, net of the
-- retainage delta). The progress invoice LINKS to a real accounting.invoices row (created +
-- posted by the service via accounting.post_journal_entry) so all money still flows through
-- the one balanced-entry path; releaseRetainage later posts the retainage-release JE.
--
-- DOUBLE-ENTRY (G3): NO money posts in this migration. These are document tables only. The
-- balanced JE for a period is built in src/features/accounting/posting.ts
-- (buildProgressInvoiceJournalLines) and posted through accounting.post_journal_entry by the
-- progressBilling service, exactly like an invoice posts its revenue JE:
--   Dr 1200 Accounts Receivable     (W − R for the period)
--   Dr 1210 Retainage Receivable    (R for the period — withheld, billed-but-not-yet-due)
--   Cr 4000/41xx Income             (W for the period, grouped by income account × dims)
--   [Cr 2200 Sales Tax Payable      (tax, if taxable)]
-- Integer-cents math in the builder guarantees (W − R) + R == W to the penny.
--
-- TAX BASE: tax-on-WORK (W) — sales tax (when applicable) is charged on the period's
-- earned work, NOT on the net-of-retainage amount. Retainage is a financing/withholding
-- mechanism, not a reduction of the taxable sale, so the full earned revenue is the base.
-- (Marked 'W' here per the build spec; the builder mirrors this.)
--
-- OVER-BILLING GUARD: a BEFORE INSERT/UPDATE trigger on progress_invoice_lines rejects
--   • completed_to_date > the SOV line's scheduled_value (you cannot bill more than a line's
--     scheduled value, which already includes any approved change-order scope on that line), and
--   • a negative current_period (no negative period billing),
-- mirroring the over-application reject in accounting.sync_invoice_payment and the estimate
-- guard. A SOV line tied to a NON-approved change order is not billable (its change order must
-- be 'approved' first) — also enforced by the trigger.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS guard_progress_invoice_line ON accounting.progress_invoice_lines;
--   DROP FUNCTION IF EXISTS accounting.guard_progress_invoice_line() CASCADE;
--   DROP TABLE IF EXISTS accounting.progress_invoice_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.progress_invoices CASCADE;
--   DROP TABLE IF EXISTS accounting.sov_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.change_orders CASCADE;
--   DROP TABLE IF EXISTS accounting.projects CASCADE;

-- A construction project / contract: the parent of an SOV, its change orders, and its
-- progress invoices. retainage_percent is the default fraction withheld each period
-- (0.10 = 10%); a progress invoice may override per-line in the application math.
create table if not exists accounting.projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references accounting.customers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  name text not null,
  contract_sum numeric(14,2) not null default 0,
  retainage_percent numeric(6,4) not null default 0.10 check (retainage_percent >= 0 and retainage_percent <= 1),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Change orders, created before sov_lines so sov_lines.change_order_id can FK it. `amount`
-- is the contract-sum DELTA (may be negative for a deduct change order). An approved change
-- order's scope is realized as one or more sov_lines pointing back at it.
create table if not exists accounting.change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references accounting.projects(id) on delete cascade,
  co_number text,
  description text,
  amount numeric(14,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Schedule of Values: the line-item breakdown of the contract that the application bills
-- against. change_order_id null = original scope; non-null = scope added by that change
-- order (only billable once the change order is 'approved' — enforced by the line guard).
create table if not exists accounting.sov_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references accounting.projects(id) on delete cascade,
  description text,
  scheduled_value numeric(14,2) not null default 0,
  income_account_id uuid references accounting.accounts(id) on delete set null,
  -- null = original contract scope; non-null = scope from an approved change order.
  change_order_id uuid references accounting.change_orders(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One billing period's application (the AIA G702 header). invoice_id links to the real
-- accounting.invoices row the service creates + posts (null only for a transient draft before
-- posting). sequence is the application number (1, 2, 3 …). All money figures are dollars.
create table if not exists accounting.progress_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references accounting.projects(id) on delete cascade,
  invoice_id uuid references accounting.invoices(id) on delete set null,
  period_end date not null default current_date,
  sequence int not null default 1,
  work_completed_to_date numeric(14,2) not null default 0,
  retainage_to_date numeric(14,2) not null default 0,
  previously_billed numeric(14,2) not null default 0,
  current_due numeric(14,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The AIA G703 continuation-sheet lines: per SOV line, the percent complete this application
-- and the resulting completed-to-date / retainage / current-period figures. completed_to_date
-- is cumulative (this period's running total for the line); current_period is the increment
-- billed now. The line guard rejects completed_to_date > the SOV line's scheduled_value and a
-- negative current_period.
create table if not exists accounting.progress_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  progress_invoice_id uuid not null references accounting.progress_invoices(id) on delete cascade,
  sov_line_id uuid not null references accounting.sov_lines(id) on delete restrict,
  percent_complete numeric(6,4) not null default 0,
  completed_to_date numeric(14,2) not null default 0,
  retainage_this_period numeric(14,2) not null default 0,
  current_period numeric(14,2) not null default 0,
  sort_order int not null default 0
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_projects_customer') then
    create index idx_acct_projects_customer on accounting.projects(customer_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_projects_job') then
    create index idx_acct_projects_job on accounting.projects(job_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_change_orders_project') then
    create index idx_acct_change_orders_project on accounting.change_orders(project_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_sov_lines_project') then
    create index idx_acct_sov_lines_project on accounting.sov_lines(project_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_sov_lines_change_order') then
    create index idx_acct_sov_lines_change_order on accounting.sov_lines(change_order_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_progress_invoices_project') then
    create index idx_acct_progress_invoices_project on accounting.progress_invoices(project_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_progress_invoices_invoice') then
    create index idx_acct_progress_invoices_invoice on accounting.progress_invoices(invoice_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_progress_invoice_lines_invoice') then
    create index idx_acct_progress_invoice_lines_invoice on accounting.progress_invoice_lines(progress_invoice_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_progress_invoice_lines_sov') then
    create index idx_acct_progress_invoice_lines_sov on accounting.progress_invoice_lines(sov_line_id);
  end if;
  -- Idempotency (accounting review #5/Issue 4): at most ONE application per (project, sequence).
  -- A retried/raced createProgressInvoice that recomputes the same sequence fails CLOSED here,
  -- so a balanced JE + invoice can never be double-posted (the service cleans up the loser).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_progress_invoices_project_seq') then
    create unique index uq_acct_progress_invoices_project_seq
      on accounting.progress_invoices(project_id, sequence);
  end if;
end $$;

-- Over-billing guard. Rejects a progress-invoice line that would bill more than its SOV line's
-- scheduled value (completed-to-date cap), bill a negative current period, or bill against a
-- change-order SOV line whose change order is not 'approved'. Mirrors the over-application
-- reject in accounting.sync_invoice_payment (errcode check_violation, SECURITY DEFINER, pinned
-- search_path). Runs BEFORE INSERT/UPDATE so a bad row never lands.
create or replace function accounting.guard_progress_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_scheduled numeric(14,2);
  v_co uuid;
  v_co_status text;
begin
  -- No negative period billing.
  if new.current_period < 0 then
    raise exception 'progress billing current_period (%) cannot be negative', new.current_period
      using errcode = 'check_violation';
  end if;

  -- Cumulative billed cannot exceed the SOV line's scheduled value (the line already includes
  -- any approved change-order scope it represents).
  select scheduled_value, change_order_id into v_scheduled, v_co
    from accounting.sov_lines where id = new.sov_line_id;
  if not found then
    raise exception 'SOV line % not found', new.sov_line_id using errcode = 'no_data_found';
  end if;
  if new.completed_to_date > v_scheduled then
    raise exception 'completed-to-date (%) exceeds the SOV line scheduled value (%)',
      new.completed_to_date, v_scheduled using errcode = 'check_violation';
  end if;

  -- A change-order SOV line is billable only once its change order is approved.
  if v_co is not null then
    select status into v_co_status from accounting.change_orders where id = v_co;
    if v_co_status is distinct from 'approved' then
      raise exception 'cannot bill SOV line tied to a non-approved change order (status %)',
        coalesce(v_co_status, 'missing') using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_progress_invoice_line on accounting.progress_invoice_lines;
create trigger guard_progress_invoice_line before insert or update on accounting.progress_invoice_lines
  for each row execute function accounting.guard_progress_invoice_line();

select accounting._apply_standard_table('projects');
select accounting._apply_standard_table('change_orders');
select accounting._apply_standard_table('sov_lines');
select accounting._apply_standard_table('progress_invoices');
select accounting._apply_standard_table('progress_invoice_lines', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant execute on function accounting.guard_progress_invoice_line() to authenticated;
