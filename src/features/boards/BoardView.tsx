import React, { useState, useMemo } from 'react';
import {
  DndContext,
  closestCorners,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
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

interface BoardViewProps {
  boardId: string;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack: () => void;
}

function DroppableColumn({
  column,
  children,
}: {
  column: BoardColumn;
  children: React.ReactNode;
}) {
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

const BoardView: React.FC<BoardViewProps> = ({ boardId, onBack }) => {
  const { currentUser, users } = useApp();
  const { showToast } = useToast();
  const { data, isLoading } = useBoardDetail(boardId);
  const mutations = useBoardMutations({ currentUser: currentUser ?? null, showToast });

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<BoardCard | null>(null);
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [localCards, setLocalCards] = useState<BoardCard[] | null>(null);

  const board = data?.board ?? null;
  const cards = localCards ?? data?.cards ?? [];
  const members = data?.members ?? [];
  const columns = board?.columns ?? [];

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeCard = activeCardId ? cards.find((c) => c.id === activeCardId) ?? null : null;

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
      const updated = [...localCards];
      updated[activeIdx] = { ...updated[activeIdx], columnId: targetColumnId };
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
    }

    const colCards = localCards
      .filter((c) => c.columnId === targetColumnId && c.id !== activeId);
    const overIdx = overId.startsWith('col-')
      ? colCards.length
      : colCards.findIndex((c) => c.id === overId);
    const sortOrder = overIdx >= 0 ? overIdx : colCards.length;

    setLocalCards(null);
    await mutations.moveCard(boardId, activeId, { columnId: targetColumnId, sortOrder });
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
    setEditingCard(null);
  };

  const handleDeleteCard = async () => {
    if (!editingCard) return;
    await mutations.deleteCard(boardId, editingCard.id);
    setEditingCard(null);
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
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto p-4">
          {columns.map((col) => {
            const colCards = cardsByColumn[col.id] ?? [];
            return (
              <div
                key={col.id}
                className="flex w-72 flex-shrink-0 flex-col rounded-lg border border-white/10 bg-surface-dark"
              >
                <div className="p-3 pb-0">
                  <BoardColumnHeader
                    column={col}
                    cardCount={colCards.length}
                    readOnly={readOnly}
                    onRename={(name) =>
                      mutations.updateColumn(boardId, col.id, { name })
                    }
                    onChangeColor={(color) =>
                      mutations.updateColumn(boardId, col.id, { color })
                    }
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
                        onClick={() => !readOnly && setEditingCard(card)}
                      />
                    ))}
                  </DroppableColumn>
                </SortableContext>
                {!readOnly && (
                  <button
                    onClick={() => setAddingToColumn(col.id)}
                    className="m-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-white/5 hover:text-slate-300"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Add card
                  </button>
                )}
              </div>
            );
          })}
          {!readOnly && <AddColumnButton onAdd={handleAddColumn} />}
        </div>

        <DragOverlay>
          {activeCard && (
            <div className="w-72 opacity-90">
              <BoardCardItem
                card={activeCard}
                users={users}
                readOnly
                onClick={() => {}}
              />
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
          onClose={() => setEditingCard(null)}
          onSave={handleUpdateCard}
          onDelete={handleDeleteCard}
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
