-- ============================================
-- WIPE IMPORTED DATA (jobs + inventory)
-- ============================================
-- Run this in Supabase SQL Editor if you need to clear all jobs and inventory
-- (e.g. to re-run Trello import from scratch).
--
-- WARNING: This deletes ALL jobs and ALL inventory and their related data.
-- There is no undo. Run only if you are sure.
--
-- ============================================

-- 1. Delete data that references jobs (order matters for FKs)
delete from public.shifts;
delete from public.job_inventory;
delete from public.comments;
delete from public.attachments where job_id is not null;

-- 2. Delete all jobs
delete from public.jobs;

-- 3. Delete data that references inventory
delete from public.attachments where inventory_id is not null;
-- part_materials references inventory; delete those rows so we can wipe inventory
delete from public.part_materials where inventory_id is not null;

-- 4. Delete all inventory
delete from public.inventory;

-- Done. Job and inventory tables are now empty.
-- You can re-import from Trello after this.
