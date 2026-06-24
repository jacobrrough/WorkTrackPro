import type { QueryClient } from '@tanstack/react-query';
import type { Board, BoardCard, BoardColumn, BoardMember } from '@/core/types';

/**
 * Direct cache patching for the board-detail query (`['board', boardId]`).
 *
 * Both the board mutations (the acting user) and the realtime echo (other users + the
 * echo of your own change) use these instead of invalidating + refetching the whole board.
 * getBoardById is ~5 round-trips, so refetching on every card move was the source of the
 * "slow + flash" on boards; patching the cached arrays is instant and re-renders only the
 * affected card/column. BoardView sorts cards by sortOrder at render and prefers its local
 * drag state, so patched data integrates seamlessly and never disturbs an in-flight drag.
 */
export interface BoardDetailData {
  board: Board;
  cards: BoardCard[];
  members: BoardMember[];
}

function patch(
  queryClient: QueryClient,
  boardId: string,
  fn: (prev: BoardDetailData) => BoardDetailData
): void {
  queryClient.setQueryData<BoardDetailData>(['board', boardId], (prev) => (prev ? fn(prev) : prev));
}

/** Insert or merge a card. Preserves the joined attachments (absent from realtime/mutation
 *  payloads) so the attachment badge doesn't blink off on a move/edit. */
export function upsertBoardCard(queryClient: QueryClient, boardId: string, card: BoardCard): void {
  patch(queryClient, boardId, (prev) => {
    const idx = prev.cards.findIndex((c) => c.id === card.id);
    if (idx === -1) return { ...prev, cards: [...prev.cards, card] };
    const existing = prev.cards[idx];
    const merged: BoardCard = {
      ...existing,
      ...card,
      attachments: card.attachments ?? existing.attachments,
      attachmentCount: card.attachmentCount ?? existing.attachmentCount,
    };
    return { ...prev, cards: prev.cards.map((c, i) => (i === idx ? merged : c)) };
  });
}

/** Remove a card from whatever board cache holds it (card ids are globally unique, so a
 *  DELETE realtime payload carrying only the id can still be applied). */
export function removeBoardCard(queryClient: QueryClient, cardId: string): void {
  queryClient.setQueriesData<BoardDetailData>({ queryKey: ['board'] }, (prev) =>
    prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) } : prev
  );
}

/** Apply a reorder: set columnId + sortOrder (= position) for the listed cards. */
export function applyCardReorder(
  queryClient: QueryClient,
  boardId: string,
  columnId: string,
  orderedCardIds: string[]
): void {
  const order = new Map(orderedCardIds.map((id, i) => [id, i] as const));
  patch(queryClient, boardId, (prev) => ({
    ...prev,
    cards: prev.cards.map((c) =>
      order.has(c.id) ? { ...c, columnId, sortOrder: order.get(c.id) as number } : c
    ),
  }));
}

export function upsertBoardColumn(
  queryClient: QueryClient,
  boardId: string,
  column: BoardColumn
): void {
  patch(queryClient, boardId, (prev) => {
    const columns = prev.board.columns ?? [];
    const idx = columns.findIndex((col) => col.id === column.id);
    const next =
      idx === -1
        ? [...columns, column]
        : columns.map((col, i) => (i === idx ? { ...col, ...column } : col));
    next.sort((a, b) => a.sortOrder - b.sortOrder);
    return { ...prev, board: { ...prev.board, columns: next } };
  });
}

/** Remove a column (and any cards left in it) from whatever board cache holds it. */
export function removeBoardColumn(queryClient: QueryClient, columnId: string): void {
  queryClient.setQueriesData<BoardDetailData>({ queryKey: ['board'] }, (prev) =>
    prev
      ? {
          ...prev,
          board: {
            ...prev.board,
            columns: (prev.board.columns ?? []).filter((c) => c.id !== columnId),
          },
          cards: prev.cards.filter((c) => c.columnId !== columnId),
        }
      : prev
  );
}

export function reorderBoardColumns(
  queryClient: QueryClient,
  boardId: string,
  columnIds: string[]
): void {
  const order = new Map(columnIds.map((id, i) => [id, i] as const));
  patch(queryClient, boardId, (prev) => {
    const columns = (prev.board.columns ?? [])
      .map((col) => (order.has(col.id) ? { ...col, sortOrder: order.get(col.id) as number } : col))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return { ...prev, board: { ...prev.board, columns } };
  });
}
