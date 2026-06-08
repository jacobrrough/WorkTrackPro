-- Lock the parent invoice/bill header before summing applications so two
-- concurrent inserts into (vendor_)payment_applications cannot both pass the
-- over-application guard and over-apply (amount_paid > total, negative balance).
-- Faithful reproduction of the originals; only a FOR UPDATE lock is added before
-- the sum/compare in each header path.

-- accounting.sync_invoice_payment originally defined in
-- 20260603164151_accounting_sales.sql.
create or replace function accounting.sync_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_payment uuid := coalesce(new.payment_id, old.payment_id);
  v_inv_total numeric(14,2);
  v_paid numeric(14,2);
  v_pay_amount numeric(14,2);
  v_applied numeric(14,2);
begin
  if v_invoice is not null then
    -- Serialize concurrent applications against the same invoice.
    perform 1 from accounting.invoices where id = v_invoice for update;
    select total into v_inv_total from accounting.invoices where id = v_invoice;
    if found then
      select coalesce(sum(amount_applied), 0) into v_paid
        from accounting.payment_applications where invoice_id = v_invoice;
      if v_paid > v_inv_total then
        raise exception 'payments applied (%) exceed invoice % total (%)', v_paid, v_invoice, v_inv_total
          using errcode = 'check_violation';
      end if;
      update accounting.invoices
         set amount_paid = v_paid,
             balance_due = v_inv_total - v_paid,
             status = case
                        when status = 'void' then status
                        when v_inv_total > 0 and v_paid >= v_inv_total then 'paid'
                        when v_paid > 0 then 'partially_paid'
                        when status in ('paid', 'partially_paid') then 'sent'
                        else status
                      end
       where id = v_invoice;
    end if;
  end if;

  if v_payment is not null then
    select amount into v_pay_amount from accounting.payments where id = v_payment;
    if found then
      select coalesce(sum(amount_applied), 0) into v_applied
        from accounting.payment_applications where payment_id = v_payment;
      if v_applied > v_pay_amount then
        raise exception 'applied amount (%) exceeds payment % (%)', v_applied, v_payment, v_pay_amount
          using errcode = 'check_violation';
      end if;
      update accounting.payments set unapplied_amount = v_pay_amount - v_applied where id = v_payment;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- accounting.sync_bill_payment originally defined in
-- 20260603164225_accounting_purchases.sql.
create or replace function accounting.sync_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_bill uuid := coalesce(new.bill_id, old.bill_id);
  v_payment uuid := coalesce(new.vendor_payment_id, old.vendor_payment_id);
  v_bill_total numeric(14,2);
  v_paid numeric(14,2);
  v_pay_amount numeric(14,2);
  v_applied numeric(14,2);
begin
  if v_bill is not null then
    -- Serialize concurrent applications against the same bill.
    perform 1 from accounting.bills where id = v_bill for update;
    select total into v_bill_total from accounting.bills where id = v_bill;
    if found then
      select coalesce(sum(amount_applied), 0) into v_paid
        from accounting.vendor_payment_applications where bill_id = v_bill;
      if v_paid > v_bill_total then
        raise exception 'payments applied (%) exceed bill % total (%)', v_paid, v_bill, v_bill_total
          using errcode = 'check_violation';
      end if;
      update accounting.bills
         set amount_paid = v_paid,
             balance_due = v_bill_total - v_paid,
             status = case
                        when status = 'void' then status
                        when v_bill_total > 0 and v_paid >= v_bill_total then 'paid'
                        when v_paid > 0 then 'partially_paid'
                        when status in ('paid', 'partially_paid') then 'open'
                        else status
                      end
       where id = v_bill;
    end if;
  end if;

  if v_payment is not null then
    select amount into v_pay_amount from accounting.vendor_payments where id = v_payment;
    if found then
      select coalesce(sum(amount_applied), 0) into v_applied
        from accounting.vendor_payment_applications where vendor_payment_id = v_payment;
      if v_applied > v_pay_amount then
        raise exception 'applied amount (%) exceeds vendor payment % (%)', v_applied, v_payment, v_pay_amount
          using errcode = 'check_violation';
      end if;
      update accounting.vendor_payments set unapplied_amount = v_pay_amount - v_applied where id = v_payment;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
