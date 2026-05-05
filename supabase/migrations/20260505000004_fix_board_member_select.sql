-- Fix: members couldn't see boards they were added to.
-- The original policy used unqualified `id` inside the subquery, which Postgres
-- resolved to `board_members.id` (inner table), so the EXISTS clause never matched.
-- Qualify with `boards.id` to reference the outer table.

drop policy if exists "Board select" on public.boards;
create policy "Board select" on public.boards for select to authenticated using (
  created_by = auth.uid()
  or visibility = 'everyone'
  or (visibility = 'members' and exists (
    select 1 from public.board_members where board_members.board_id = boards.id and board_members.user_id = auth.uid()
  ))
);
