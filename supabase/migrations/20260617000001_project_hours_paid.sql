-- Project Hours: payment lifecycle. Adds paid_at to entries (NULL = owed, set = settled)
-- and a trigger that locks a settled entry — it can be unmarked, but its hours/date/note
-- cannot be edited and it cannot be deleted while paid. This protects pay records once
-- money has changed hands. IDEMPOTENT.

alter table public.project_hour_entries
  add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_project_hour_entries_paid') then
    create index idx_project_hour_entries_paid on public.project_hour_entries(paid_at);
  end if;
end $$;

-- Lock the substance of a paid entry. Marking/unmarking paid (toggling paid_at) is allowed;
-- changing hours/entry_date/note/rate/project_id or deleting a paid row is blocked.
create or replace function public.enforce_paid_entry_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Service-role / server contexts (no auth.uid()) are trusted.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.paid_at is not null then
      raise exception 'project_hour_entries: a paid entry is locked; unmark it before deleting';
    end if;
    return old;
  end if;

  -- UPDATE: when already paid, only the paid_at flag itself may change.
  if old.paid_at is not null then
    if new.hours is distinct from old.hours
       or new.entry_date is distinct from old.entry_date
       or new.note is distinct from old.note
       or new.rate is distinct from old.rate
       or new.project_id is distinct from old.project_id then
      raise exception 'project_hour_entries: a paid entry is locked; unmark it before editing';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_paid_project_hour_entries on public.project_hour_entries;
create trigger lock_paid_project_hour_entries
  before update or delete on public.project_hour_entries
  for each row execute function public.enforce_paid_entry_lock();

revoke execute on function public.enforce_paid_entry_lock() from anon, authenticated;
