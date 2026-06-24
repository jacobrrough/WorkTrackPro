-- Inventory item photos: a public `inventory-images` Storage bucket + RLS so approved users can
-- upload / replace / delete an item's photo, and anyone can read it (public URLs are rendered in
-- the inventory hub and All Parts list). Mirrors the attachments-bucket policy shape
-- (20260224000003) but scoped to bucket_id = 'inventory-images'.
--
-- ROLLBACK:
--   drop policy if exists "Inventory images: approved insert" on storage.objects;
--   drop policy if exists "Inventory images: approved update" on storage.objects;
--   drop policy if exists "Inventory images: approved delete" on storage.objects;
--   drop policy if exists "Inventory images: public read" on storage.objects;
--   delete from storage.buckets where id = 'inventory-images';

insert into storage.buckets (id, name, public)
values ('inventory-images', 'inventory-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Inventory images: approved insert" on storage.objects;
create policy "Inventory images: approved insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'inventory-images' and public.is_approved_user());

drop policy if exists "Inventory images: approved update" on storage.objects;
create policy "Inventory images: approved update"
on storage.objects for update to authenticated
using (bucket_id = 'inventory-images' and public.is_approved_user())
with check (bucket_id = 'inventory-images' and public.is_approved_user());

drop policy if exists "Inventory images: approved delete" on storage.objects;
create policy "Inventory images: approved delete"
on storage.objects for delete to authenticated
using (bucket_id = 'inventory-images' and public.is_approved_user());

drop policy if exists "Inventory images: public read" on storage.objects;
create policy "Inventory images: public read"
on storage.objects for select to public
using (bucket_id = 'inventory-images');
