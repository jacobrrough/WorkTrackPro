-- Google-Docs-style version history (full payloads) for sales documents.
--
-- WHY: accounting.document_timeline surfaces WHEN/WHO/WHAT-headline, and document_snapshots holds
-- the full {header, lines} of every captured version — but nothing returns those payloads to the
-- client so it can show the actual highlighted field-level CHANGES between versions. This function
-- returns each snapshot WITH its payload (+ resolved actor email), oldest→newest, plus a trailing
-- synthetic "current" entry built in the exact same shape as capture_document_snapshot — so the
-- newest edit (which is not yet snapshotted, since snapshots are captured BEFORE each save) is also
-- diffable. The client diffs each adjacent pair to render the change feed. Read-only.
--
-- Only invoices & estimates have snapshots; for any other type this returns an empty array.
--
-- EXPOSURE: the payloads are whole-row to_jsonb (same shape capture_document_snapshot already
-- stores), so this ships every column to the client even though the diff UI reads only a whitelist.
-- This is no wider than today: accounting.document_snapshots is already SELECT-able to can_read()
-- clients, so the same data is reachable. If these tables ever gain a sensitive column, narrow the
-- to_jsonb here (and reconsider the snapshots RLS) rather than relying on client-side filtering.
--
-- IDEMPOTENT. ROLLBACK: drop function if exists accounting.document_versions(text, uuid);

create or replace function accounting.document_versions(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = accounting, public, pg_catalog
as $function$
declare
  v_result   jsonb;
  v_current  jsonb;
  v_cur_at   timestamptz;
  v_cur_actor text;
begin
  if not accounting.can_read() then
    raise exception 'not authorized';
  end if;

  if p_type not in ('invoice', 'estimate') then
    return '[]'::jsonb; -- only invoices & estimates capture snapshots
  end if;

  -- Live "current" state, in the SAME shape capture_document_snapshot writes, so it diffs
  -- apples-to-apples against the newest stored snapshot.
  if p_type = 'invoice' then
    select jsonb_build_object(
             'header', to_jsonb(i),
             'lines', coalesce((
               select jsonb_agg(to_jsonb(l) order by l.sort_order)
               from accounting.invoice_lines l where l.invoice_id = p_id), '[]'::jsonb)),
           i.updated_at
      into v_current, v_cur_at
      from accounting.invoices i where i.id = p_id;
  else
    select jsonb_build_object(
             'header', to_jsonb(e),
             'lines', coalesce((
               select jsonb_agg(to_jsonb(l) order by l.sort_order)
               from accounting.estimate_lines l where l.estimate_id = p_id), '[]'::jsonb)),
           e.updated_at
      into v_current, v_cur_at
      from accounting.estimates e where e.id = p_id;
  end if;

  if v_current is null then
    return '[]'::jsonb; -- document not found
  end if;

  -- Most-recent editor of the parent row, for the live entry's attribution.
  select a.actor_email into v_cur_actor
    from accounting.audit_log a
   where a.table_name = case when p_type = 'invoice' then 'invoices' else 'estimates' end
     and a.record_id = p_id
   order by a.at desc
   limit 1;

  with v as (
    select s.id, s.created_at as at, pr.email as actor, s.kind, s.note, s.snapshot,
           false as is_current
      from accounting.document_snapshots s
      left join public.profiles pr on pr.id = s.created_by
     where s.document_type = p_type and s.document_id = p_id
    union all
    select null::uuid, v_cur_at, v_cur_actor, 'current', null::text, v_current, true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'at', v.at, 'actor', v.actor, 'kind', v.kind,
           'note', v.note, 'snapshot', v.snapshot, 'isCurrent', v.is_current
         ) order by v.at asc, v.is_current asc), '[]'::jsonb)
    into v_result from v;

  return v_result;
end;
$function$;

revoke all on function accounting.document_versions(text, uuid) from public, anon;
grant execute on function accounting.document_versions(text, uuid) to authenticated;
