-- Sync repo migrations with live Supabase schema.
-- Two columns were added directly in the live database without a corresponding migration file.
-- Both are nullable and idempotent (IF NOT EXISTS).

-- 1. jobs.preferred_worker_id — nullable FK to profiles
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS preferred_worker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. part_variants.description — nullable text
ALTER TABLE public.part_variants
  ADD COLUMN IF NOT EXISTS description text;
