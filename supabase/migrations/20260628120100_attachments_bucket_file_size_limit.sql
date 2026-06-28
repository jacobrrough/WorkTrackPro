-- Attachments bucket: server-side file-size backstop.
--
-- All upload size enforcement was client JS (FileUploadButton / validateProductImageFile); a direct
-- supabase.storage.from('attachments').upload(...) bypasses it and can store an arbitrarily large
-- object. This sets a bucket-level file_size_limit so the cap is enforced server-side regardless of
-- the caller.
--
-- We deliberately do NOT set allowed_mime_types here: the `attachments` bucket is shared by part
-- drawings (PDF/CAD), job photos, board-card files and inventory images, so an image-only allowlist
-- would reject legitimate non-image uploads.
--
-- The stored-XSS vector (an .svg/.html served inline) is mitigated IN APP CODE for uploads made
-- through uploadAttachment(): dangerous content types are forced to application/octet-stream
-- (download, not execute), and product images get a stricter image-only allowlist (see storage.ts).
-- This does NOT cover a direct supabase.storage.from('attachments').upload(...) call, which bypasses
-- that app-side control. Fully closing the inline-execution vector for the public storefront
-- requires a serve-layer control (Content-Disposition: attachment, or an image proxy) — tracked as
-- a separate follow-up, not done here.
--
-- 52428800 = 50 MB. Generous enough for large CAD drawings while still bounding abuse. Write RLS on
-- storage.objects for this bucket already exists (20260224000003_user_approval).
--
-- ROLLBACK:
--   update storage.buckets set file_size_limit = null where id = 'attachments';

update storage.buckets
set file_size_limit = 52428800
where id = 'attachments';
