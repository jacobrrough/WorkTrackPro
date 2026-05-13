import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Board, BoardMemberRole, BoardVisibility, User } from '@/core/types';
import { boardService } from '@/services/api/boards';

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
      if (col) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      return col;
    },
    [queryClient]
  );

  const updateColumn = useCallback(
    async (boardId: string, columnId: string, data: { name?: string; color?: string }) => {
      const col = await boardService.updateColumn(columnId, data);
      if (col) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      return col;
    },
    [queryClient]
  );

  const deleteColumn = useCallback(
    async (boardId: string, columnId: string) => {
      const ok = await boardService.deleteColumn(columnId);
      if (ok) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      return ok;
    },
    [queryClient]
  );

  const reorderColumns = useCallback(
    async (boardId: string, columnIds: string[]) => {
      const ok = await boardService.reorderColumns(boardId, columnIds);
      if (ok) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
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
      if (card) queryClient.invalidateQueries({ queryKey: ['board', data.boardId] });
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
      if (card) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      return card;
    },
    [queryClient]
  );

  const moveCard = useCallback(
    async (boardId: string, cardId: string, data: { columnId: string; sortOrder: number }) => {
      const card = await boardService.moveCard(cardId, data);
      if (card) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      return card;
    },
    [queryClient]
  );

  const reorderCards = useCallback(
    async (boardId: string, columnId: string, cardIds: string[]) => {
      const ok = await boardService.reorderCards(boardId, columnId, cardIds);
      if (ok) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      return ok;
    },
    [queryClient]
  );

  const deleteCard = useCallback(
    async (boardId: string, cardId: string) => {
      const ok = await boardService.deleteCard(cardId);
      if (ok) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
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
      if (ok) queryClient.invalidateQueries({ queryKey: ['board', boardId] });
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
