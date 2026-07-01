import React, { useState } from 'react';
import type { BoardMember, BoardMemberRole, User } from '@/core/types';

interface MemberPickerProps {
  users: User[];
  members: BoardMember[];
  ownerId: string;
  onAdd: (userId: string, role: BoardMemberRole) => void;
  onRemove: (userId: string) => void;
  onUpdateRole: (memberId: string, role: BoardMemberRole) => void;
}

const MemberPicker: React.FC<MemberPickerProps> = ({
  users,
  members,
  ownerId,
  onAdd,
  onRemove,
  onUpdateRole,
}) => {
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const memberUserIds = new Set([ownerId, ...members.map((m) => m.userId)]);
  const filteredUsers = users.filter(
    (u) =>
      !memberUserIds.has(u.id) &&
      (u.name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between rounded border border-line bg-overlay/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/30 text-xs font-medium text-primary">
              {users.find((u) => u.id === ownerId)?.initials ?? 'O'}
            </span>
            <span className="text-sm text-white">
              {users.find((u) => u.id === ownerId)?.name ?? 'Owner'}
            </span>
          </div>
          <span className="text-xs text-subtle">Owner</span>
        </div>

        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded border border-line bg-overlay/5 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-xs font-medium text-muted">
                {users.find((u) => u.id === m.userId)?.initials ?? '?'}
              </span>
              <span className="text-sm text-white">
                {m.userName ?? users.find((u) => u.id === m.userId)?.name ?? m.userEmail ?? 'User'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={m.role}
                onChange={(e) => onUpdateRole(m.id, e.target.value as BoardMemberRole)}
                className="rounded border border-line bg-transparent px-1 py-0.5 text-xs text-muted"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                onClick={() => onRemove(m.userId)}
                className="text-subtle hover:text-danger-fg"
                aria-label="Remove member"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {showSearch ? (
        <div>
          <input
            autoFocus
            className="mb-2 w-full rounded border border-line bg-overlay/5 px-3 py-1.5 text-sm text-white placeholder-subtle focus:border-primary focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
          />
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <p className="py-2 text-center text-xs text-subtle">No users found</p>
            ) : (
              filteredUsers.slice(0, 10).map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    onAdd(u.id, 'editor');
                    setSearch('');
                    setShowSearch(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-overlay/10"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-600 text-[10px] font-medium text-muted">
                    {u.initials ?? u.name?.slice(0, 2)?.toUpperCase() ?? '?'}
                  </span>
                  <span>{u.name ?? u.email}</span>
                </button>
              ))
            )}
          </div>
          <button
            onClick={() => {
              setShowSearch(false);
              setSearch('');
            }}
            className="mt-1 text-xs text-subtle hover:text-white"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <span className="material-symbols-outlined text-base">person_add</span>
          Add member
        </button>
      )}
    </div>
  );
};

export default MemberPicker;
