-- Sent-version tracking for customer-facing documents (invoices & estimates).
--
-- WHY: there is no way to tell whether the copy a customer holds matches what's on screen. We
-- capture a deterministic content hash of the document at send time and compare it to the live
-- content, so the UI can show "customer has the current version" vs "edited since last sent".
-- The exact bytes that were sent are pinned as a kind='sent' snapshot (permanent, see
-- 20260623120000) so the audit timeline can re-open "what we sent".
--
-- IDEMPOTENT. ROLLBACK:
--   drop function if exists accounting.document_sent_state(text, uuid);
--   drop function if exists accounting.record_document_sent(text, uuid);
--   drop function if exists accounting.document_content_hash(text, uuid);
--   alter table accounting.invoices  drop column if exists last_sent_at, drop column if exists last_sent_hash,
--     drop column if exists last_sent_snapshot_id, drop column if exists sent_count;
--   alter table accounting.estimates drop column if exists last_sent_at, drop column if exists last_sent_hash,
--     drop column if exists last_sent_snapshot_id, drop column if exists sent_count;
--   alter table accounting.invoice_emails drop column if exists content_hash, drop column if exists snapshot_id;

alter table accounting.invoices
  add column if not exists last_sent_at          timestamptz,
  add column if not exists last_sent_hash        text,
  add column if not exists last_sent_snapshot_id uuid,
  add column if not exists sent_count            int not null default 0;

alter table accounting.estimates
  add column if not exists last_sent_at          timestamptz,
  add column if not exists last_sent_hash        text,
  add column if not exists last_sent_snapshot_id uuid,
  add column if not exists sent_count            int not null default 0;

-- Record exactly what content each email carried, so the timeline can flag "current vs older copy".
alter table accounting.invoice_emails
  add column if not exists content_hash text,
  add column if not exists snapshot_id  uuid;

-- Deterministic content hash of a document's customer-facing fields + ordered lines. Excludes
-- volatile/internal fields (status, journal_entry_id, balance_due, amount_paid, updated_at) so the
-- hash only changes when the *content* the customer sees changes. jsonb text output is canonical
-- (keys sorted), so this is stable across calls.
create or replace function accounting.document_content_hash(p_type text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_header jsonb;
  v_lines  jsonb;
begin
  if not accounting.can_read() then
    raise exception 'not authorized';
  end if;
  if p_type = 'invoice' then
    select jsonb_build_object(
             'customer_id', i.customer_id, 'invoice_date', i.invoice_date, 'due_date', i.due_date,
             'terms', i.terms, 'memo', i.memo, 'notes', i.notes,
             'subtotal', i.subtotal, 'discount_total', i.discount_total, 'tax_total', i.tax_total,
             'total', i.total, 'tax_code_id', i.tax_code_id)
      into v_header from accounting.invoices i where i.id = p_id;
    if v_header is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', l.item_id, 'part_id', l.part_id, 'description', l.description,
             'quantity', l.quantity, 'unit_price', l.unit_price, 'line_total', l.line_total,
             'discount', l.discount, 'tax_code_id', l.tax_code_id, 'taxable', l.taxable,
             'income_account_id', l.income_account_id, 'job_id', l.job_id,
             'class_id', l.class_id, 'location_id', l.location_id, 'department_id', l.department_id)
             order by l.sort_order), '[]'::jsonb)
      into v_lines from accounting.invoice_lines l where l.invoice_id = p_id;
  elsif p_type = 'estimate' then
    select jsonb_build_object(
             'customer_id', e.customer_id, 'estimate_date', e.estimate_date, 'expiry_date', e.expiry_date,
             'terms', e.terms, 'memo', e.memo, 'notes', e.notes,
             'subtotal', e.subtotal, 'discount_total', e.discount_total, 'tax_total', e.tax_total,
             'total', e.total, 'tax_code_id', e.tax_code_id)
      into v_header from accounting.estimates e where e.id = p_id;
    if v_header is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', l.item_id, 'part_id', l.part_id, 'description', l.description,
             'quantity', l.quantity, 'unit_price', l.unit_price, 'line_total', l.line_total,
             'discount', l.discount, 'tax_code_id', l.tax_code_id, 'taxable', l.taxable,
             'income_account_id', l.income_account_id, 'job_id', l.job_id,
             'class_id', l.class_id, 'location_id', l.location_id, 'department_id', l.department_id)
             order by l.sort_order), '[]'::jsonb)
      into v_lines from accounting.estimate_lines l where l.estimate_id = p_id;
  else
    raise exception 'unknown document type %', p_type;
  end if;
  return md5(v_header::text || '|' || v_lines::text);
end;
$function$;

-- Stamp a document as sent: pin a 'sent' snapshot, store the content hash, bump the counter.
-- Returns the pinned snapshot id (so the email row can reference exactly what was sent).
create or replace function accounting.record_document_sent(p_type text, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_hash text;
  v_snap uuid;
begin
  if not accounting.can_write() then
    raise exception 'not authorized';
  end if;
  v_hash := accounting.document_content_hash(p_type, p_id);
  if v_hash is null then
    return null; -- document not found
  end if;
  v_snap := accounting.capture_document_snapshot(p_type, p_id, 'sent', 'sent');
  if p_type = 'invoice' then
    update accounting.invoices set
      last_sent_at = now(), last_sent_hash = v_hash, last_sent_snapshot_id = v_snap,
      sent_count = coalesce(sent_count, 0) + 1, updated_at = now()
    where id = p_id;
  elsif p_type = 'estimate' then
    update accounting.estimates set
      last_sent_at = now(), last_sent_hash = v_hash, last_sent_snapshot_id = v_snap,
      sent_count = coalesce(sent_count, 0) + 1, updated_at = now()
    where id = p_id;
  else
    raise exception 'unknown document type %', p_type;
  end if;
  return v_snap;
end;
$function$;

-- Compute the send state for the badge: has it been sent, and does the customer hold the current
-- version? Returns null when the document doesn't exist.
create or replace function accounting.document_sent_state(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_cur   text;
  v_sent  text;
  v_at    timestamptz;
  v_count int;
  v_snap  uuid;
begin
  if not accounting.can_read() then
    raise exception 'not authorized';
  end if;
  v_cur := accounting.document_content_hash(p_type, p_id);
  if v_cur is null then
    return null;
  end if;
  if p_type = 'invoice' then
    select last_sent_hash, last_sent_at, sent_count, last_sent_snapshot_id
      into v_sent, v_at, v_count, v_snap from accounting.invoices where id = p_id;
  elsif p_type = 'estimate' then
    select last_sent_hash, last_sent_at, sent_count, last_sent_snapshot_id
      into v_sent, v_at, v_count, v_snap from accounting.estimates where id = p_id;
  else
    raise exception 'unknown document type %', p_type;
  end if;
  return jsonb_build_object(
    'issued', v_at is not null,
    'isCurrent', v_at is not null and (v_sent is not distinct from v_cur),
    'lastSentAt', v_at,
    'sentCount', coalesce(v_count, 0),
    'lastSentSnapshotId', v_snap,
    'currentHash', v_cur,
    'lastSentHash', v_sent
  );
end;
$function$;

revoke all on function accounting.document_content_hash(text, uuid) from public, anon;
grant execute on function accounting.document_content_hash(text, uuid) to authenticated;
revoke all on function accounting.record_document_sent(text, uuid) from public, anon;
grant execute on function accounting.record_document_sent(text, uuid) to authenticated, service_role;
revoke all on function accounting.document_sent_state(text, uuid) from public, anon;
grant execute on function accounting.document_sent_state(text, uuid) to authenticated;
