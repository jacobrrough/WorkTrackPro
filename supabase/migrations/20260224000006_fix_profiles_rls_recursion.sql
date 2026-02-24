-- Fix RLS recursion on public.profiles helper functions
-- Symptoms:
-- - Standard users can't log in (profiles read fails)
-- - Admin toggles cause "no data" due to RLS evaluation errors
--
-- Root cause: policies referencing helper functions that read public.profiles can recurse.
-- Solution: make helper functions SECURITY DEFINER so they run as table owner and bypass RLS.

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_approved = true
  );
$$;

create or replace function public.is_admin_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
      and p.is_approved = true
  );
$$;
