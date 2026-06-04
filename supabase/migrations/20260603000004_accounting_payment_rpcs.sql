-- Atomic payment recording (closes the orphan-JE-on-crash window in payments.ts /
-- vendorPayments.ts). Each RPC inserts the payment header, the draft receipt/disbursement
-- journal entry + its lines, POSTS the entry, inserts the applications, and links the JE —
-- all in ONE transaction. A failure anywhere (unbalanced entry via guard_journal_entry, an
-- over-application via sync_invoice_payment / sync_bill_payment, or a hard client crash)
-- rolls the WHOLE thing back, so a posted JE can never be left without its applications.
--
-- The CLIENT still builds the balanced JE lines (posting.ts buildPayment*JournalLines), so
-- no financial logic is duplicated in SQL — these functions only provide atomicity. They
-- reuse accounting.post_journal_entry (same permission + balance guards).
--
-- NOTE: the accounting schema is flag-dark (not deployed to production). This migration
-- sorts after every accounting migration, so it applies when the module ships.

create or replace function accounting.record_customer_payment(
  p_customer_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_deposit_account_id uuid,
  p_memo text,
  p_je_date date,
  p_je_memo text,
  p_lines jsonb,
  p_applications jsonb
) returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_payment_id uuid;
  v_entry_id uuid;
  v_line jsonb;
  v_app jsonb;
  v_i int := 0;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to record a payment' using errcode = 'insufficient_privilege';
  end if;

  insert into accounting.payments (
    customer_id, payment_date, amount, method, reference, deposit_account_id,
    unapplied_amount, memo, created_by
  ) values (
    p_customer_id, p_payment_date, p_amount, coalesce(p_method, 'other'), p_reference,
    p_deposit_account_id, p_amount, p_memo, auth.uid()
  ) returning id into v_payment_id;

  insert into accounting.journal_entries (entry_date, memo, source_type, source_id)
  values (p_je_date, p_je_memo, 'payment', v_payment_id)
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into accounting.journal_lines (
      journal_entry_id, account_id, debit, credit, line_memo,
      job_id, customer_id, vendor_id, class_id, location_id, department_id, sort_order
    ) values (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'line_memo',
      nullif(v_line->>'job_id', '')::uuid,
      nullif(v_line->>'customer_id', '')::uuid,
      nullif(v_line->>'vendor_id', '')::uuid,
      nullif(v_line->>'class_id', '')::uuid,
      nullif(v_line->>'location_id', '')::uuid,
      nullif(v_line->>'department_id', '')::uuid,
      v_i
    );
    v_i := v_i + 1;
  end loop;

  -- Post (balance + >=2 lines enforced by guard_journal_entry on the draft->posted transition).
  perform accounting.post_journal_entry(v_entry_id);
  update accounting.payments set journal_entry_id = v_entry_id where id = v_payment_id;

  -- Applications (sync_invoice_payment rolls invoice balances + unapplied; rejects over-application).
  for v_app in select * from jsonb_array_elements(p_applications) loop
    insert into accounting.payment_applications (payment_id, invoice_id, amount_applied)
    values (v_payment_id, (v_app->>'invoice_id')::uuid, (v_app->>'amount_applied')::numeric);
  end loop;

  return v_payment_id;
end;
$$;

create or replace function accounting.record_vendor_payment(
  p_vendor_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_pay_from_account_id uuid,
  p_memo text,
  p_je_date date,
  p_je_memo text,
  p_lines jsonb,
  p_applications jsonb
) returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_payment_id uuid;
  v_entry_id uuid;
  v_line jsonb;
  v_app jsonb;
  v_i int := 0;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to record a payment' using errcode = 'insufficient_privilege';
  end if;

  insert into accounting.vendor_payments (
    vendor_id, payment_date, amount, method, reference, pay_from_account_id,
    unapplied_amount, memo, created_by
  ) values (
    p_vendor_id, p_payment_date, p_amount, coalesce(p_method, 'other'), p_reference,
    p_pay_from_account_id, p_amount, p_memo, auth.uid()
  ) returning id into v_payment_id;

  insert into accounting.journal_entries (entry_date, memo, source_type, source_id)
  values (p_je_date, p_je_memo, 'vendor_payment', v_payment_id)
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into accounting.journal_lines (
      journal_entry_id, account_id, debit, credit, line_memo,
      job_id, customer_id, vendor_id, class_id, location_id, department_id, sort_order
    ) values (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'line_memo',
      nullif(v_line->>'job_id', '')::uuid,
      nullif(v_line->>'customer_id', '')::uuid,
      nullif(v_line->>'vendor_id', '')::uuid,
      nullif(v_line->>'class_id', '')::uuid,
      nullif(v_line->>'location_id', '')::uuid,
      nullif(v_line->>'department_id', '')::uuid,
      v_i
    );
    v_i := v_i + 1;
  end loop;

  perform accounting.post_journal_entry(v_entry_id);
  update accounting.vendor_payments set journal_entry_id = v_entry_id where id = v_payment_id;

  -- Applications (sync_bill_payment rolls bill balances + unapplied; rejects over-application).
  for v_app in select * from jsonb_array_elements(p_applications) loop
    insert into accounting.vendor_payment_applications (vendor_payment_id, bill_id, amount_applied)
    values (v_payment_id, (v_app->>'bill_id')::uuid, (v_app->>'amount_applied')::numeric);
  end loop;

  return v_payment_id;
end;
$$;

grant execute on function accounting.record_customer_payment(uuid,date,numeric,text,text,uuid,text,date,text,jsonb,jsonb) to authenticated;
grant execute on function accounting.record_vendor_payment(uuid,date,numeric,text,text,uuid,text,date,text,jsonb,jsonb) to authenticated;
