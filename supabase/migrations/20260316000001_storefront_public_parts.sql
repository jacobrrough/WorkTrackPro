-- Storefront: public parts, product images (attachment_type), anon read for store
-- Option A: attachments with attachment_type ('drawing' | 'product_image') for parts

-- 1) Parts: show on store flag
alter table public.parts add column if not exists show_on_store boolean not null default false;

-- 2) Attachments: type for part attachments (drawing vs product_image)
alter table public.attachments add column if not exists attachment_type text default 'general';
comment on column public.attachments.attachment_type is 'For part_id: drawing (technical) or product_image (storefront). Job/inventory attachments ignore.';

-- Backfill existing part attachments as drawings
update public.attachments
set attachment_type = 'drawing'
where part_id is not null and (attachment_type is null or attachment_type = 'general');

-- 3) RLS: anon can read parts that are shown on store
create policy "Anon read parts on store"
on public.parts for select
to anon
using (show_on_store = true);

-- 4) RLS: anon can read part_variants for store parts (for variant pricing)
create policy "Anon read part_variants for store parts"
on public.part_variants for select
to anon
using (
  part_id in (select id from public.parts where show_on_store = true)
);

-- 5) RLS: anon can read attachments that are product_image for store parts
create policy "Anon read product_image attachments for store parts"
on public.attachments for select
to anon
using (
  part_id is not null
  and attachment_type = 'product_image'
  and part_id in (select id from public.parts where show_on_store = true)
);

-- 6) Storage: anon can read objects in attachments bucket under parts/<part_id>/ when part is on store
-- Path format: parts/<uuid>/<file>
create or replace function public.part_id_from_attachment_path(path text)
returns uuid
language sql
stable
as $$
  select case
    when path ~ '^parts/[0-9a-fA-F-]{36}/' then (regexp_match(path, '^parts/([0-9a-fA-F-]{36})/'))[1]::uuid
    else null
  end;
$$;

drop policy if exists "Attachments bucket: anon read store product images" on storage.objects;
create policy "Attachments bucket: anon read store product images"
on storage.objects for select
to anon
using (
  bucket_id = 'attachments'
  and public.part_id_from_attachment_path(name) is not null
  and exists (
    select 1 from public.parts p
    where p.id = public.part_id_from_attachment_path(name)
      and p.show_on_store = true
  )
);

-- If storefront prices still don't appear after running this migration, reload PostgREST schema:
--   NOTIFY pgrst, 'reload schema';
-- Then hard-refresh the app (Ctrl+F5).
