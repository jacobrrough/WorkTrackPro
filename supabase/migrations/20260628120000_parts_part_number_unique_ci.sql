-- Parts: case-insensitive unique constraint on part_number (TOCTOU fix).
--
-- createPart was a bare insert with no DB-level uniqueness, and the UI does a check-then-act
-- (getPartByNumber → createPart). Two concurrent clients submitting the same part number both pass
-- the check and both insert, producing duplicate parts. This adds a unique index on
-- lower(part_number) — matching the case-insensitive getPartByNumber fallback — so the second
-- writer gets a 23505; parts.createPart() translates that into re-fetching and returning the
-- existing part instead of a silent failure.
--
-- The index is PARTIAL (excludes null / blank part numbers) because createPart defaults an
-- unspecified part_number to '' and several legacy rows may have blank numbers we don't want to
-- collide.
--
-- SAFETY: a unique index cannot be created while duplicates already exist. We refuse loudly (rather
-- than silently skip and leave the race unguarded) so the offending numbers can be merged first via
-- the app's existing duplicate-part merge, then the migration re-run.
--
-- ROLLBACK:
--   drop index if exists public.parts_part_number_lower_key;

do $$
declare
  dup_groups int;
  dup_list text;
begin
  select count(*), string_agg(ln, ', ')
  into dup_groups, dup_list
  from (
    select lower(part_number) as ln
    from public.parts
    where part_number is not null and btrim(part_number) <> ''
    group by lower(part_number)
    having count(*) > 1
  ) d;

  if coalesce(dup_groups, 0) > 0 then
    raise exception
      'Cannot add unique index on lower(part_number): % duplicate part number(s) exist (%). Merge them in the app first, then re-run.',
      dup_groups, dup_list;
  end if;
end $$;

create unique index if not exists parts_part_number_lower_key
  on public.parts (lower(part_number))
  where part_number is not null and btrim(part_number) <> '';
