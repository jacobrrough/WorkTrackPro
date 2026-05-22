import React, { useState, useMemo } from 'react';
import {
  DndContext,
  closestCorners,
  pointerWithin,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
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
      className={`flex min-h-[80px] flex-1 flex-col gap-2 rounded-b-lg p-2 transition-colors ${
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

  const board = data?.board ?? null;
  const { ref: boardScrollRef, onScroll: onBoardScroll } = useScrollRestore(
    `board-${boardId}`,
    { axis: 'x', ready: !isLoading && !!board }
  );

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
      map[colId].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [columns, cards]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeCard = activeCardId ? (cards.find((c) => c.id === activeCardId) ?? null) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
    setLocalCards([...cards]);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !localCards) return;

    const activeId = active.id as string;
    const overId = over.id as string;

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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || !localCards) {
      setLocalCards(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    const card = localCards.find((c) => c.id === activeId);
    if (!card) {
      setLocalCards(null);
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
      const idx = colCards.findIndex((c) => c.id === overId);
      insertIdx = idx >= 0 ? idx : colCards.length;
    }

    colCards.splice(insertIdx, 0, card);
    const orderedCardIds = colCards.map((c) => c.id);

    setLocalCards(null);
    await mutations.reorderCards(boardId, targetColumnId, orderedCardIds);
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
        <p className="text-slate-400">Loading board...</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-background-dark">
        <p className="mb-2 text-slate-400">Board not found</p>
        <button onClick={onBack} className="text-sm text-primary hover:underline">
          Back to boards
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <header className="safe-area-top flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Back to boards"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">{board.name}</h1>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
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
      >
        <div
          ref={boardScrollRef}
          onScroll={onBoardScroll}
          className="flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-4 md:snap-none md:gap-4"
        >
          {columns.map((col) => {
            const colCards = cardsByColumn[col.id] ?? [];
            return (
              <div
                key={col.id}
                className="flex w-[calc(100vw-2rem)] flex-shrink-0 snap-center flex-col rounded-lg border border-white/10 bg-surface-dark md:w-72"
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
            <div className="w-[calc(100vw-2rem)] opacity-90 md:w-72">
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
