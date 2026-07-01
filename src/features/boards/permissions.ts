// Client-side board permission predicates. These MIRROR the server RLS policies so the UI
// never offers an action the database will reject:
//   • board structure / any card  -> can_edit_board  (owner OR editor member) OR admin
//   • a specific card             -> the above OR the card's own creator
// Admin here matches the server's is_admin_approved() (is_admin AND is_approved), not bare
// is_admin, so an unapproved admin isn't shown controls the server would block.
import type { Board, BoardCard, BoardMember, User } from '@/core/types';

function isApprovedAdmin(user: User): boolean {
  // currentUser.isApproved defaults to true when populated; only an explicit false demotes.
  return user.isAdmin === true && user.isApproved !== false;
}

/** Owner, an approved admin, or an 'editor' member — may edit the board and any card on it. */
export function canEditBoard(
  board: Pick<Board, 'createdBy'> | null | undefined,
  members: BoardMember[],
  user: User | null | undefined
): boolean {
  if (!user) return false;
  if (board?.createdBy === user.id) return true;
  if (isApprovedAdmin(user)) return true;
  return members.some((m) => m.userId === user.id && m.role === 'editor');
}

/** A board editor/admin, or the card's own creator — may edit or delete that card. */
export function canManageCard(
  card: Pick<BoardCard, 'createdBy'> | null | undefined,
  board: Pick<Board, 'createdBy'> | null | undefined,
  members: BoardMember[],
  user: User | null | undefined
): boolean {
  if (!card || !user) return false;
  return canEditBoard(board, members, user) || card.createdBy === user.id;
}
