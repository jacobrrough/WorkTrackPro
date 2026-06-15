-- Unified jobs ↔ billing — bridge an inbound lead (customer_proposal) to a customer
--
-- accounting.ensure_customer_from_proposal(p_proposal_id) creates (or adopts) the
-- accounting.customers row for one public.customer_proposals lead, and links the
-- lead's job (customer_proposals.linked_job_id → jobs.customer_id) when that job has
-- no customer yet. ON-DEMAND by design: the live proposals include duplicate
-- submissions (one person, many test leads), so nothing bridges in bulk — a human
-- triggers it per lead from the UI.
--
-- IDEMPOTENT + DEDUPING:
--   1. A customer already carrying source_proposal_id = p → reused as-is.
--   2. Else an existing customer with the same email (lower/trim) → adopted: the
--      backlink is stamped ONLY if it has none; no editable field is overwritten.
--   3. Else same display name (lower/trim) → adopted the same way.
--   4. Else a new customer is created from the lead's contact fields.
--   Then the linked job's customer_id is set ONLY when currently NULL.
--
-- SECURITY: SECURITY DEFINER + pinned search_path + accounting.can_write() guard
-- (mirrors convert_estimate_to_invoice). The jobs update needs definer rights only
-- to set a previously-NULL customer_id; the helper is NOT directly executable.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.ensure_customer_from_proposal(uuid);
--   DROP FUNCTION IF EXISTS accounting._maybe_link_job_to_customer(uuid, uuid);
--   -- data undo (safe while bridged customers have no documents):
--   --   update public.jobs set customer_id = null
--   --    where customer_id in (select id from accounting.customers where source_proposal_id is not null);
--   --   delete from accounting.customers c
--   --    where c.source_proposal_id is not null
--   --      and not exists (select 1 from accounting.invoices  i where i.customer_id = c.id)
--   --      and not exists (select 1 from accounting.estimates e where e.customer_id = c.id)
--   --      and not exists (select 1 from accounting.payments  p where p.customer_id = c.id);

-- Set a job's customer ONLY when it has none (never overwrites a human choice).
create or replace function accounting._maybe_link_job_to_customer(p_job_id uuid, p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
begin
  if p_job_id is null or p_customer_id is null then
    return;
  end if;
  update public.jobs
     set customer_id = p_customer_id
   where id = p_job_id and customer_id is null;
end;
$$;

revoke execute on function accounting._maybe_link_job_to_customer(uuid, uuid) from public, anon, authenticated;

create or replace function accounting.ensure_customer_from_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_proposal public.customer_proposals%rowtype;
  v_customer_id uuid;
begin
  if not accounting.can_write() then
    raise exception 'insufficient privileges to create customers' using errcode = 'insufficient_privilege';
  end if;

  select * into v_proposal from public.customer_proposals where id = p_proposal_id;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'no_data_found';
  end if;

  -- 1) Already bridged: reuse.
  select id into v_customer_id
    from accounting.customers
   where source_proposal_id = p_proposal_id
   limit 1;

  -- 2) Adopt by email (the lead form requires one), only stamping a free backlink.
  if v_customer_id is null and nullif(btrim(v_proposal.email), '') is not null then
    select id into v_customer_id
      from accounting.customers
     where email is not null
       and lower(btrim(email)) = lower(btrim(v_proposal.email))
     order by (source_proposal_id is null) desc, created_at
     limit 1;
  end if;

  -- 3) Adopt by display name.
  if v_customer_id is null and nullif(btrim(v_proposal.contact_name), '') is not null then
    select id into v_customer_id
      from accounting.customers
     where lower(btrim(display_name)) = lower(btrim(v_proposal.contact_name))
     order by (source_proposal_id is null) desc, created_at
     limit 1;
  end if;

  if v_customer_id is not null then
    -- Stamp the backlink only where it is free; never rewrite contact fields.
    update accounting.customers
       set source_proposal_id = p_proposal_id
     where id = v_customer_id and source_proposal_id is null;
  else
    -- 4) Create a fresh customer from the lead.
    insert into accounting.customers (
      display_name, contact_name, email, phone, notes, source_proposal_id, created_by
    ) values (
      coalesce(nullif(btrim(v_proposal.contact_name), ''), 'Proposal ' || v_proposal.submission_id),
      nullif(btrim(v_proposal.contact_name), ''),
      nullif(btrim(v_proposal.email), ''),
      nullif(btrim(v_proposal.phone), ''),
      'Created from customer proposal ' || v_proposal.submission_id,
      p_proposal_id,
      auth.uid()
    ) returning id into v_customer_id;
  end if;

  -- Link the lead's job when it has no customer yet.
  perform accounting._maybe_link_job_to_customer(v_proposal.linked_job_id, v_customer_id);

  return v_customer_id;
end;
$$;

grant execute on function accounting.ensure_customer_from_proposal(uuid) to authenticated;
revoke execute on function accounting.ensure_customer_from_proposal(uuid) from anon;
