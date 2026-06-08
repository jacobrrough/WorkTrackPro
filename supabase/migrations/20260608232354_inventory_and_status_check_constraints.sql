-- Declarative integrity guards for inventory quantities and job status.
-- All constraints have been verified to pass on existing live data, so they
-- can be added directly (no NOT VALID / no cleanup). Each ADD CONSTRAINT is
-- guarded so the migration is idempotent.

-- inventory.in_stock must never go negative
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_in_stock_nonneg'
    and conrelid = 'public.inventory'::regclass
  ) then
    alter table public.inventory
    add constraint inventory_in_stock_nonneg check (in_stock >= 0);
  end if;
end $$;

-- inventory.available must never go negative
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_available_nonneg'
    and conrelid = 'public.inventory'::regclass
  ) then
    alter table public.inventory
    add constraint inventory_available_nonneg check (available >= 0);
  end if;
end $$;

-- job_inventory.quantity must be a positive allocation
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_inventory_quantity_positive'
    and conrelid = 'public.job_inventory'::regclass
  ) then
    alter table public.job_inventory
    add constraint job_inventory_quantity_positive check (quantity > 0);
  end if;
end $$;

-- jobs.status must be one of the app's JobStatus union values
-- (mirrors the JobStatus type union in src/core/types.ts)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_status_valid'
    and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
    add constraint jobs_status_valid check (
      status in (
        'pending',
        'rush',
        'inProgress',
        'qualityControl',
        'finished',
        'delivered',
        'onHold',
        'toBeQuoted',
        'quoted',
        'rfqReceived',
        'rfqSent',
        'pod',
        'waitingForPayment',
        'projectCompleted',
        'paid'
      )
    );
  end if;
end $$;
