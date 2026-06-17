-- Live, editable sales documents — schema support for:
--   • per-document section layout         (invoices.layout / estimates.layout jsonb; null = org default)
--   • line ↔ real part link               (invoice_lines.part_id / estimate_lines.part_id → public.parts)
--   • void & reissue a SENT invoice        (invoices.reissued_from_invoice_id + the RPC below)
--
-- All additive + idempotent (add column if not exists / create or replace). The line tables already
-- have accounting._apply_standard_table applied, so an ADD COLUMN inherits their RLS — no re-apply.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.void_and_reissue_invoice(uuid);
--   ALTER TABLE accounting.invoices       DROP COLUMN IF EXISTS reissued_from_invoice_id;
--   ALTER TABLE accounting.invoice_lines  DROP COLUMN IF EXISTS part_id;
--   ALTER TABLE accounting.estimate_lines DROP COLUMN IF EXISTS part_id;
--   ALTER TABLE accounting.invoices       DROP COLUMN IF EXISTS layout;
--   ALTER TABLE accounting.estimates      DROP COLUMN IF EXISTS layout;
--   -- and restore the pre-this-migration body of accounting.convert_estimate_to_invoice
--   -- (drop the part_id column from its insert + select lists).

-- ── 1. Per-document section layout (null → org-default order; zero backfill) ────────────────────
alter table accounting.invoices  add column if not exists layout jsonb;
alter table accounting.estimates add column if not exists layout jsonb;

-- ── 2. Line ↔ real part link (orthogonal to item_id; mirrors the job_id FK's on delete set null) ─
alter table accounting.invoice_lines
  add column if not exists part_id uuid references public.parts(id) on delete set null;
alter table accounting.estimate_lines
  add column if not exists part_id uuid references public.parts(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_acct_invoice_lines_part') then
    create index idx_acct_invoice_lines_part on accounting.invoice_lines(part_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_acct_estimate_lines_part') then
    create index idx_acct_estimate_lines_part on accounting.estimate_lines(part_id);
  end if;
end $$;

-- ── 3. Void & reissue support: a reissued draft links back to the invoice it replaced ───────────
alter table accounting.invoices
  add column if not exists reissued_from_invoice_id uuid references accounting.invoices(id) on delete set null;

-- ── 4. Extend convert_estimate_to_invoice to carry the new part_id (else convert drops the link) ─
-- Verbatim re-create of the 20260608174045 body with part_id added to the line insert + select.
create or replace function accounting.convert_estimate_to_invoice(p_estimate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_estimate accounting.estimates%rowtype;
  v_invoice_id uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to convert an estimate' using errcode = 'insufficient_privilege';
  end if;

  -- Lock the estimate so two concurrent converts cannot each create an invoice.
  select * into v_estimate from accounting.estimates where id = p_estimate_id for update;
  if not found then
    raise exception 'estimate % not found', p_estimate_id using errcode = 'no_data_found';
  end if;

  -- Idempotent: an already-converted estimate returns its existing invoice.
  if v_estimate.status = 'converted' and v_estimate.converted_invoice_id is not null then
    return v_estimate.converted_invoice_id;
  end if;
  if v_estimate.status = 'declined' then
    raise exception 'a declined estimate cannot be converted' using errcode = 'check_violation';
  end if;

  -- Clone the header into a DRAFT invoice (balance_due = total; no JE yet).
  insert into accounting.invoices (
    customer_id, job_id, invoice_date, due_date, terms, status,
    subtotal, discount_total, tax_total, total, balance_due,
    tax_code_id, memo, notes, created_by
  ) values (
    v_estimate.customer_id, v_estimate.job_id, current_date, v_estimate.expiry_date, v_estimate.terms, 'draft',
    v_estimate.subtotal, v_estimate.discount_total, v_estimate.tax_total, v_estimate.total, v_estimate.total,
    v_estimate.tax_code_id, v_estimate.memo, v_estimate.notes, auth.uid()
  ) returning id into v_invoice_id;

  -- Copy the lines (estimate_lines → invoice_lines), preserving order + dimensions + part link.
  insert into accounting.invoice_lines (
    invoice_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
    tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order
  )
  select
    v_invoice_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
    tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order
  from accounting.estimate_lines
  where estimate_id = p_estimate_id;

  -- Mark the estimate converted + link the two.
  update accounting.estimates
     set status = 'converted',
         converted_invoice_id = v_invoice_id
   where id = p_estimate_id;

  return v_invoice_id;
end;
$$;

-- ── 5. Void & reissue a SENT invoice: reverse its revenue JE, void it, clone into a new draft ────
-- Modeled on convert_estimate_to_invoice (security definer, pinned search_path, can_write, FOR UPDATE,
-- idempotent). Guards amount_paid = 0 (matches voidInvoice). The new DRAFT is edited (Stage F) and
-- re-Sent to post a fresh JE. The original's posted revenue JE is reversed via void_journal_entry.
create or replace function accounting.void_and_reissue_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_inv      accounting.invoices%rowtype;
  v_existing uuid;
  v_new_id   uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to reissue an invoice' using errcode = 'insufficient_privilege';
  end if;

  -- Lock the original so concurrent reissues cannot each spawn a draft.
  select * into v_inv from accounting.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = 'no_data_found';
  end if;

  -- Idempotent: if this invoice was already reissued into a still-living document, return it.
  select id into v_existing
    from accounting.invoices
   where reissued_from_invoice_id = p_invoice_id
     and status <> 'void'
   order by created_at
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if v_inv.status = 'draft' then
    raise exception 'a draft invoice is edited directly, not reissued' using errcode = 'check_violation';
  end if;
  if v_inv.status = 'void' then
    raise exception 'a void invoice cannot be reissued' using errcode = 'check_violation';
  end if;
  if coalesce(v_inv.amount_paid, 0) <> 0 then
    raise exception 'unapply payments before reissuing this invoice' using errcode = 'check_violation';
  end if;

  -- Reverse the posted revenue JE (if any), then void the original.
  if v_inv.journal_entry_id is not null then
    perform accounting.void_journal_entry(
      v_inv.journal_entry_id,
      'Reissued from invoice ' || coalesce(v_inv.invoice_number, p_invoice_id::text)
    );
  end if;

  update accounting.invoices set status = 'void' where id = p_invoice_id;

  -- Clone the header into a new DRAFT (balance_due = total; no JE yet), linked back to the original.
  insert into accounting.invoices (
    customer_id, job_id, invoice_date, due_date, terms, status,
    subtotal, discount_total, tax_total, total, balance_due,
    tax_code_id, memo, notes, layout, reissued_from_invoice_id, created_by
  ) values (
    v_inv.customer_id, v_inv.job_id, current_date, v_inv.due_date, v_inv.terms, 'draft',
    v_inv.subtotal, v_inv.discount_total, v_inv.tax_total, v_inv.total, v_inv.total,
    v_inv.tax_code_id, v_inv.memo, v_inv.notes, v_inv.layout, p_invoice_id, auth.uid()
  ) returning id into v_new_id;

  -- Copy the lines, preserving order + dimensions + part link.
  insert into accounting.invoice_lines (
    invoice_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
    tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order
  )
  select
    v_new_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
    tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order
  from accounting.invoice_lines
  where invoice_id = p_invoice_id;

  return v_new_id;
end;
$$;

grant execute on function accounting.void_and_reissue_invoice(uuid) to authenticated;
revoke execute on function accounting.void_and_reissue_invoice(uuid) from anon;
