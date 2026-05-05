import React, { useState } from 'react';
import type { BoardVisibility } from '@/core/types';

interface CreateBoardModalProps {
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description?: string;
    visibility: BoardVisibility;
  }) => Promise<unknown>;
}

const VISIBILITY_OPTIONS: { value: BoardVisibility; label: string; desc: string }[] = [
  { value: 'private', label: 'Private', desc: 'Only you can see this board' },
  { value: 'members', label: 'Members', desc: 'Invite specific people' },
  { value: 'everyone', label: 'Everyone', desc: 'All team members can see this board' },
];

const CreateBoardModal: React.FC<CreateBoardModalProps> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<BoardVisibility>('private');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-white/10 bg-surface-dark p-6"
      >
        <h2 className="mb-4 text-lg font-semibold text-white">New Board</h2>

        <label className="mb-1 block text-sm text-slate-400">Name</label>
        <input
          autoFocus
          className="mb-4 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Board name"
          maxLength={100}
        />

        <label className="mb-1 block text-sm text-slate-400">Description (optional)</label>
        <textarea
          className="mb-4 w-full resize-none rounded border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this board for?"
          maxLength={300}
        />

        <label className="mb-2 block text-sm text-slate-400">Visibility</label>
        <div className="mb-6 space-y-2">
          {VISIBILITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded border px-3 py-2 transition-colors ${
                visibility === opt.value
                  ? 'border-primary bg-primary/10 text-white'
                  : 'border-white/10 text-slate-400 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                value={opt.value}
                checked={visibility === opt.value}
                onChange={() => setVisibility(opt.value)}
                className="accent-primary"
              />
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-slate-500">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Board'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateBoardModal;
