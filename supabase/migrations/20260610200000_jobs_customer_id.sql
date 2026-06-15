-- Unified jobs ↔ billing — first-class customer on jobs
--
-- Adds the optional public.jobs.customer_id → accounting.customers(id) link: the job
-- becomes the spine that ties operational work to its AR party, so estimates/invoices
-- created from a job pre-fill the right customer and the job page can show its billing
-- documents. NULL for jobs with no customer (all 154 existing rows start NULL).
--
-- SAFETY (live table):
--   • Additive nullable column — no default, no rewrite (precedent: the
--     jobs_quoted_snapshot migration 20260608232404).
--   • The FK is added NOT VALID then VALIDATEd: no long ACCESS EXCLUSIVE validation
--     scan; on all-NULL data VALIDATE is instant.
--   • ON DELETE SET NULL: removing a customer can never delete or block a job.
--   • The FK's referential-integrity check runs as the constraint owner (bypasses
--     accounting RLS), so accounting policies can never reject a job write.
--   • Public intake (submit-proposal fn) never sets the column — unaffected.
--
-- NOTE: this is the one place `public` references `accounting` (deliberate — the
-- unification makes accounting.customers the canonical party master). Dropping the
-- accounting schema would auto-drop the constraint, leaving plain uuids.
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   alter table public.jobs drop constraint if exists jobs_customer_id_fkey;
--   drop index if exists public.idx_jobs_customer_id;
--   alter table public.jobs drop column if exists customer_id;

alter table public.jobs
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_jobs_customer_id'
  ) then
    create index idx_jobs_customer_id on public.jobs (customer_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_customer_id_fkey' and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_customer_id_fkey
      foreign key (customer_id) references accounting.customers(id)
      on delete set null
      not valid;
  end if;
end $$;

alter table public.jobs validate constraint jobs_customer_id_fkey;

comment on column public.jobs.customer_id is
  'Optional FK to accounting.customers(id) — the job''s billing customer. NULL when unlinked. ON DELETE SET NULL.';
