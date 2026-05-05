import React, { useState } from 'react';
import type { BoardCard, User } from '@/core/types';

const CARD_COLORS = [
  'bg-pink-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-green-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-blue-500',
  'bg-purple-500',
];

export interface CardSaveData {
  title: string;
  description?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  color?: string | null;
}

interface CardEditorModalProps {
  card?: BoardCard;
  users: User[];
  onClose: () => void;
  onSave: (data: CardSaveData) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}

const CardEditorModal: React.FC<CardEditorModalProps> = ({
  card,
  users,
  onClose,
  onSave,
  onDelete,
}) => {
  const isEdit = !!card;
  const [title, setTitle] = useState(card?.title ?? '');
  const [description, setDescription] = useState(card?.description ?? '');
  const [assigneeId, setAssigneeId] = useState<string>(card?.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '');
  const [color, setColor] = useState(card?.color ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeId: assigneeId || null,
      dueDate: dueDate || null,
      color: color || null,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-white/10 bg-surface-dark p-6"
      >
        <h2 className="mb-4 text-lg font-semibold text-white">
          {isEdit ? 'Edit Card' : 'New Card'}
        </h2>

        <label className="mb-1 block text-sm text-slate-400">Title</label>
        <input
          autoFocus
          className="mb-4 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Card title"
          maxLength={200}
        />

        <label className="mb-1 block text-sm text-slate-400">Description</label>
        <textarea
          className="mb-4 w-full resize-none rounded border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add details..."
          maxLength={2000}
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Assignee</label>
            <select
              className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Due date</label>
            <input
              type="date"
              className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <label className="mb-1 block text-sm text-slate-400">Label color</label>
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setColor('')}
            className={`flex h-6 w-6 items-center justify-center rounded-full border border-white/20 ${
              !color ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-dark' : ''
            }`}
          >
            <span className="material-symbols-outlined text-xs text-slate-400">close</span>
          </button>
          {CARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full ${c} ${
                color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-dark' : ''
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div>
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-sm text-red-400 hover:underline"
              >
                Delete card
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Add Card'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CardEditorModal;
