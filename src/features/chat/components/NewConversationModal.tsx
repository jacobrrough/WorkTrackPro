import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@/core/types';
import { encryptionKeyService } from '@/services/api/encryptionKeys';

interface NewConversationModalProps {
  users: User[];
  currentUserId: string;
  onCreateDirect: (userId: string) => Promise<void>;
  onCreateGroup: (name: string, userIds: string[]) => Promise<void>;
  onClose: () => void;
}

export function NewConversationModal({
  users,
  currentUserId,
  onCreateDirect,
  onCreateGroup,
  onClose,
}: NewConversationModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [encryptionReadyIds, setEncryptionReadyIds] = useState<Set<string> | null>(null);

  const otherUsers = useMemo(
    () => users.filter((u) => u.id !== currentUserId && u.isApproved !== false),
    [users, currentUserId]
  );

  // Fetch which users have encryption keys set up
  useEffect(() => {
    const ids = otherUsers.map((u) => u.id);
    if (ids.length === 0) {
      setEncryptionReadyIds(new Set());
      return;
    }
    let cancelled = false;
    encryptionKeyService.getUserIdsWithKeys(ids).then((result) => {
      if (!cancelled) setEncryptionReadyIds(result);
    });
    return () => {
      cancelled = true;
    };
  }, [otherUsers]);

  // Only show users who have set up encryption keys
  const chatReadyUsers = useMemo(
    () => (encryptionReadyIds ? otherUsers.filter((u) => encryptionReadyIds.has(u.id)) : []),
    [otherUsers, encryptionReadyIds]
  );

  const filtered = useMemo(
    () =>
      search.trim()
        ? chatReadyUsers.filter(
            (u) =>
              (u.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
              u.email.toLowerCase().includes(search.toLowerCase())
          )
        : chatReadyUsers,
    [chatReadyUsers, search]
  );

  const handleToggleUser = useCallback((userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }, []);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'direct' && selectedIds.length === 1) {
        await onCreateDirect(selectedIds[0]);
      } else if (mode === 'group' && selectedIds.length >= 1 && groupName.trim()) {
        await onCreateGroup(groupName.trim(), [...selectedIds, currentUserId]);
      }
      onClose();
    } finally {
      setLoading(false);
    }
  }, [mode, selectedIds, groupName, currentUserId, onCreateDirect, onCreateGroup, onClose]);

  const canCreate =
    mode === 'direct'
      ? selectedIds.length === 1
      : selectedIds.length >= 1 && groupName.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-background-dark shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 className="text-lg font-bold text-white">New Conversation</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="border-b border-white/10 px-4 py-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('direct');
                setSelectedIds([]);
              }}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
                mode === 'direct'
                  ? 'bg-primary text-on-accent'
                  : 'bg-white/5 text-muted hover:text-white'
              }`}
            >
              Direct Message
            </button>
            <button
              type="button"
              onClick={() => setMode('group')}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
                mode === 'group'
                  ? 'bg-primary text-on-accent'
                  : 'bg-white/5 text-muted hover:text-white'
              }`}
            >
              Group Chat
            </button>
          </div>
        </div>

        {mode === 'group' && (
          <div className="border-b border-white/10 px-4 py-3">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-subtle focus:border-primary focus:outline-none"
            />
          </div>
        )}

        <div className="px-4 py-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-lg text-subtle">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="w-full rounded-sm border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-sm text-white placeholder-subtle focus:border-primary focus:outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto px-2 py-1">
          {encryptionReadyIds === null && (
            <p className="py-4 text-center text-sm text-subtle">Loading users...</p>
          )}
          {encryptionReadyIds !== null && filtered.length === 0 && (
            <div className="py-4 text-center">
              <p className="text-sm text-subtle">
                {search ? 'No users found' : 'No users available for chat'}
              </p>
              {!search && otherUsers.length > chatReadyUsers.length && (
                <p className="mt-1 text-xs text-subtle">
                  {otherUsers.length - chatReadyUsers.length} user(s) haven't set up encryption yet.
                  They need to log in and visit Chat first.
                </p>
              )}
            </div>
          )}
          {filtered.map((user) => {
            const isSelected = selectedIds.includes(user.id);
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  if (mode === 'direct') {
                    setSelectedIds([user.id]);
                  } else {
                    handleToggleUser(user.id);
                  }
                }}
                className={`flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors ${
                  isSelected ? 'bg-primary/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-muted">
                  {user.initials ?? user.name?.charAt(0) ?? '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{user.name ?? user.email}</p>
                  {user.name && <p className="truncate text-xs text-subtle">{user.email}</p>}
                </div>
                {isSelected && (
                  <span className="material-symbols-outlined text-lg text-primary">
                    check_circle
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-4 py-2 text-sm text-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || loading}
            className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-on-accent hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Creating...' : mode === 'direct' ? 'Start Chat' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}
