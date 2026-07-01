import React, { useState, useMemo, useRef } from 'react';
import {
  DndContext,
  closestCorners,
  pointerWithin,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragCancelEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { BoardCard, BoardColumn, ViewState } from '@/core/types';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import { useBoardDetail } from '@/hooks/useBoardQueries';
import { useBoardMutations } from '@/hooks/useBoardMutations';
import BoardCardItem from './components/BoardCardItem';
import BoardColumnHeader from './components/BoardColumnHeader';
import AddColumnButton from './components/AddColumnButton';
import CardEditorModal, { type CardSaveData } from './components/CardEditorModal';
import BoardSettingsModal from './components/BoardSettingsModal';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import { useDirectionalBoardScroll } from '@/hooks/useDirectionalBoardScroll';
import { useViewportWidth } from '@/hooks/useViewportWidth';

interface BoardViewProps {
  boardId: string;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack: () => void;
}

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};

function DroppableColumn({ column, children }: { column: BoardColumn; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.id}` });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain rounded-b-lg p-2 transition-colors ${
        isOver ? 'bg-primary/5' : ''
      }`}
    >
      {children}
    </div>
  );
}

const BoardView: React.FC<BoardViewProps> = ({ boardId, onNavigate, onBack }) => {
  const { currentUser, users } = useApp();
  const { showToast } = useToast();
  const { data, isLoading } = useBoardDetail(boardId);
  const mutations = useBoardMutations({ currentUser: currentUser ?? null, showToast });

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [localCards, setLocalCards] = useState<BoardCard[] | null>(null);
  const dragStartColumnRef = useRef<string | null>(null);
  // Last over target seen during dragOver. On mobile, dnd-kit can report `over === null`
  // at the release frame if the finger drifts off a droppable; we fall back to this so
  // the drop honors the preview the user just saw instead of snapping back.
  const lastOverIdRef = useRef<string | null>(null);
  // Drop generation: each drop increments this; the finally only clears optimistic state
  // if no newer drop has run, so rapid sequential drags don't clobber each other.
  const dropGenerationRef = useRef(0);

  const board = data?.board ?? null;
  const { ref: boardScrollRef, onScroll: onBoardScroll } = useScrollRestore(`board-${boardId}`, {
    axis: 'x',
    ready: !isLoading && !!board,
  });

  // Tablet/desktop is multi-column (md:snap-none); route swipe-over-a-column gestures by
  // direction so left/right scrolls the board and up/down scrolls the column. Phone width
  // keeps native one-column snap swiping. Disabled while a card is being dragged as a
  // safety net (touch drags already go through TouchSensor's 200ms press, not a quick swipe).
  const isMultiColumn = useViewportWidth() >= 768;
  useDirectionalBoardScroll(boardScrollRef, isMultiColumn && !!board && !activeCardId);

  const dataCards = data?.cards;
  const cards = useMemo(() => localCards ?? dataCards ?? [], [localCards, dataCards]);
  const members = data?.members ?? [];
  const boardColumns = board?.columns;
  const columns = useMemo(() => boardColumns ?? [], [boardColumns]);

  // Keep editor reactive: look up the current card by id so attachments
  // refresh after upload/delete.
  const editingCard = editingCardId
    ? ((data?.cards ?? []).find((c) => c.id === editingCardId) ?? null)
    : null;

  const isOwner = board?.createdBy === currentUser?.id;
  const memberEntry = members.find((m) => m.userId === currentUser?.id);
  const readOnly = !isOwner && memberEntry?.role === 'viewer';

  const cardsByColumn = useMemo(() => {
    const map: Record<string, BoardCard[]> = {};
    for (const col of columns) map[col.id] = [];
    for (const card of cards) {
      if (map[card.columnId]) map[card.columnId].push(card);
    }
    for (const colId of Object.keys(map)) {
      // Multi-key sort so display order stays deterministic when sort_order values
      // collide (cross-column moves can leave duplicate sort_orders). Tiebreak on
      // createdAt (optional → guard with ?? '') then the always-present id.
      map[colId].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
          a.id.localeCompare(b.id)
      );
    }
    return map;
  }, [columns, cards]);

  // MouseSensor (not PointerSensor) so touch is governed solely by TouchSensor's 200ms
  // press-and-hold. That keeps a quick horizontal finger-swipe free to scroll the board
  // instead of being hijacked into a card drag (which PointerSensor would do with no delay).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  const activeCard = activeCardId ? (cards.find((c) => c.id === activeCardId) ?? null) : null;

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = event.active.id as string;
    setActiveCardId(activeId);
    setLocalCards([...cards]);
    dragStartColumnRef.current = cards.find((c) => c.id === activeId)?.columnId ?? null;
    // Clear any stale value from a previous drag's last dragOver. If this new drag fires
    // no dragOver events (instant tap-drop), the fallback in dragEnd must not pick up the
    // previous drag's target.
    lastOverIdRef.current = null;
    // Bump the drop generation so any in-flight prior drop's `finally` sees a mismatch
    // and skips its cleanup — otherwise it would `resetDragState()` mid-drag and wipe
    // this new drag's optimistic state.
    dropGenerationRef.current++;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !localCards) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    lastOverIdRef.current = overId;

    const activeIdx = localCards.findIndex((c) => c.id === activeId);
    if (activeIdx === -1) return;

    let targetColumnId: string;
    if (overId.startsWith('col-')) {
      targetColumnId = overId.replace('col-', '');
    } else {
      const overCard = localCards.find((c) => c.id === overId);
      if (!overCard) return;
      targetColumnId = overCard.columnId;
    }

    if (localCards[activeIdx].columnId !== targetColumnId) {
      const updated = localCards.filter((c) => c.id !== activeId);
      const movedCard = { ...localCards[activeIdx], columnId: targetColumnId };

      if (overId.startsWith('col-')) {
        updated.push(movedCard);
      } else {
        const overIdx = updated.findIndex((c) => c.id === overId);
        if (overIdx === -1) {
          updated.push(movedCard);
        } else {
          updated.splice(overIdx, 0, movedCard);
        }
      }

      setLocalCards(updated);
    }
  };

  const resetDragState = () => {
    setLocalCards(null);
    dragStartColumnRef.current = null;
    lastOverIdRef.current = null;
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveCardId(null);
    resetDragState();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!localCards) {
      resetDragState();
      return;
    }

    // Mobile fallback: if dnd-kit lost track of `over` at the release frame (common when
    // a finger drifts a few pixels off any droppable at touch-end), honor the last over
    // seen during dragOver so the drop lands where the preview was showing.
    const activeId = active.id as string;
    const overId = (over?.id as string | undefined) ?? lastOverIdRef.current;
    if (!overId) {
      resetDragState();
      return;
    }

    // Drop on self: no reorder. Without this guard, `colCards.findIndex(overId)` returns -1
    // (active was filtered out) and the card silently snaps to the column's end.
    if (activeId === overId) {
      resetDragState();
      return;
    }

    const card = localCards.find((c) => c.id === activeId);
    if (!card) {
      resetDragState();
      return;
    }

    let targetColumnId = card.columnId;
    if (overId.startsWith('col-')) {
      targetColumnId = overId.replace('col-', '');
    } else {
      const overCard = localCards.find((c) => c.id === overId);
      if (overCard) targetColumnId = overCard.columnId;
    }

    const colCards = localCards.filter((c) => c.columnId === targetColumnId && c.id !== activeId);

    let insertIdx: number;
    if (overId.startsWith('col-')) {
      insertIdx = colCards.length;
    } else {
      const overIdxFiltered = colCards.findIndex((c) => c.id === overId);
      insertIdx = overIdxFiltered >= 0 ? overIdxFiltered : colCards.length;

      // Within-column downward drag: filtering out the active card shifted the over card's
      // index up by 1. Insert AFTER the over card so it lands where the user dropped it,
      // matching standard sortable behavior. Cross-column moves don't need this adjustment.
      const isWithinColumn = dragStartColumnRef.current === targetColumnId;
      if (isWithinColumn && overIdxFiltered >= 0) {
        const originalCol = localCards.filter((c) => c.columnId === targetColumnId);
        const originalActiveIdx = originalCol.findIndex((c) => c.id === activeId);
        const originalOverIdx = originalCol.findIndex((c) => c.id === overId);
        if (originalActiveIdx >= 0 && originalActiveIdx < originalOverIdx) {
          insertIdx = overIdxFiltered + 1;
        }
      }
    }

    colCards.splice(insertIdx, 0, card);
    const orderedCardIds = colCards.map((c) => c.id);

    // Commit the new order to localCards so the optimistic render (after the DragOverlay
    // disappears) shows the card in its dropped slot — not its pre-drag slot. Without this,
    // within-column reorders snap back to the old position until the server refetch lands.
    const reorderedColCards = colCards.map((c, i) => ({
      ...c,
      columnId: targetColumnId,
      sortOrder: i,
    }));
    setLocalCards([
      ...localCards.filter((c) => c.columnId !== targetColumnId && c.id !== activeId),
      ...reorderedColCards,
    ]);

    // Second bump claims this drop's slot. (The first bump happens in handleDragStart to
    // invalidate any prior in-flight drop's `finally`.) Subsequent drags or drops bump
    // further so this drop's `finally` knows it's stale.
    const myGen = ++dropGenerationRef.current;
    try {
      const ok = await mutations.reorderCards(boardId, targetColumnId, orderedCardIds);
      // Only toast if this is still the latest drop. A newer drop's payload includes this
      // one's intent (it was built on this drop's optimistic state), so a failed-but-applied
      // toast would mislead the user.
      if (!ok && dropGenerationRef.current === myGen) {
        showToast('Could not save reorder', 'error');
      }
    } catch {
      if (dropGenerationRef.current === myGen) {
        showToast('Could not save reorder', 'error');
      }
    } finally {
      // Only clear if no newer drop has started; otherwise we'd wipe the next drop's
      // optimistic state and flash the user's previous drag away mid-flight.
      if (dropGenerationRef.current === myGen) resetDragState();
    }
  };

  const handleAddColumn = async (name: string) => {
    await mutations.addColumn(boardId, {
      name,
      sortOrder: columns.length,
    });
  };

  const handleAddCard = async (data: CardSaveData) => {
    if (!addingToColumn) return;
    const colCards = cardsByColumn[addingToColumn] ?? [];
    await mutations.addCard({
      boardId,
      columnId: addingToColumn,
      sortOrder: colCards.length,
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId ?? undefined,
      dueDate: data.dueDate ?? undefined,
      color: data.color ?? undefined,
    });
    setAddingToColumn(null);
  };

  const handleUpdateCard = async (data: CardSaveData) => {
    if (!editingCard) return;
    await mutations.updateCard(boardId, editingCard.id, data);
    setEditingCardId(null);
  };

  const handleDeleteCard = async () => {
    if (!editingCard) return;
    await mutations.deleteCard(boardId, editingCard.id);
    setEditingCardId(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background-dark">
        <p className="text-muted">Loading board...</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-background-dark">
        <p className="mb-2 text-muted">Board not found</p>
        <button onClick={onBack} className="text-sm text-primary hover:underline">
          Back to boards
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <header className="safe-area-top flex items-center justify-between border-b border-line bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"
            aria-label="Back to boards"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">{board.name}</h1>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-white"
            aria-label="Board settings"
          >
            <span className="material-symbols-outlined text-xl">settings</span>
          </button>
        )}
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={boardScrollRef}
          onScroll={onBoardScroll}
          className="flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none md:gap-4"
        >
          {columns.map((col) => {
            const colCards = cardsByColumn[col.id] ?? [];
            return (
              // min-h-0 makes the stretched column height an explicit bound so the card
              // list's `overflow-y-auto` actually scrolls. Without it, scroll silently
              // relies on the flex container's default align-items:stretch.
              <div
                key={col.id}
                className="flex min-h-0 w-[calc(100vw-2rem)] flex-shrink-0 snap-center flex-col rounded-lg border border-line bg-surface-dark md:w-72"
              >
                <div className="p-3 pb-0">
                  <BoardColumnHeader
                    column={col}
                    cardCount={colCards.length}
                    readOnly={readOnly}
                    onAddCard={() => setAddingToColumn(col.id)}
                    onRename={(name) => mutations.updateColumn(boardId, col.id, { name })}
                    onChangeColor={(color) => mutations.updateColumn(boardId, col.id, { color })}
                    onDelete={() => mutations.deleteColumn(boardId, col.id)}
                  />
                </div>
                <SortableContext
                  items={colCards.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <DroppableColumn column={col}>
                    {colCards.map((card) => (
                      <BoardCardItem
                        key={card.id}
                        card={card}
                        users={users}
                        readOnly={readOnly}
                        onClick={() => onNavigate('board-card-detail', `${boardId}:${card.id}`)}
                      />
                    ))}
                  </DroppableColumn>
                </SortableContext>
              </div>
            );
          })}
          {!readOnly && <AddColumnButton onAdd={handleAddColumn} />}
        </div>

        <DragOverlay>
          {activeCard && (
            // Width matches the card's rendered size in the column (column width minus
            // the DroppableColumn's p-2 = 16px). If the overlay is wider, the card visually
            // jumps to a larger size at drag-start, which reads as "off-center" from the cursor.
            <div className="w-[calc(100vw-3rem)] opacity-90 md:w-[17rem]">
              <BoardCardItem card={activeCard} users={users} readOnly onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {addingToColumn && (
        <CardEditorModal
          users={users}
          onClose={() => setAddingToColumn(null)}
          onSave={handleAddCard}
        />
      )}

      {editingCard && (
        <CardEditorModal
          card={editingCard}
          users={users}
          canManageAttachments={!readOnly}
          onClose={() => setEditingCardId(null)}
          onSave={handleUpdateCard}
          onDelete={handleDeleteCard}
          onUploadAttachment={(cardId, file) => mutations.addCardAttachment(boardId, cardId, file)}
          onDeleteAttachment={(attachmentId) =>
            mutations.deleteCardAttachment(boardId, attachmentId)
          }
        />
      )}

      {showSettings && board && (
        <BoardSettingsModal
          board={board}
          members={members}
          users={users}
          onClose={() => setShowSettings(false)}
          onUpdate={(data) => mutations.updateBoard(boardId, data)}
          onDelete={async () => {
            await mutations.deleteBoard(boardId);
            onBack();
          }}
          onAddMember={(userId, role) => mutations.addMember(boardId, userId, role)}
          onRemoveMember={(userId) => mutations.removeMember(boardId, userId)}
          onUpdateMemberRole={(memberId, role) =>
            mutations.updateMemberRole(boardId, memberId, role)
          }
        />
      )}
    </div>
  );
};

export default BoardView;
