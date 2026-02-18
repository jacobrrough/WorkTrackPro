-- Part drawing: one attachment per part (the only file standard users can access on job cards)

alter table public.attachments add column if not exists part_id uuid references public.parts(id) on delete cascade;
create index if not exists idx_attachments_part on public.attachments(part_id) where part_id is not null;

-- Allow part_id as alternative to job_id/inventory_id (exactly one of job_id, inventory_id, part_id)
alter table public.attachments drop constraint if exists attachments_job_or_inventory_check;
alter table public.attachments add constraint attachments_one_owner_check check (
  (job_id is not null and inventory_id is null and part_id is null) or
  (job_id is null and inventory_id is not null and part_id is null) or
  (job_id is null and inventory_id is null and part_id is not null)
);
