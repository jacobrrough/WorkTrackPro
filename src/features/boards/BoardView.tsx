import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCorners,
  DragOverlay,
  PointerSensor,
  TouchSensor,
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

  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const localCardsRef = useRef<BoardCard[] | null>(null);
  const [moveMenuCardId, setMoveMenuCardId] = useState<string | null>(null);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobile = viewportWidth < 768;
  const supportsFinePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const canDrag = !isMobile && supportsFinePointer;

  const columnWidth = useMemo(() => {
    if (isMobile) return Math.max(280, Math.min(460, viewportWidth - 32));
    return 288;
  }, [isMobile, viewportWidth]);

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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const activeCard = activeCardId ? (cards.find((c) => c.id === activeCardId) ?? null) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
    const snapshot = [...cards];
    setLocalCards(snapshot);
    localCardsRef.current = snapshot;
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
      localCardsRef.current = updated;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    const currentLocal = localCardsRef.current;
    localCardsRef.current = null;

    if (!over || !currentLocal) {
      setLocalCards(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    let targetColumnId: string;
    if (overId.startsWith('col-')) {
      targetColumnId = overId.replace('col-', '');
    } else {
      const overCard = currentLocal.find((c) => c.id === overId);
      if (overCard) {
        targetColumnId = overCard.columnId;
      } else {
        const draggedCard = currentLocal.find((c) => c.id === activeId);
        targetColumnId = draggedCard?.columnId ?? '';
      }
    }

    if (!targetColumnId) {
      setLocalCards(null);
      return;
    }

    const colCards = currentLocal.filter(
      (c) => c.columnId === targetColumnId && c.id !== activeId
    );
    const overIdx = overId.startsWith('col-')
      ? colCards.length
      : colCards.findIndex((c) => c.id === overId);
    const sortOrder = overIdx >= 0 ? overIdx : colCards.length;

    setLocalCards(null);
    await mutations.moveCard(boardId, activeId, { columnId: targetColumnId, sortOrder });
  };

  const handleMoveCard = async (cardId: string, targetColumnId: string) => {
    setMoveMenuCardId(null);
    const colCards = cards.filter((c) => c.columnId === targetColumnId);
    await mutations.moveCard(boardId, cardId, {
      columnId: targetColumnId,
      sortOrder: colCards.length,
    });
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
        collisionDetection={closestCorners}
        onDragStart={canDrag ? handleDragStart : undefined}
        onDragOver={canDrag ? handleDragOver : undefined}
        onDragEnd={canDrag ? handleDragEnd : undefined}
      >
        <div
          className="flex min-h-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden p-4 md:snap-none"
          style={{
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-x',
            overscrollBehavior: 'contain',
          }}
        >
          {columns.map((col) => {
            const colCards = cardsByColumn[col.id] ?? [];
            return (
              <div
                key={col.id}
                className="flex shrink-0 snap-center flex-col rounded-lg border border-white/10 bg-surface-dark"
                style={{ width: columnWidth, minWidth: columnWidth }}
              >
                <div className="p-3 pb-0">
                  <BoardColumnHeader
                    column={col}
                    cardCount={colCards.length}
                    readOnly={readOnly}
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
                      <div key={card.id} className="relative">
                        <BoardCardItem
                          card={card}
                          users={users}
                          readOnly={readOnly || !canDrag}
                          onClick={() => onNavigate('board-card-detail', `${boardId}:${card.id}`)}
                        />
                        {!readOnly && !canDrag && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMoveMenuCardId(
                                moveMenuCardId === card.id ? null : card.id
                              );
                            }}
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-white/10 text-slate-400 hover:bg-white/20 hover:text-white"
                            aria-label="Move card"
                          >
                            <span className="material-symbols-outlined text-sm">
                              swap_horiz
                            </span>
                          </button>
                        )}
                        {moveMenuCardId === card.id && (
                          <div className="absolute right-0 top-8 z-50 min-w-[140px] rounded border border-white/20 bg-[#2a1f35] py-1 shadow-xl">
                            {columns
                              .filter((c) => c.id !== col.id)
                              .map((targetCol) => (
                                <button
                                  key={targetCol.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveCard(card.id, targetCol.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-white hover:bg-white/10"
                                >
                                  <span className="material-symbols-outlined text-sm">
                                    arrow_forward
                                  </span>
                                  {targetCol.name}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
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
            <div style={{ width: columnWidth }} className="opacity-90">
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
