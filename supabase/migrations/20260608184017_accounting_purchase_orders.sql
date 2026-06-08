-- WorkTrackAccounting — #11: purchase orders + 3-way match
--
-- A purchase order (PO) is a COMMITMENT to buy, not a posted transaction. Like the
-- estimate (migration 20260608174045) it MIRRORS the AP bill header/lines
-- (accounting.bills / bill_lines from migration 20260603164225) but carries NO money
-- to the ledger: a PO is an intent. Money posts only when its converted bill is later
-- POSTED (the existing bills.post flow posts the balanced expense JE Dr Expense /
-- Cr Accounts Payable). purchase_order_lines mirror bill_lines (a line targets an
-- accounting.items item OR a GL account directly; at least one is required) and carry
-- the B2 reporting dimensions so they copy cleanly onto the bill line on convert.
--
-- 3-WAY MATCH: an additive, nullable bill_lines.po_line_id column links a received bill
-- line back to the PO line it fulfils. The app's variance panel compares quantity
-- ordered vs received and PO unit_cost vs the linked bill's unit_cost. The link is the
-- ONLY change to an existing table; bill_lines is otherwise untouched.
--
-- accounting.convert_po_to_bill(p_po_id) clones a DRAFT bill + its lines from a PO,
-- stamps each new bill line's po_line_id, and accrues the PO line's quantity_received —
-- all in ONE transaction (SECURITY DEFINER, pinned search_path, can_write guard). It is
-- idempotent in the estimate sense: it raises on a cancelled PO and otherwise produces a
-- fresh draft bill each call (a PO can legitimately be billed in multiple deliveries),
-- returning the new bill id. It posts NO journal entry (the bill posts later via
-- bills.post). PO status advances to 'received' when every line is fully received, else
-- 'partially_received'.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.convert_po_to_bill(uuid);
--   DROP TRIGGER IF EXISTS dim_check_purchase_order_lines ON accounting.purchase_order_lines;
--   ALTER TABLE accounting.bill_lines DROP COLUMN IF EXISTS po_line_id;
--   DROP TABLE IF EXISTS accounting.purchase_order_lines CASCADE;
--   DROP TABLE IF EXISTS accounting.purchase_orders CASCADE;

create table if not exists accounting.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references accounting.vendors(id) on delete restrict,
  po_number text,
  order_date date not null default current_date,
  expected_date date,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'partially_received', 'received', 'closed', 'cancelled')),
  job_id uuid references public.jobs(id) on delete set null,
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references accounting.purchase_orders(id) on delete cascade,
  -- A line targets an item (item-based) OR a GL account directly (account-based),
  -- mirroring accounting.bill_lines; at least one of the two is required.
  item_id uuid references accounting.items(id) on delete set null,
  account_id uuid references accounting.accounts(id) on delete set null,
  description text,
  quantity_ordered numeric(14,4) not null default 1,
  unit_cost numeric(14,4) not null default 0,
  quantity_received numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  job_id uuid references public.jobs(id) on delete set null,
  -- B2 reporting dimensions, persisted on the line and copied onto the bill line on convert.
  class_id uuid references accounting.dimensions(id) on delete set null,
  location_id uuid references accounting.dimensions(id) on delete set null,
  department_id uuid references accounting.dimensions(id) on delete set null,
  sort_order int not null default 0,
  constraint purchase_order_lines_has_target check (account_id is not null or item_id is not null)
);

-- Additive 3-way-match link: a bill line may reference the PO line it fulfils. Guarded so
-- the migration is idempotent. NULL on every existing bill line (the column is purely
-- additive — no existing bill flow sets or requires it).
alter table accounting.bill_lines
  add column if not exists po_line_id uuid
    references accounting.purchase_order_lines(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_pos_vendor') then
    create index idx_acct_pos_vendor on accounting.purchase_orders(vendor_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_pos_status') then
    create index idx_acct_pos_status on accounting.purchase_orders(status);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_pos_job') then
    create index idx_acct_pos_job on accounting.purchase_orders(job_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_po_lines_po') then
    create index idx_acct_po_lines_po on accounting.purchase_order_lines(po_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_bill_lines_po_line') then
    create index idx_acct_bill_lines_po_line on accounting.bill_lines(po_line_id);
  end if;
end $$;

-- purchase_order_lines carry class/location/department; reuse the shared dimension-type
-- validator (migration 20260603164441) so a class_id must reference a 'class' row, etc.
drop trigger if exists dim_check_purchase_order_lines on accounting.purchase_order_lines;
create trigger dim_check_purchase_order_lines
  before insert or update on accounting.purchase_order_lines
  for each row execute function accounting.assert_line_dimension_types();

-- Convert a PO into a DRAFT bill, atomically. Clones the PO header + lines into a bill,
-- stamps each new bill line's po_line_id (the 3-way-match link), and accrues the PO
-- line's quantity_received by the quantity billed. The client still POSTS the resulting
-- bill to record the expense JE (no money posts here). Mirrors
-- accounting.convert_estimate_to_invoice's permission + search_path conventions.
create or replace function accounting.convert_po_to_bill(p_po_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_po accounting.purchase_orders%rowtype;
  v_bill_id uuid;
  v_all_received boolean;
  v_any_received boolean;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to convert a purchase order' using errcode = 'insufficient_privilege';
  end if;

  -- Lock the PO so two concurrent converts cannot race the quantity_received accrual.
  select * into v_po from accounting.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'purchase order % not found', p_po_id using errcode = 'no_data_found';
  end if;
  if v_po.status = 'cancelled' then
    raise exception 'a cancelled purchase order cannot be billed' using errcode = 'check_violation';
  end if;

  -- Clone the header into a DRAFT bill (balance_due = total; no JE yet).
  insert into accounting.bills (
    vendor_id, bill_number, bill_date, status,
    subtotal, tax_total, total, balance_due, job_id, memo, created_by
  ) values (
    v_po.vendor_id, null, current_date, 'draft',
    v_po.subtotal, v_po.tax_total, v_po.total, v_po.total, v_po.job_id, v_po.memo, auth.uid()
  ) returning id into v_bill_id;

  -- Copy the lines (purchase_order_lines → bill_lines), stamping the 3-way-match link and
  -- preserving order + dimensions. The still-unbilled quantity (ordered − already received)
  -- is billed per line, so re-billing a partially-received PO never double-bills; a
  -- partial-receipt UI can edit the draft bill before posting.
  insert into accounting.bill_lines (
    bill_id, account_id, item_id, description, quantity, unit_cost, line_total,
    job_id, class_id, location_id, department_id, po_line_id, sort_order
  )
  select
    v_bill_id, pol.account_id, pol.item_id, pol.description,
    greatest(pol.quantity_ordered - pol.quantity_received, 0), pol.unit_cost,
    round(greatest(pol.quantity_ordered - pol.quantity_received, 0) * pol.unit_cost, 2),
    pol.job_id, pol.class_id, pol.location_id, pol.department_id, pol.id, pol.sort_order
  from accounting.purchase_order_lines pol
  where pol.po_id = p_po_id;

  -- Accrue the billed (still-unbilled) quantity onto each PO line's quantity_received,
  -- clamped at ordered. A line already fully received accrues nothing (bills zero).
  update accounting.purchase_order_lines
     set quantity_received = least(quantity_ordered, quantity_received + greatest(quantity_ordered - quantity_received, 0))
   where po_id = p_po_id;

  -- Advance PO status from the accrued receipts: fully received → 'received', some → 'partially_received'.
  select bool_and(quantity_received >= quantity_ordered), bool_or(quantity_received > 0)
    into v_all_received, v_any_received
    from accounting.purchase_order_lines
   where po_id = p_po_id;

  update accounting.purchase_orders
     set status = case
                    when v_all_received then 'received'
                    when v_any_received then 'partially_received'
                    else status
                  end
   where id = p_po_id;

  return v_bill_id;
end;
$$;

select accounting._apply_standard_table('purchase_orders');
select accounting._apply_standard_table('purchase_order_lines', false);

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant execute on function accounting.convert_po_to_bill(uuid) to authenticated;
