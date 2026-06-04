-- WorkTrackAccounting — Foundation 2/11: lightweight audit trail
--
-- A generic AFTER trigger writes an immutable-by-convention audit row for every
-- write to an accounting table. The trigger is SECURITY DEFINER so it can insert
-- into audit_log while authenticated users have NO write policy on it (append-only
-- from the app). Hash-chain columns (prev_hash/row_hash/chain_seq) are present but
-- left NULL — the tamper-evident upgrade plugs into accounting.audit() later with
-- zero schema change.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.audit() CASCADE;  -- drops attached triggers
--   DROP TABLE IF EXISTS accounting.audit_log;

create table if not exists accounting.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  -- actor_id is a plain uuid (NO foreign key) on purpose: the audit row must never
  -- fail to write because of a missing/edge-case profile row and thereby abort the
  -- real transaction. actor_email is a durable snapshot.
  actor_id uuid,
  actor_email text,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[],
  -- tamper-evident hash-chain placeholders (deferred; NULL in Phase 1)
  prev_hash text,
  row_hash text,
  chain_seq bigint,
  at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_accounting_audit_record') then
    create index idx_accounting_audit_record on accounting.audit_log(table_name, record_id);
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_accounting_audit_at') then
    create index idx_accounting_audit_at on accounting.audit_log(at desc);
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'accounting' and indexname = 'idx_accounting_audit_actor') then
    create index idx_accounting_audit_actor on accounting.audit_log(actor_id);
  end if;
end $$;

-- Generic audit trigger. Attach to each accounting table with:
--   create trigger audit_<table> after insert or update or delete
--     on accounting.<table> for each row execute function accounting.audit();
create or replace function accounting.audit()
returns trigger
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_record_id uuid;
begin
  if v_actor is not null then
    select p.email into v_email from public.profiles p where p.id = v_actor;
  end if;

  if (tg_op = 'DELETE') then
    v_before := to_jsonb(old);
    v_after := null;
  elsif (tg_op = 'UPDATE') then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    select array_agg(b.key order by b.key)
      into v_changed
      from jsonb_each(v_before) b
     where b.value is distinct from (v_after -> b.key);
  else -- INSERT
    v_before := null;
    v_after := to_jsonb(new);
  end if;

  v_record_id := nullif(coalesce(v_after ->> 'id', v_before ->> 'id'), '')::uuid;

  insert into accounting.audit_log
    (table_name, record_id, action, actor_id, actor_email, before_data, after_data, changed_fields)
  values
    (tg_table_name, v_record_id, tg_op, v_actor, v_email, v_before, v_after, v_changed);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- RLS: readable by any accounting role; NO authenticated write policy — only the
-- SECURITY DEFINER trigger above (running as owner) may insert. This makes the log
-- append-only from the application's perspective.
alter table accounting.audit_log enable row level security;

drop policy if exists "acct audit read" on accounting.audit_log;
create policy "acct audit read" on accounting.audit_log
  for select to authenticated using (accounting.can_read());

grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
