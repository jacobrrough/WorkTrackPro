import { useState, useRef, useCallback, useEffect } from 'react';
import type { Comment, User } from '@/core/types';

interface JobCommentsProps {
  comments: Comment[];
  currentUser: User;
  newComment: string;
  setNewComment: (value: string) => void;
  isSubmitting: boolean;
  onSubmitComment: () => void;
  editingCommentId: string | null;
  editingCommentText: string;
  setEditingCommentId: (id: string | null) => void;
  setEditingCommentText: (value: string) => void;
  onUpdateComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  formatCommentTime: (timestamp: string) => string;
  users?: User[];
}

function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows,
  users,
  currentUserId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  users: User[];
  currentUserId: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const otherUsers = users.filter((u) => u.id !== currentUserId && u.isApproved !== false);
  const filteredUsers = mentionQuery
    ? otherUsers.filter((u) =>
        (u.name ?? u.email).toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : otherUsers;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      const cursorPos = e.target.selectionStart ?? text.length;
      onChange(text);

      const textBeforeCursor = text.slice(0, cursorPos);
      const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);
      if (atMatch) {
        setShowDropdown(true);
        setMentionQuery(atMatch[1]);
        setMentionStart(cursorPos - atMatch[0].length);
        setSelectedIndex(0);
      } else {
        setShowDropdown(false);
      }
    },
    [onChange]
  );

  const insertMention = useCallback(
    (user: User) => {
      const name = user.name ?? user.email;
      const before = value.slice(0, mentionStart);
      const after = value.slice(mentionStart + mentionQuery.length + 1);
      const newValue = `${before}@${name}${after ? after : ' '}`;
      onChange(newValue);
      setShowDropdown(false);
      textareaRef.current?.focus();
    },
    [value, mentionStart, mentionQuery, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || filteredUsers.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredUsers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredUsers[selectedIndex]);
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    },
    [showDropdown, filteredUsers, selectedIndex, insertMention]
  );

  useEffect(() => {
    if (!showDropdown) return;
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [showDropdown]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-subtle"
        rows={rows}
      />
      {showDropdown && filteredUsers.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 z-50 mb-1 max-h-40 w-56 overflow-y-auto rounded-lg border border-line bg-app-2 shadow-xl"
        >
          {filteredUsers.slice(0, 8).map((user, i) => (
            <button
              key={user.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(user);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                i === selectedIndex ? 'bg-primary/20 text-white' : 'text-muted hover:bg-white/5'
              }`}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-[10px] font-bold text-white">
                {user.initials || '?'}
              </div>
              <span className="truncate">{user.name ?? user.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderCommentText(text: string): React.ReactNode {
  const parts = text.split(/(@\w[\w\s]*\w|@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function JobComments({
  comments,
  currentUser,
  newComment,
  setNewComment,
  isSubmitting,
  onSubmitComment,
  editingCommentId,
  editingCommentText,
  setEditingCommentId,
  setEditingCommentText,
  onUpdateComment,
  onDeleteComment,
  formatCommentTime,
  users = [],
}: JobCommentsProps) {
  return (
    <div className="p-3 pt-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        <span className="material-symbols-outlined text-lg text-primary">chat</span>
        Comments ({comments.length})
      </h3>

      <div className="mb-3 rounded-lg bg-surface-2 p-3">
        <div className="flex gap-2">
          <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-on-accent">
            {currentUser.initials}
          </div>
          <div className="flex-1">
            <MentionTextarea
              value={newComment}
              onChange={setNewComment}
              placeholder="Write a comment... Use @ to mention"
              rows={2}
              users={users}
              currentUserId={currentUser.id}
            />
            <div className="flex justify-end">
              <button
                onClick={onSubmitComment}
                disabled={!newComment.trim() || isSubmitting}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-accent disabled:opacity-50"
              >
                {isSubmitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {comments.map((comment) => {
          const isOwnComment = comment.user === currentUser.id;
          const canEdit = isOwnComment || currentUser.isAdmin;
          const isEditingThis = editingCommentId === comment.id;

          const timestamp =
            (comment as Comment & { created?: string; timestamp?: string }).created ||
            (comment as Comment & { created?: string; timestamp?: string }).timestamp ||
            comment.createdAt;

          return (
            <div key={comment.id} className="rounded-lg bg-surface-2 p-3">
              <div className="flex items-start gap-2">
                <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-600 text-xs font-bold text-white">
                  {comment.userInitials || 'U'}
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{comment.userName || 'User'}</p>
                      <p className="text-xs text-subtle">{formatCommentTime(timestamp)}</p>
                    </div>
                    {canEdit && !isEditingThis && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setEditingCommentId(comment.id);
                            setEditingCommentText(comment.text);
                          }}
                          className="p-1 text-muted hover:text-primary"
                          title="Edit comment"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                        <button
                          onClick={() => onDeleteComment(comment.id)}
                          className="p-1 text-muted hover:text-red-500"
                          title="Delete comment"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingThis ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingCommentText}
                        onChange={(e) => setEditingCommentText(e.target.value)}
                        className="w-full resize-none rounded border border-primary/30 bg-app-2 p-2 text-sm text-white outline-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingCommentText('');
                          }}
                          className="rounded px-3 py-1 text-xs font-bold text-muted hover:bg-surface-3"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => onUpdateComment(comment.id)}
                          disabled={!editingCommentText.trim()}
                          className="rounded bg-primary px-3 py-1 text-xs font-bold text-on-accent disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{renderCommentText(comment.text)}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {comments.length === 0 && (
          <p className="py-4 text-center text-sm text-subtle">No comments yet</p>
        )}
      </div>
    </div>
  );
}
