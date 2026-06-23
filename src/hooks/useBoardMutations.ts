import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Board, BoardCard, BoardMemberRole, BoardVisibility, User } from '@/core/types';
import { boardService } from '@/services/api/boards';
import {
  applyCardReorder,
  removeBoardCard,
  removeBoardColumn,
  reorderBoardColumns,
  upsertBoardCard,
  upsertBoardColumn,
} from '@/lib/boardCache';
import { enqueueAction } from '@/lib/offlineActionQueue';
import { isOffline } from '@/lib/networkStatus';

export interface UseBoardMutationsParams {
  currentUser: User | null;
  showToast: (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ) => void;
}

export function useBoardMutations({ currentUser, showToast }: UseBoardMutationsParams) {
  const queryClient = useQueryClient();

  // ── Boards ──────────────────────────────────────────────

  const createBoard = useCallback(
    async (data: { name: string; description?: string; visibility: BoardVisibility }) => {
      if (!currentUser) return null;
      const board = await boardService.createBoard({ ...data, createdBy: currentUser.id });
      if (board) {
        queryClient.setQueryData<Board[]>(['boards'], (prev) =>
          prev ? [board, ...prev] : [board]
        );
        showToast('Board created', 'success');
      }
      return board;
    },
    [queryClient, currentUser, showToast]
  );

  const updateBoard = useCallback(
    async (
      boardId: string,
      data: { name?: string; description?: string; visibility?: BoardVisibility }
    ) => {
      const board = await boardService.updateBoard(boardId, data);
      if (board) {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
        queryClient.invalidateQueries({ queryKey: ['boards'] });
        showToast('Board updated', 'success');
      }
      return board;
    },
    [queryClient, showToast]
  );

  const deleteBoard = useCallback(
    async (boardId: string) => {
      const ok = await boardService.deleteBoard(boardId);
      if (ok) {
        queryClient.setQueryData<Board[]>(['boards'], (prev) =>
          prev ? prev.filter((b) => b.id !== boardId) : []
        );
        queryClient.removeQueries({ queryKey: ['board', boardId] });
        showToast('Board deleted', 'success');
      }
      return ok;
    },
    [queryClient, showToast]
  );

  // ── Columns ─────────────────────────────────────────────

  const addColumn = useCallback(
    async (boardId: string, data: { name: string; color?: string; sortOrder: number }) => {
      const col = await boardService.addColumn(boardId, data);
      if (col) {
        upsertBoardColumn(queryClient, boardId, col);
      }
      return col;
    },
    [queryClient]
  );

  const updateColumn = useCallback(
    async (boardId: string, columnId: string, data: { name?: string; color?: string }) => {
      const col = await boardService.updateColumn(columnId, data);
      if (col) {
        upsertBoardColumn(queryClient, boardId, col);
      }
      return col;
    },
    [queryClient]
  );

  const deleteColumn = useCallback(
    async (_boardId: string, columnId: string) => {
      const ok = await boardService.deleteColumn(columnId);
      if (ok) {
        removeBoardColumn(queryClient, columnId);
      }
      return ok;
    },
    [queryClient]
  );

  const reorderColumns = useCallback(
    async (boardId: string, columnIds: string[]) => {
      const ok = await boardService.reorderColumns(boardId, columnIds);
      if (ok) {
        reorderBoardColumns(queryClient, boardId, columnIds);
      }
      return ok;
    },
    [queryClient]
  );

  // ── Cards ───────────────────────────────────────────────

  const addCard = useCallback(
    async (data: {
      boardId: string;
      columnId: string;
      title: string;
      description?: string;
      assigneeId?: string;
      dueDate?: string;
      color?: string;
      sortOrder: number;
    }) => {
      const card = await boardService.addCard(data);
      if (card) {
        upsertBoardCard(queryClient, data.boardId, card);
      }
      return card;
    },
    [queryClient]
  );

  const updateCard = useCallback(
    async (
      boardId: string,
      cardId: string,
      data: {
        title?: string;
        description?: string;
        assigneeId?: string | null;
        dueDate?: string | null;
        color?: string | null;
      }
    ) => {
      const card = await boardService.updateCard(cardId, data);
      if (card) {
        upsertBoardCard(queryClient, boardId, card);
        return card;
      }
      if (isOffline() && currentUser) {
        enqueueAction({
          type: 'card_update',
          entityId: cardId,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          boardId,
          data,
        });
        // Don't invalidate — that would refetch and revert the optimistic edit.
        return { id: cardId, ...data } as unknown as BoardCard;
      }
      return card;
    },
    [queryClient, currentUser]
  );

  const moveCard = useCallback(
    async (boardId: string, cardId: string, data: { columnId: string; sortOrder: number }) => {
      const card = await boardService.moveCard(cardId, data);
      if (card) {
        upsertBoardCard(queryClient, boardId, card);
        return card;
      }
      if (isOffline() && currentUser) {
        enqueueAction({
          type: 'card_move',
          entityId: cardId,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          boardId,
          columnId: data.columnId,
          sortOrder: data.sortOrder,
        });
        // Skip invalidate so the optimistic drop position sticks (rendered as pending).
        return { id: cardId, columnId: data.columnId, sortOrder: data.sortOrder } as BoardCard;
      }
      return card;
    },
    [queryClient, currentUser]
  );

  const reorderCards = useCallback(
    async (boardId: string, columnId: string, cardIds: string[]) => {
      const ok = await boardService.reorderCards(boardId, columnId, cardIds);
      if (ok) {
        // Patch the cache to the dropped order so BoardView can clear its optimistic drag
        // state without a refetch (no flash, no round-trip). The realtime echo of these
        // board_cards updates re-applies the same values idempotently.
        applyCardReorder(queryClient, boardId, columnId, cardIds);
        return true;
      }
      if (isOffline() && currentUser) {
        enqueueAction({
          type: 'card_reorder',
          entityId: boardId,
          userId: currentUser.id,
          createdAt: new Date().toISOString(),
          boardId,
          columnId,
          cardIds,
        });
        return true; // optimistic order held by BoardView until sync
      }
      return ok;
    },
    [queryClient, currentUser]
  );

  const deleteCard = useCallback(
    async (_boardId: string, cardId: string) => {
      const ok = await boardService.deleteCard(cardId);
      if (ok) {
        removeBoardCard(queryClient, cardId);
      }
      return ok;
    },
    [queryClient]
  );

  // ── Members ─────────────────────────────────────────────

  const addMember = useCallback(
    async (boardId: string, userId: string, role: BoardMemberRole = 'editor') => {
      const member = await boardService.addMember(boardId, userId, role);
      if (member) {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
        showToast('Member added', 'success');
      }
      return member;
    },
    [queryClient, showToast]
  );

  const removeMember = useCallback(
    async (boardId: string, userId: string) => {
      const ok = await boardService.removeMember(boardId, userId);
      if (ok) {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
        showToast('Member removed', 'success');
      }
      return ok;
    },
    [queryClient, showToast]
  );

  const updateMemberRole = useCallback(
    async (boardId: string, memberId: string, role: BoardMemberRole) => {
      const ok = await boardService.updateMemberRole(memberId, role);
      if (ok) {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      }
      return ok;
    },
    [queryClient]
  );

  // ── Card attachments ───────────────────────────────────

  const addCardAttachment = useCallback(
    async (boardId: string, cardId: string, file: File) => {
      const att = await boardService.addCardAttachment(cardId, file);
      if (att) {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
        showToast('Attachment uploaded', 'success');
      } else {
        showToast('Upload failed', 'error');
      }
      return att;
    },
    [queryClient, showToast]
  );

  const deleteCardAttachment = useCallback(
    async (boardId: string, attachmentId: string) => {
      const ok = await boardService.deleteCardAttachment(attachmentId);
      if (ok) {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
        showToast('Attachment deleted', 'success');
      } else {
        showToast('Failed to delete attachment', 'error');
      }
      return ok;
    },
    [queryClient, showToast]
  );

  return {
    createBoard,
    updateBoard,
    deleteBoard,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    addCard,
    updateCard,
    moveCard,
    reorderCards,
    deleteCard,
    addMember,
    removeMember,
    updateMemberRole,
    addCardAttachment,
    deleteCardAttachment,
  };
}
