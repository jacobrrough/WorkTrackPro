-- Per-document audit timeline (QuickBooks-style activity history).
--
-- WHY: accounting.audit_log already records every write (created/edited/voided, emails, payments)
-- but nothing surfaces it. This function assembles a single ordered event list for one
-- invoice/estimate/bill by unioning the audit_log (the parent row), the version snapshots, the
-- email log, and payment applications — normalized to {at, actor, kind, title, detail}. Read-only;
-- no schema change. (Per-line add/remove rows are intentionally NOT surfaced: in-place edits
-- rewrite the whole line set, so a "before edit" snapshot — which preserves full line detail for
-- diff/restore — is the per-edit marker instead of a burst of line events.)
--
-- IDEMPOTENT. ROLLBACK: drop function if exists accounting.document_timeline(text, uuid);

create or replace function accounting.document_timeline(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_parent text;
  v_cur    text;
  v_result jsonb;
  -- System/sync fields that are not user-meaningful edits (payments + send bookkeeping are shown
  -- as their own events), so a parent UPDATE touching ONLY these is not rendered as "Edited".
  v_noise  text[] := array['updated_at','amount_paid','balance_due','journal_entry_id',
                           'last_sent_at','last_sent_hash','last_sent_snapshot_id','sent_count',
                           'accepted_at','converted_invoice_id'];
begin
  if not accounting.can_read() then
    raise exception 'not authorized';
  end if;
  if p_type = 'invoice' then
    v_parent := 'invoices';
  elsif p_type = 'estimate' then
    v_parent := 'estimates';
  elsif p_type = 'bill' then
    v_parent := 'bills';
  else
    raise exception 'unknown document type %', p_type;
  end if;

  if p_type in ('invoice', 'estimate') then
    v_cur := accounting.document_content_hash(p_type, p_id);
  end if;

  with ev as (
    -- Parent lifecycle: created / status change / meaningful edit / deleted.
    select a.at,
           a.actor_email as actor,
           case when a.action = 'INSERT' then 'created'
                when a.action = 'DELETE' then 'deleted'
                when 'status' = any(a.changed_fields) then 'status'
                else 'edited' end as kind,
           case when a.action = 'INSERT' then 'Created'
                when a.action = 'DELETE' then 'Deleted'
                when 'status' = any(a.changed_fields) then 'Status → ' || coalesce(a.after_data->>'status', '?')
                else 'Edited' end as title,
           case when a.action = 'UPDATE' then nullif(array_to_string(
                    array(select f from unnest(a.changed_fields) f where f <> all(v_noise)), ', '), '')
                else null end as detail
      from accounting.audit_log a
     where a.table_name = v_parent
       and a.record_id = p_id
       and (
         a.action in ('INSERT', 'DELETE')
         or 'status' = any(a.changed_fields)
         or exists (select 1 from unnest(a.changed_fields) f where f <> all(v_noise))
       )
    union all
    -- Version snapshots (invoice & estimate only).
    select s.created_at, pr.email,
           'version',
           case when s.kind = 'sent' then 'Sent copy captured'
                when s.kind = 'before_restore' then 'Version saved (before restore)'
                when s.note is not null then 'Version saved (' || s.note || ')'
                else 'Version saved' end,
           null
      from accounting.document_snapshots s
      left join public.profiles pr on pr.id = s.created_by
     where p_type in ('invoice', 'estimate')
       and s.document_type = p_type and s.document_id = p_id
    union all
    -- Email log (invoice only); flag whether the emailed copy matches the live version.
    select em.created_at, pr.email,
           'email',
           'Emailed to ' || em.to_email || ' (' || em.status || ')',
           case when em.content_hash is not null and v_cur is not null
                  then case when em.content_hash = v_cur then 'current version' else 'older copy' end
                else em.subject end
      from accounting.invoice_emails em
      left join public.profiles pr on pr.id = em.created_by
     where p_type = 'invoice' and em.invoice_id = p_id
    union all
    -- Customer payments applied (invoice).
    select a.at, a.actor_email, 'payment', 'Payment applied', a.after_data->>'amount_applied'
      from accounting.audit_log a
     where p_type = 'invoice' and a.table_name = 'payment_applications'
       and a.action = 'INSERT' and a.after_data->>'invoice_id' = p_id::text
    union all
    -- Vendor payments applied (bill).
    select a.at, a.actor_email, 'payment', 'Vendor payment applied', a.after_data->>'amount_applied'
      from accounting.audit_log a
     where p_type = 'bill' and a.table_name = 'vendor_payment_applications'
       and a.action = 'INSERT' and a.after_data->>'bill_id' = p_id::text
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', ev.at, 'actor', ev.actor, 'kind', ev.kind, 'title', ev.title, 'detail', ev.detail
         ) order by ev.at desc), '[]'::jsonb)
    into v_result from ev;

  return v_result;
end;
$function$;

revoke all on function accounting.document_timeline(text, uuid) from public, anon;
grant execute on function accounting.document_timeline(text, uuid) to authenticated;
