import React, { useState, useRef, useEffect } from 'react';
import type { BoardColumn } from '@/core/types';

const COLUMN_COLORS = [
  'bg-pink-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-green-500',
  'bg-emerald-600',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-blue-500',
  'bg-purple-500',
  'bg-gray-500',
];

interface BoardColumnHeaderProps {
  column: BoardColumn;
  cardCount: number;
  readOnly?: boolean;
  onRename: (name: string) => void;
  onChangeColor: (color: string) => void;
  onDelete: () => void;
}

const BoardColumnHeader: React.FC<BoardColumnHeaderProps> = ({
  column,
  cardCount,
  readOnly,
  onRename,
  onChangeColor,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!showMenu) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowColors(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showMenu]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== column.name) onRename(trimmed);
    else setEditName(column.name);
  };

  return (
    <div className="mb-2 flex items-center gap-2">
      <div className={`h-3 w-3 flex-shrink-0 rounded-full ${column.color ?? 'bg-slate-500'}`} />
      {editing && !readOnly ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-primary bg-transparent px-1 text-sm font-semibold text-white focus:outline-none"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setEditName(column.name);
              setEditing(false);
            }
          }}
          maxLength={40}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-white"
          onDoubleClick={() => !readOnly && setEditing(true)}
        >
          {column.name}
        </span>
      )}
      <span className="text-xs text-slate-500">{cardCount}</span>
      {!readOnly && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="flex items-center justify-center rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white"
            aria-label="Column options"
          >
            <span className="material-symbols-outlined text-base">more_vert</span>
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded border border-white/10 bg-surface-dark py-1 shadow-lg">
              <button
                onClick={() => {
                  setShowMenu(false);
                  setEditing(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-white/10"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                Rename
              </button>
              <button
                onClick={() => setShowColors((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-white/10"
              >
                <span className="material-symbols-outlined text-base">palette</span>
                Color
              </button>
              {showColors && (
                <div className="flex flex-wrap gap-1.5 px-3 py-2">
                  {COLUMN_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        onChangeColor(c);
                        setShowColors(false);
                        setShowMenu(false);
                      }}
                      className={`h-5 w-5 rounded-full ${c} ${
                        column.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-dark' : ''
                      }`}
                    />
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  setShowMenu(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-white/10"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                Delete column
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BoardColumnHeader;
