-- Atomic allocation guard: prevent job_inventory insert/update from causing
-- allocated > in_stock (avoids race when two users allocate the last units simultaneously).
-- "Active" jobs = statuses that count toward allocated (matches app ACTIVE_ALLOCATION_STATUSES).

create or replace function public.job_inventory_allocate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventory_id uuid;
  v_quantity numeric;
  v_in_stock int;
  v_allocated numeric;
  v_active_statuses text[] := array['pod','rush','pending','inProgress','qualityControl','finished'];
begin
  if (tg_op = 'INSERT') then
    v_inventory_id := new.inventory_id;
    v_quantity := new.quantity;
  else
    v_inventory_id := new.inventory_id;
    v_quantity := new.quantity - old.quantity;
  end if;

  select in_stock into v_in_stock
  from public.inventory
  where id = v_inventory_id;

  if v_in_stock is null then
    raise exception 'inventory item not found';
  end if;

  -- Total allocated to active jobs for this inventory (including this row for INSERT, or delta for UPDATE)
  select coalesce(sum(ji.quantity), 0) into v_allocated
  from public.job_inventory ji
  join public.jobs j on j.id = ji.job_id
  where ji.inventory_id = v_inventory_id
    and j.status = any(v_active_statuses)
    and (tg_op = 'INSERT' or ji.id != old.id);

  if tg_op = 'UPDATE' then
    v_allocated := v_allocated + new.quantity;
  else
    v_allocated := v_allocated + v_quantity;
  end if;

  if v_in_stock < v_allocated then
    raise exception 'insufficient_stock: cannot allocate % units; only % in stock (already allocated to active jobs)',
      v_quantity, v_in_stock
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists job_inventory_allocate_guard_trigger on public.job_inventory;
create trigger job_inventory_allocate_guard_trigger
  before insert or update of quantity, inventory_id
  on public.job_inventory
  for each row
  execute function public.job_inventory_allocate_guard();

comment on function public.job_inventory_allocate_guard() is
  'Prevents allocating more inventory to jobs than in_stock; avoids race when multiple users allocate the last units.';
