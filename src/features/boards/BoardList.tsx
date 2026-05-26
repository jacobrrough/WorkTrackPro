import React, { useState } from 'react';
import type { Board, ViewState } from '@/core/types';
import { useApp } from '@/AppContext';
import { useToast } from '@/Toast';
import { useBoardList } from '@/hooks/useBoardQueries';
import { useBoardMutations } from '@/hooks/useBoardMutations';
import CreateBoardModal from './components/CreateBoardModal';
import { useScrollRestore } from '@/hooks/useScrollRestore';

interface BoardListProps {
  onNavigate: (view: ViewState, id?: string) => void;
}

const VISIBILITY_BADGE: Record<string, { label: string; className: string }> = {
  private: { label: 'Private', className: 'bg-slate-600/40 text-slate-300' },
  members: { label: 'Members', className: 'bg-blue-600/40 text-blue-300' },
  everyone: { label: 'Everyone', className: 'bg-green-600/40 text-green-300' },
};

const BoardList: React.FC<BoardListProps> = ({ onNavigate }) => {
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const { ref: scrollRef, onScroll: handleScroll } = useScrollRestore<HTMLElement>('board-list');
  const { data: boards, isLoading } = useBoardList(currentUser?.id);
  const { createBoard } = useBoardMutations({ currentUser: currentUser ?? null, showToast });
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = async (data: Parameters<typeof createBoard>[0]) => {
    const board = await createBoard(data);
    if (board) {
      setShowCreate(false);
      onNavigate('board-detail', board.id);
    }
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <header className="safe-area-top flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex items-center justify-center rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Back to dashboard"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">Boards</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white"
        >
          <span className="material-symbols-outlined text-base">add</span>
          New Board
        </button>
      </header>

      <main ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 pb-20">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-slate-400">Loading boards...</p>
          </div>
        ) : !boards?.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="material-symbols-outlined mb-3 text-5xl text-slate-600">
              dashboard_customize
            </span>
            <p className="mb-1 text-slate-400">No boards yet</p>
            <p className="mb-4 text-sm text-slate-500">
              Create a board to organize tasks in columns
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Create your first board
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board: Board) => {
              const badge = VISIBILITY_BADGE[board.visibility] ?? VISIBILITY_BADGE.private;
              return (
                <button
                  key={board.id}
                  onClick={() => onNavigate('board-detail', board.id)}
                  className="flex flex-col items-start rounded-lg border border-white/10 bg-surface-dark p-4 text-left transition-colors hover:border-white/20 hover:bg-white/5"
                >
                  <div className="mb-2 flex w-full items-start justify-between">
                    <h3 className="font-semibold text-white">{board.name}</h3>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  {board.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-slate-400">{board.description}</p>
                  )}
                  <div className="mt-auto flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">view_column</span>
                      {board.columns.length} columns
                    </span>
                    {(board.memberCount ?? 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">group</span>
                        {board.memberCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {showCreate && (
        <CreateBoardModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  );
};

export default BoardList;
