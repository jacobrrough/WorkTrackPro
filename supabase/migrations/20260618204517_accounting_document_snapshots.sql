-- Document version history + restore for sales documents (invoices & estimates).
--
-- WHY: draft edits overwrite the header + replace all lines, and the audit_log records those as
-- separate non-atomic statements (different `at`), so reconstructing a prior version from audit
-- deltas is unreliable. Instead we capture an explicit, full snapshot (header + lines) of the
-- CURRENT state right before each draft save; "restore" re-applies a chosen snapshot atomically.
--
-- SAFETY: restore only ever touches a document that is still 'draft' (no posted journal entry),
-- so a restore can never alter the ledger; a bad restore only affects an editable draft. The
-- write RPCs are SECURITY DEFINER and guarded by accounting.can_write() (which now also requires
-- an aal2/MFA session). The snapshot table is read-only to clients (writes go through the RPCs).
--
-- IDEMPOTENT. ROLLBACK:
--   drop function if exists accounting.restore_document_snapshot(uuid);
--   drop function if exists accounting.capture_document_snapshot(text, uuid, text);
--   drop table if exists accounting.document_snapshots;

create table if not exists accounting.document_snapshots (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('invoice', 'estimate')),
  document_id uuid not null,
  snapshot jsonb not null, -- { "header": {...}, "lines": [...] }
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_doc_snapshots_doc
  on accounting.document_snapshots (document_type, document_id, created_at desc);

alter table accounting.document_snapshots enable row level security;
drop policy if exists "doc snapshots read" on accounting.document_snapshots;
create policy "doc snapshots read" on accounting.document_snapshots
  for select to authenticated using (accounting.can_read());
-- No client write policy: snapshots are written only by the SECURITY DEFINER RPCs below
-- (mirrors accounting.audit_log's append-only-by-trigger posture).

-- Capture a full snapshot of one sales document's current state. Returns the snapshot id.
-- Keeps at most the 20 most-recent snapshots per document (prune the tail).
create or replace function accounting.capture_document_snapshot(
  p_type text, p_id uuid, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_snapshot jsonb;
  v_id uuid;
begin
  if not accounting.can_write() then
    raise exception 'not authorized';
  end if;
  if p_type = 'invoice' then
    select jsonb_build_object(
             'header', to_jsonb(i),
             'lines', coalesce((
               select jsonb_agg(to_jsonb(l) order by l.sort_order)
               from accounting.invoice_lines l where l.invoice_id = p_id), '[]'::jsonb))
      into v_snapshot
      from accounting.invoices i where i.id = p_id;
  elsif p_type = 'estimate' then
    select jsonb_build_object(
             'header', to_jsonb(e),
             'lines', coalesce((
               select jsonb_agg(to_jsonb(l) order by l.sort_order)
               from accounting.estimate_lines l where l.estimate_id = p_id), '[]'::jsonb))
      into v_snapshot
      from accounting.estimates e where e.id = p_id;
  else
    raise exception 'unknown document type %', p_type;
  end if;

  if v_snapshot is null then
    return null; -- document not found; nothing to snapshot
  end if;

  insert into accounting.document_snapshots (document_type, document_id, snapshot, note, created_by)
  values (p_type, p_id, v_snapshot, p_note, auth.uid())
  returning id into v_id;

  -- Prune to the 20 most recent per document.
  delete from accounting.document_snapshots d
   where d.document_type = p_type and d.document_id = p_id
     and d.id not in (
       select s.id from accounting.document_snapshots s
        where s.document_type = p_type and s.document_id = p_id
        order by s.created_at desc limit 20);

  return v_id;
end;
$function$;

-- Restore a sales document to a chosen snapshot. Only a DRAFT document can be restored (a
-- posted invoice has a journal entry and must be corrected via void & reissue). A pre-restore
-- snapshot of the current state is captured first so the restore itself can be undone.
create or replace function accounting.restore_document_snapshot(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_type text;
  v_doc  uuid;
  v_snap jsonb;
  v_h    jsonb;
  v_status text;
begin
  if not accounting.can_write() then
    raise exception 'not authorized';
  end if;

  select document_type, document_id, snapshot
    into v_type, v_doc, v_snap
    from accounting.document_snapshots where id = p_snapshot_id;
  if v_type is null then
    raise exception 'snapshot not found';
  end if;
  v_h := v_snap -> 'header';

  if v_type = 'invoice' then
    select status into v_status from accounting.invoices where id = v_doc for update;
    if v_status is null then raise exception 'invoice not found'; end if;
    if v_status <> 'draft' then
      raise exception 'only draft invoices can be restored (this one is %)', v_status;
    end if;
    perform accounting.capture_document_snapshot('invoice', v_doc, 'before restore');

    update accounting.invoices set
      customer_id    = (v_h->>'customer_id')::uuid,
      job_id         = (v_h->>'job_id')::uuid,
      invoice_date   = (v_h->>'invoice_date')::date,
      due_date       = (v_h->>'due_date')::date,
      terms          = v_h->>'terms',
      tax_code_id    = (v_h->>'tax_code_id')::uuid,
      memo           = v_h->>'memo',
      notes          = v_h->>'notes',
      subtotal       = (v_h->>'subtotal')::numeric,
      discount_total = (v_h->>'discount_total')::numeric,
      tax_total      = (v_h->>'tax_total')::numeric,
      total          = (v_h->>'total')::numeric,
      balance_due    = (v_h->>'total')::numeric,
      layout         = v_h->'layout'
    where id = v_doc;

    delete from accounting.invoice_lines where invoice_id = v_doc;
    insert into accounting.invoice_lines
      (invoice_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
       tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order)
    select v_doc,
      (l->>'item_id')::uuid, (l->>'part_id')::uuid, l->>'description',
      (l->>'quantity')::numeric, (l->>'unit_price')::numeric, (l->>'line_total')::numeric,
      (l->>'discount')::numeric, (l->>'tax_code_id')::uuid, (l->>'taxable')::boolean,
      (l->>'income_account_id')::uuid, (l->>'job_id')::uuid,
      (l->>'class_id')::uuid, (l->>'location_id')::uuid, (l->>'department_id')::uuid,
      coalesce((l->>'sort_order')::int, 0)
    from jsonb_array_elements(coalesce(v_snap->'lines', '[]'::jsonb)) as l;

  elsif v_type = 'estimate' then
    select status into v_status from accounting.estimates where id = v_doc for update;
    if v_status is null then raise exception 'estimate not found'; end if;
    if v_status <> 'draft' then
      raise exception 'only draft estimates can be restored (this one is %)', v_status;
    end if;
    perform accounting.capture_document_snapshot('estimate', v_doc, 'before restore');

    update accounting.estimates set
      customer_id    = (v_h->>'customer_id')::uuid,
      job_id         = (v_h->>'job_id')::uuid,
      estimate_date  = (v_h->>'estimate_date')::date,
      expiry_date    = (v_h->>'expiry_date')::date,
      terms          = v_h->>'terms',
      tax_code_id    = (v_h->>'tax_code_id')::uuid,
      memo           = v_h->>'memo',
      notes          = v_h->>'notes',
      subtotal       = (v_h->>'subtotal')::numeric,
      discount_total = (v_h->>'discount_total')::numeric,
      tax_total      = (v_h->>'tax_total')::numeric,
      total          = (v_h->>'total')::numeric,
      layout         = v_h->'layout'
    where id = v_doc;

    delete from accounting.estimate_lines where estimate_id = v_doc;
    insert into accounting.estimate_lines
      (estimate_id, item_id, part_id, description, quantity, unit_price, line_total, discount,
       tax_code_id, taxable, income_account_id, job_id, class_id, location_id, department_id, sort_order)
    select v_doc,
      (l->>'item_id')::uuid, (l->>'part_id')::uuid, l->>'description',
      (l->>'quantity')::numeric, (l->>'unit_price')::numeric, (l->>'line_total')::numeric,
      (l->>'discount')::numeric, (l->>'tax_code_id')::uuid, (l->>'taxable')::boolean,
      (l->>'income_account_id')::uuid, (l->>'job_id')::uuid,
      (l->>'class_id')::uuid, (l->>'location_id')::uuid, (l->>'department_id')::uuid,
      coalesce((l->>'sort_order')::int, 0)
    from jsonb_array_elements(coalesce(v_snap->'lines', '[]'::jsonb)) as l;
  else
    raise exception 'unknown document type %', v_type;
  end if;
end;
$function$;

revoke all on function accounting.capture_document_snapshot(text, uuid, text) from public, anon;
grant execute on function accounting.capture_document_snapshot(text, uuid, text) to authenticated;
revoke all on function accounting.restore_document_snapshot(uuid) from public, anon;
grant execute on function accounting.restore_document_snapshot(uuid) to authenticated;
