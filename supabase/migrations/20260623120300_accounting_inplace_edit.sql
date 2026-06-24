-- In-place edit of a POSTED invoice/bill: atomically swap the ledger entry.
--
-- WHY: correcting a sent invoice today means void & reissue (a brand-new document/number). We
-- instead let the same document be edited in place. A posted journal entry is never mutated — the
-- caller posts a fresh BALANCED replacement entry (via the existing TS posting path +
-- post_journal_entry), then calls this RPC, which in ONE transaction: re-checks guards, pins a
-- pre-edit snapshot, replaces header+lines, relinks journal_entry_id to the replacement, and
-- VOIDS the old entry. If anything here fails (e.g. the old entry is in a closed period) the whole
-- edit rolls back and the caller compensates by voiding the just-posted replacement entry — so the
-- invoice can never end up pointing at a voided entry, and the trial balance always ties out.
--
-- GUARDS: void docs and paid docs (amount_paid <> 0) are rejected (use void & reissue / unapply
-- first). Bills touching received-inventory cost layers (source_inventory_id) are rejected — those
-- must go through void & reissue so FIFO valuation (GL 1300 ↔ v_inventory_valuation) stays intact.
-- The closed-period lock is enforced transitively by void_journal_entry / post_journal_entry.
--
-- IDEMPOTENT. ROLLBACK:
--   drop function if exists accounting.apply_posted_invoice_edit(uuid, uuid, jsonb, jsonb);
--   drop function if exists accounting.apply_posted_bill_edit(uuid, uuid, jsonb, jsonb);

create or replace function accounting.apply_posted_invoice_edit(
  p_invoice_id uuid, p_new_entry_id uuid, p_header jsonb, p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_inv       accounting.invoices%rowtype;
  v_old_je    uuid;
  v_je_status text;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to edit a posted invoice' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from accounting.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice % not found', p_invoice_id using errcode = 'no_data_found';
  end if;
  if v_inv.status = 'void' then
    raise exception 'a void invoice cannot be edited' using errcode = 'check_violation';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'draft invoices are edited directly, not via apply_posted_invoice_edit' using errcode = 'check_violation';
  end if;
  if coalesce(v_inv.amount_paid, 0) <> 0 then
    raise exception 'unapply payments before changing the amounts on this invoice' using errcode = 'check_violation';
  end if;

  -- The caller must already have posted the replacement entry for this invoice.
  select status into v_je_status from accounting.journal_entries where id = p_new_entry_id;
  if v_je_status is distinct from 'posted' then
    raise exception 'replacement journal entry % must be posted (is %)', p_new_entry_id, coalesce(v_je_status, 'missing')
      using errcode = 'check_violation';
  end if;

  v_old_je := v_inv.journal_entry_id;

  -- Pin the pre-edit state so the change is recoverable from the timeline.
  perform accounting.capture_document_snapshot('invoice', p_invoice_id, 'before edit', 'autosave');

  update accounting.invoices set
    customer_id      = coalesce((p_header->>'customer_id')::uuid, customer_id),
    job_id           = (p_header->>'job_id')::uuid,
    invoice_date     = coalesce((p_header->>'invoice_date')::date, invoice_date),
    due_date         = (p_header->>'due_date')::date,
    terms            = p_header->>'terms',
    tax_code_id      = (p_header->>'tax_code_id')::uuid,
    memo             = p_header->>'memo',
    notes            = p_header->>'notes',
    subtotal         = (p_header->>'subtotal')::numeric,
    discount_total   = (p_header->>'discount_total')::numeric,
    tax_total        = (p_header->>'tax_total')::numeric,
    total            = (p_header->>'total')::numeric,
    balance_due      = (p_header->>'total')::numeric,
    layout           = coalesce(p_header->'layout', layout),
    journal_entry_id = p_new_entry_id,
    updated_at       = now()
  where id = p_invoice_id;

  delete from accounting.invoice_lines where invoice_id = p_invoice_id;
  insert into accounting.invoice_lines
    (invoice_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
     tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order)
  select p_invoice_id,
    (l->>'item_id')::uuid, (l->>'part_id')::uuid, l->>'description',
    coalesce((l->>'quantity')::numeric, 1), coalesce((l->>'unit_price')::numeric, 0),
    coalesce((l->>'line_total')::numeric, 0), coalesce((l->>'discount')::numeric, 0),
    (l->>'tax_code_id')::uuid, coalesce((l->>'taxable')::boolean, true),
    (l->>'income_account_id')::uuid, (l->>'job_id')::uuid,
    (l->>'class_id')::uuid, (l->>'location_id')::uuid, (l->>'department_id')::uuid,
    coalesce((l->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l;

  -- Void the superseded entry LAST. A failure here (e.g. closed period) rolls the whole edit back.
  if v_old_je is not null and v_old_je <> p_new_entry_id then
    perform accounting.void_journal_entry(
      v_old_je,
      'Invoice ' || coalesce(v_inv.invoice_number, p_invoice_id::text) || ' edited in place'
    );
  end if;
end;
$function$;

create or replace function accounting.apply_posted_bill_edit(
  p_bill_id uuid, p_new_entry_id uuid, p_header jsonb, p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_bill      accounting.bills%rowtype;
  v_old_je    uuid;
  v_je_status text;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to edit a posted bill' using errcode = 'insufficient_privilege';
  end if;

  select * into v_bill from accounting.bills where id = p_bill_id for update;
  if not found then
    raise exception 'bill % not found', p_bill_id using errcode = 'no_data_found';
  end if;
  if v_bill.status = 'void' then
    raise exception 'a void bill cannot be edited' using errcode = 'check_violation';
  end if;
  if v_bill.status = 'draft' then
    raise exception 'draft bills are edited directly, not via apply_posted_bill_edit' using errcode = 'check_violation';
  end if;
  if coalesce(v_bill.amount_paid, 0) <> 0 then
    raise exception 'unapply vendor payments before changing the amounts on this bill' using errcode = 'check_violation';
  end if;

  -- Inventory safety: a bill that capitalized received stock must not be reverse+reposted here
  -- (it would desync FIFO cost layers). Such bills are corrected via void & reissue.
  if exists (select 1 from accounting.bill_lines where bill_id = p_bill_id and source_inventory_id is not null)
     or exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
                 where nullif(l->>'source_inventory_id', '') is not null) then
    raise exception 'bills linked to received inventory must be corrected with void & reissue' using errcode = 'check_violation';
  end if;

  select status into v_je_status from accounting.journal_entries where id = p_new_entry_id;
  if v_je_status is distinct from 'posted' then
    raise exception 'replacement journal entry % must be posted (is %)', p_new_entry_id, coalesce(v_je_status, 'missing')
      using errcode = 'check_violation';
  end if;

  v_old_je := v_bill.journal_entry_id;

  update accounting.bills set
    vendor_id        = coalesce((p_header->>'vendor_id')::uuid, vendor_id),
    bill_number      = p_header->>'bill_number',
    bill_date        = coalesce((p_header->>'bill_date')::date, bill_date),
    due_date         = (p_header->>'due_date')::date,
    terms            = p_header->>'terms',
    job_id           = (p_header->>'job_id')::uuid,
    memo             = p_header->>'memo',
    subtotal         = (p_header->>'subtotal')::numeric,
    tax_total        = (p_header->>'tax_total')::numeric,
    total            = (p_header->>'total')::numeric,
    balance_due      = (p_header->>'total')::numeric,
    journal_entry_id = p_new_entry_id,
    updated_at       = now()
  where id = p_bill_id;

  delete from accounting.bill_lines where bill_id = p_bill_id;
  insert into accounting.bill_lines
    (bill_id, account_id, item_id, description, quantity, unit_cost, line_total, job_id,
     source_inventory_id, class_id, location_id, department_id, po_line_id, sort_order)
  select p_bill_id,
    (l->>'account_id')::uuid, (l->>'item_id')::uuid, l->>'description',
    coalesce((l->>'quantity')::numeric, 1), coalesce((l->>'unit_cost')::numeric, 0),
    coalesce((l->>'line_total')::numeric, 0), (l->>'job_id')::uuid,
    (l->>'source_inventory_id')::uuid, (l->>'class_id')::uuid, (l->>'location_id')::uuid,
    (l->>'department_id')::uuid, (l->>'po_line_id')::uuid, coalesce((l->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l;

  if v_old_je is not null and v_old_je <> p_new_entry_id then
    perform accounting.void_journal_entry(
      v_old_je,
      'Bill ' || coalesce(v_bill.bill_number, p_bill_id::text) || ' edited in place'
    );
  end if;
end;
$function$;

revoke all on function accounting.apply_posted_invoice_edit(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function accounting.apply_posted_invoice_edit(uuid, uuid, jsonb, jsonb) to authenticated;
revoke all on function accounting.apply_posted_bill_edit(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function accounting.apply_posted_bill_edit(uuid, uuid, jsonb, jsonb) to authenticated;
