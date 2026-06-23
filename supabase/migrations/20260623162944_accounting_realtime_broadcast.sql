-- Accounting realtime via Broadcast-from-Database.
--
-- Per the project's realtime architecture, database-driven realtime uses Postgres
-- triggers + realtime.broadcast_changes() (the scalable replacement for postgres_changes).
-- Every AR/AP row change is broadcast to the single private topic 'accounting'; the
-- client (useAccountingRealtime) subscribes and invalidates the matching React Query
-- caches. The payload carries the table name so the client can target invalidation.
--
-- Authorization: 'accounting' is a PRIVATE topic gated by public.realtime_authorize()
-- (migration *_realtime_broadcast_authorization) to accounting.can_read() users only.
-- broadcast_changes() runs as the (definer) trigger owner and inserts into
-- realtime.messages bypassing RLS, so the server-side send is never blocked; the SELECT
-- policy decides who RECEIVES.
--
-- Unlike the notification emitters, this is flood-safe (a burst of broadcasts just
-- debounce-invalidates caches), so it intentionally fires for ALL rows incl. QBO-synced.
--
-- Idempotent: safe to re-run.

create or replace function accounting.broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
begin
  begin
    perform realtime.broadcast_changes(
      'accounting',      -- topic (single private channel for all accounting realtime)
      TG_OP,             -- event: INSERT | UPDATE | DELETE
      TG_OP,             -- operation
      TG_TABLE_NAME,     -- table (client routes cache invalidation off this)
      TG_TABLE_SCHEMA,   -- schema
      NEW,               -- new record
      OLD                -- old record
    );
  exception when others then
    -- Never let a realtime hiccup roll back the AR/AP write.
    raise warning 'accounting.broadcast_change failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, sqlerrm;
  end;
  return null;  -- AFTER trigger; return value ignored
end;
$$;

do $$
declare
  tbl text;
  tbls text[] := array['invoices', 'bills', 'payments', 'vendor_payments'];
begin
  foreach tbl in array tbls loop
    execute format('drop trigger if exists trg_broadcast_change on accounting.%I', tbl);
    execute format(
      'create trigger trg_broadcast_change after insert or update or delete on accounting.%I '
      'for each row execute function accounting.broadcast_change()', tbl);
  end loop;
end $$;

revoke execute on function accounting.broadcast_change() from public, anon, authenticated;
