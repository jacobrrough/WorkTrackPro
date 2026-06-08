-- ============================================
-- FIX STORAGE RLS: Allow uploads to parts/ in attachments bucket
-- Run this in Supabase SQL Editor
-- ============================================
-- Error was: "new row violates row-level security policy"
-- Existing policies may only allow jobs/ or inventory/ paths.
-- This script ensures authenticated users can upload/read/delete
-- in the attachments bucket for any path (jobs/, inventory/, parts/).

-- Drop existing insert policy on attachments bucket if it's path-restrictive
drop policy if exists "Authenticated users can upload attachments" on storage.objects;
drop policy if exists "Allow authenticated uploads to attachments" on storage.objects;
drop policy if exists "Users can upload attachments" on storage.objects;
-- Common Supabase default names:
drop policy if exists "Avatar uploads" on storage.objects;
drop policy if exists "Storage bucket attachments policy" on storage.objects;

-- Create a single permissive INSERT policy for attachments bucket (all paths)
create policy "Attachments bucket: authenticated insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'attachments');

-- Ensure SELECT and DELETE exist (drop first to avoid duplicate)
drop policy if exists "Authenticated users can read attachments" on storage.objects;
drop policy if exists "Attachments bucket: authenticated select" on storage.objects;
create policy "Attachments bucket: authenticated select"
on storage.objects for select
to authenticated
using (bucket_id = 'attachments');

drop policy if exists "Authenticated users can delete attachments" on storage.objects;
drop policy if exists "Attachments bucket: authenticated delete" on storage.objects;
create policy "Attachments bucket: authenticated delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'attachments');

drop policy if exists "Authenticated users can update attachments" on storage.objects;
drop policy if exists "Attachments bucket: authenticated update" on storage.objects;
create policy "Attachments bucket: authenticated update"
on storage.objects for update
to authenticated
using (bucket_id = 'attachments');

-- ============================================
-- Done. Try uploading a part drawing again.
-- ============================================
