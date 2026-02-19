-- ============================================
-- CREATE STORAGE BUCKETS AND POLICIES
-- Run this in Supabase SQL Editor
-- ============================================

-- Note: Storage buckets must be created via the Supabase Dashboard or Storage API
-- This script sets up the policies, but you need to create the buckets first:
-- 
-- 1. Go to Supabase Dashboard -> Storage
-- 2. Click "New bucket"
-- 3. Create bucket named "attachments" (public or private)
-- 4. Create bucket named "inventory-images" (public or private)
-- 
-- Then run this script to set up the policies.

-- Enable storage extension if not already enabled
create extension if not exists storage;

-- Policy: Allow authenticated users to upload attachments
-- This allows uploads to jobs/, inventory/, and parts/ folders
create policy if not exists "Authenticated users can upload attachments"
on storage.objects for insert
to authenticated
with check (bucket_id = 'attachments');

-- Policy: Allow authenticated users to read attachments
create policy if not exists "Authenticated users can read attachments"
on storage.objects for select
to authenticated
using (bucket_id = 'attachments');

-- Policy: Allow authenticated users to delete attachments
create policy if not exists "Authenticated users can delete attachments"
on storage.objects for delete
to authenticated
using (bucket_id = 'attachments');

-- Policy: Allow authenticated users to update attachments
create policy if not exists "Authenticated users can update attachments"
on storage.objects for update
to authenticated
using (bucket_id = 'attachments');

-- Similar policies for inventory-images bucket
create policy if not exists "Authenticated users can upload inventory images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'inventory-images');

create policy if not exists "Authenticated users can read inventory images"
on storage.objects for select
to authenticated
using (bucket_id = 'inventory-images');

create policy if not exists "Authenticated users can delete inventory images"
on storage.objects for delete
to authenticated
using (bucket_id = 'inventory-images');

-- ============================================
-- MANUAL STEPS REQUIRED:
-- ============================================
-- 1. Go to Supabase Dashboard -> Storage
-- 2. Click "New bucket"
-- 3. Name: "attachments"
--    - Public bucket: ON (if you want public URLs) or OFF (if using signed URLs)
--    - File size limit: 10MB (or your preference)
--    - Allowed MIME types: Leave empty for all types, or specify: image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document
-- 4. Click "Create bucket"
-- 5. Repeat for "inventory-images" bucket
-- ============================================
