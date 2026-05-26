-- Enable Realtime for all core application tables.
-- Idempotent: skips any table already in the publication or not yet created.

do $$
declare
  t text;
begin
  foreach t in array array[
    'jobs',
    'shifts',
    'inventory',
    'comments',
    'attachments',
    'job_parts',
    'job_inventory',
    'checklists',
    'deliveries',
    'boards',
    'board_columns',
    'board_cards',
    'parts',
    'profiles'
  ] loop
    if exists (
      select 1 from pg_class
      where relname = t
        and relnamespace = 'public'::regnamespace
    ) and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
