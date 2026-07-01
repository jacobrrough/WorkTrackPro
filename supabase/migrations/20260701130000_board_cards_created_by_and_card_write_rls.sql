-- Custom-board cards: let ADMINS and a card's OWN CREATOR edit/delete cards, not just the
-- board owner / editor-members.
--
-- Before: board_cards UPDATE/DELETE were gated solely by can_edit_board(board_id) (board
-- owner OR an 'editor' member). On an 'everyone'-visibility board (e.g. a shared bug board),
-- a non-editor who reported a card could not delete it — and because Postgres RLS filters a
-- blocked DELETE to 0 rows and returns NO error, the client's delete "succeeded" optimistically
-- and the card silently reappeared on reload. This records card authorship and widens the
-- write policy to match the intended model: admins, or the person who made the card.
--
-- SELECT and INSERT policies are unchanged. IDEMPOTENT. Service-role (Netlify functions)
-- bypasses RLS and is unaffected.

-- 1. Track who created each card. `default auth.uid()` captures authorship on every PostgREST
--    insert path with no app change. Existing rows stay NULL (unknown author) and remain
--    deletable by board owner / editor / admin only.
alter table public.board_cards
  add column if not exists created_by uuid references public.profiles(id) default auth.uid();

-- 2. Widen UPDATE/DELETE to: board editors (owner/editor member) OR an admin OR the card's
--    own creator.
drop policy if exists "board_cards_update" on public.board_cards;
drop policy if exists "board_cards_delete" on public.board_cards;

-- USING gates which existing rows a user may target (a creator may target their own card).
-- WITH CHECK gates the resulting row: a creator's edit must keep the card on a board they can
-- still SEE. Without the can_see_board guard the creator clause (created_by is unchanged by an
-- update) would let a creator reparent their card into an arbitrary board_id/column_id they
-- can't see — injecting content into another board. Board editors/admins keep full reach.
create policy "board_cards_update" on public.board_cards
  for update to authenticated
  using (
    public.can_edit_board(board_id)
    or public.is_admin_approved()
    or created_by = auth.uid()
  )
  with check (
    public.can_edit_board(board_id)
    or public.is_admin_approved()
    or (created_by = auth.uid() and public.can_see_board(board_id))
  );

create policy "board_cards_delete" on public.board_cards
  for delete to authenticated
  using (
    public.can_edit_board(board_id)
    or public.is_admin_approved()
    or created_by = auth.uid()
  );

-- 3. Pin board_id on UPDATE. The creator WITH CHECK clause above only requires can_see_board of
--    the TARGET board, so a card's creator (or even a 'viewer' member of another board) could
--    otherwise reparent their card into any board they can merely SEE. board_id has no reason to
--    change in normal use (cards move between COLUMNS of the same board, never across boards), so
--    forbid changing it unless the caller can actually edit the card's ORIGINAL board (editors /
--    admins). Trigger-only SECURITY DEFINER fn; revoked from the RPC surface per repo convention.
create or replace function public.board_cards_pin_board_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.board_id is distinct from old.board_id
     and not (public.can_edit_board(old.board_id) or public.is_admin_approved()) then
    raise exception 'board_cards: cannot move a card to a different board';
  end if;
  return new;
end;
$$;

revoke execute on function public.board_cards_pin_board_id() from public, anon, authenticated;

drop trigger if exists board_cards_pin_board_id on public.board_cards;
create trigger board_cards_pin_board_id
  before update on public.board_cards
  for each row execute function public.board_cards_pin_board_id();
