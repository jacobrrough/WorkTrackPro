-- Add inventory_id support to attachments table
-- Allows attachments to be linked to either jobs or inventory items

-- Make job_id nullable (existing attachments keep their job_id)
alter table public.attachments alter column job_id drop not null;

-- Add inventory_id column
alter table public.attachments add column if not exists inventory_id uuid references public.inventory(id) on delete cascade;

-- Note: constraint added in next migration (20250218000003) once part_id column exists,
-- so we can express the full one-owner rule in one place without breaking existing rows.

-- Add index for inventory_id lookups
create index if not exists idx_attachments_inventory on public.attachments(inventory_id);

-- Add attachment_count column to inventory table (similar to jobs)
alter table public.inventory add column if not exists attachment_count integer not null default 0;
