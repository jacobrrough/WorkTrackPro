-- ============================================
-- DELETE ADMIN IMPORT (admin board jobs only)
-- ============================================
-- Run this in Supabase SQL Editor to remove only jobs imported as
-- "Admin Jobs" from Trello (board_type = 'admin').
--
-- Shop Floor jobs and all inventory are left unchanged.
-- There is no undo. Run only if you are sure.
-- ============================================

-- 1. Delete data that references admin jobs (order matters for FKs)
delete from public.shifts
where job_id in (select id from public.jobs where board_type = 'admin');

delete from public.job_inventory
where job_id in (select id from public.jobs where board_type = 'admin');

delete from public.comments
where job_id in (select id from public.jobs where board_type = 'admin');

delete from public.attachments
where job_id is not null
  and job_id in (select id from public.jobs where board_type = 'admin');

-- 2. Delete admin jobs
delete from public.jobs
where board_type = 'admin';

-- Done. Only admin-imported jobs and their shifts, materials, comments,
-- and attachments are removed. Shop Floor jobs and inventory are unchanged.
