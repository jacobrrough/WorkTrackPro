-- ============================================
-- FIX: "attachments_job_or_inventory_check is violated by some row"
-- Run this in Supabase SQL Editor if you hit that error.
-- ============================================
-- You have rows with only part_id set (e.g. part drawings). The old constraint
-- required either job_id OR inventory_id, so those rows violate it.
-- This script switches to the final constraint that allows job_id, inventory_id, OR part_id.

-- Ensure part_id column exists (from part drawing migration)
alter table public.attachments add column if not exists part_id uuid references public.parts(id) on delete cascade;

alter table public.attachments drop constraint if exists attachments_job_or_inventory_check;
alter table public.attachments drop constraint if exists attachments_one_owner_check;

alter table public.attachments add constraint attachments_one_owner_check check (
  (job_id is not null and inventory_id is null and part_id is null) or
  (job_id is null and inventory_id is not null and part_id is null) or
  (job_id is null and inventory_id is null and part_id is not null)
);
