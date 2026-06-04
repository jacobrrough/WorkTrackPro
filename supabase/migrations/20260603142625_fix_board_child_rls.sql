-- SECURITY FIX (critical): board_columns / board_cards / board_members had
-- `for all to authenticated using (true) with check (true)` — Postgres RLS does NOT
-- cascade from boards to child tables, so ANY authenticated user could read, modify,
-- or delete the cards/columns/membership of ANY board (IDOR), and self-insert into
-- board_members to escalate into 'members'-visibility boards. This migration scopes the
-- child tables back to the parent board's visibility/ownership.
--
-- Access model (deliberate, enforces the existing owner/editor/viewer roles server-side):
--   • SELECT child rows  -> you can SEE the board (owner OR 'everyone' OR a member of a
--                           'members' board).
--   • WRITE child rows   -> you can EDIT the board (owner OR an 'editor' member). 'viewer'
--                           members and non-members are read-only — including on
--                           'everyone' boards (owner must add collaborators as editors).
--   • board_members      -> SELECT for anyone who can see the board; INSERT/UPDATE/DELETE
--                           restricted to the board OWNER (membership management).
--
-- IDEMPOTENT. Service-role (Netlify functions) bypasses RLS and is unaffected.
-- REVIEW + verify against a live Postgres with RLS before applying.

-- ── Recursion-safe helpers ───────────────────────────────────────────────────
-- SECURITY DEFINER so their internal reads bypass RLS; this is what lets the
-- board_members policies consult membership without triggering infinite-recursion.

create or replace function public.can_see_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = p_board_id
      and (
        b.created_by = auth.uid()
        or b.visibility = 'everyone'
        or (b.visibility = 'members' and exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = auth.uid()
        ))
      )
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = p_board_id
      and (
        b.created_by = auth.uid()
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id
            and m.user_id = auth.uid()
            and m.role = 'editor'
        )
      )
  );
$$;

-- Keep these helpers OUT of the public/anon RPC surface (they are only needed by the
-- RLS policies below, which run as `authenticated`). This avoids exposing them as
-- callable endpoints to anonymous users.
revoke all on function public.can_see_board(uuid) from public, anon;
revoke all on function public.can_edit_board(uuid) from public, anon;
grant execute on function public.can_see_board(uuid) to authenticated;
grant execute on function public.can_edit_board(uuid) to authenticated;

-- ── board_columns ────────────────────────────────────────────────────────────
drop policy if exists "Authenticated board_columns" on public.board_columns;
drop policy if exists "board_columns_select" on public.board_columns;
drop policy if exists "board_columns_insert" on public.board_columns;
drop policy if exists "board_columns_update" on public.board_columns;
drop policy if exists "board_columns_delete" on public.board_columns;

create policy "board_columns_select" on public.board_columns
  for select to authenticated using (public.can_see_board(board_id));
create policy "board_columns_insert" on public.board_columns
  for insert to authenticated with check (public.can_edit_board(board_id));
create policy "board_columns_update" on public.board_columns
  for update to authenticated using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));
create policy "board_columns_delete" on public.board_columns
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── board_cards ──────────────────────────────────────────────────────────────
drop policy if exists "Authenticated board_cards" on public.board_cards;
drop policy if exists "board_cards_select" on public.board_cards;
drop policy if exists "board_cards_insert" on public.board_cards;
drop policy if exists "board_cards_update" on public.board_cards;
drop policy if exists "board_cards_delete" on public.board_cards;

create policy "board_cards_select" on public.board_cards
  for select to authenticated using (public.can_see_board(board_id));
create policy "board_cards_insert" on public.board_cards
  for insert to authenticated with check (public.can_edit_board(board_id));
create policy "board_cards_update" on public.board_cards
  for update to authenticated using (public.can_edit_board(board_id)) with check (public.can_edit_board(board_id));
create policy "board_cards_delete" on public.board_cards
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── board_members ────────────────────────────────────────────────────────────
-- SELECT: visible to anyone who can see the board (roster display).
-- WRITE:  board owner only (managing who has access). Uses the boards owner check
--         directly (NOT a board_members self-reference) to stay recursion-free.
drop policy if exists "Authenticated board_members" on public.board_members;
drop policy if exists "board_members_select" on public.board_members;
drop policy if exists "board_members_insert" on public.board_members;
drop policy if exists "board_members_update" on public.board_members;
drop policy if exists "board_members_delete" on public.board_members;

create policy "board_members_select" on public.board_members
  for select to authenticated using (public.can_see_board(board_id));
create policy "board_members_insert" on public.board_members
  for insert to authenticated with check (
    exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
  );
create policy "board_members_update" on public.board_members
  for update to authenticated using (
    exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
  ) with check (
    exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
  );
create policy "board_members_delete" on public.board_members
  for delete to authenticated using (
    exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
  );
