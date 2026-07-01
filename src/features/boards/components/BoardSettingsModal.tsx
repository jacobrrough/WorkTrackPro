import React, { useState } from 'react';
import type { Board, BoardMember, BoardMemberRole, BoardVisibility, User } from '@/core/types';
import MemberPicker from './MemberPicker';

interface BoardSettingsModalProps {
  board: Board;
  members: BoardMember[];
  users: User[];
  onClose: () => void;
  onUpdate: (data: {
    name?: string;
    description?: string;
    visibility?: BoardVisibility;
  }) => Promise<unknown>;
  onDelete: () => Promise<void>;
  onAddMember: (userId: string, role: BoardMemberRole) => Promise<unknown>;
  onRemoveMember: (userId: string) => Promise<unknown>;
  onUpdateMemberRole: (memberId: string, role: BoardMemberRole) => Promise<unknown>;
}

const BoardSettingsModal: React.FC<BoardSettingsModalProps> = ({
  board,
  members,
  users,
  onClose,
  onUpdate,
  onDelete,
  onAddMember,
  onRemoveMember,
  onUpdateMemberRole,
}) => {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const [visibility, setVisibility] = useState(board.visibility);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasChanges =
    name !== board.name ||
    description !== (board.description ?? '') ||
    visibility !== board.visibility;

  const handleSave = async () => {
    setSaving(true);
    await onUpdate({
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface-dark p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Board Settings</h2>
          <button onClick={onClose} className="text-muted hover:text-white" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <label className="mb-1 block text-sm text-muted">Name</label>
        <input
          className="mb-4 w-full rounded border border-line bg-overlay/5 px-3 py-2 text-white focus:border-primary focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />

        <label className="mb-1 block text-sm text-muted">Description</label>
        <textarea
          className="mb-4 w-full resize-none rounded border border-line bg-overlay/5 px-3 py-2 text-white focus:border-primary focus:outline-none"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
        />

        <label className="mb-2 block text-sm text-muted">Visibility</label>
        <div className="mb-4 flex gap-2">
          {(['private', 'members', 'everyone'] as BoardVisibility[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${
                visibility === v
                  ? 'bg-primary text-on-accent'
                  : 'border border-line text-muted hover:text-white'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {visibility === 'members' && (
          <div className="mb-4">
            <label className="mb-2 block text-sm text-muted">Members</label>
            <MemberPicker
              users={users}
              members={members}
              ownerId={board.createdBy}
              onAdd={onAddMember}
              onRemove={onRemoveMember}
              onUpdateRole={onUpdateMemberRole}
            />
          </div>
        )}

        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="mb-4 w-full rounded bg-primary py-2 text-sm font-medium text-on-accent disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}

        <div className="border-t border-line pt-4">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-sm text-danger-fg">
                Delete this board? All columns, cards, and members will be removed. This cannot be
                undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await onDelete();
                  }}
                  className="rounded-lg bg-danger px-4 py-1.5 text-sm font-medium text-on-danger"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded px-4 py-1.5 text-sm text-muted hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-danger-fg hover:underline"
            >
              Delete this board
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BoardSettingsModal;
