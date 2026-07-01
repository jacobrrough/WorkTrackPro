import type { Conversation } from '@/core/types';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  currentUserId: string;
  onClick: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ConversationItem({
  conversation,
  isActive,
  currentUserId: _currentUserId,
  onClick,
}: ConversationItemProps) {
  const displayName = conversation.name || 'Direct Message';
  const isGroup = conversation.type === 'group';
  const unread = conversation.unreadCount ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isActive
          ? 'border-l-2 border-primary bg-primary/10'
          : 'border-l-2 border-transparent hover:bg-overlay/5'
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          isGroup ? 'bg-primary/20 text-primary' : 'bg-overlay/10 text-muted'
        }`}
      >
        <span className="material-symbols-outlined text-xl">{isGroup ? 'group' : 'person'}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-white">{displayName}</span>
          <span className="shrink-0 text-xs text-subtle">{timeAgo(conversation.updatedAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted">
            {conversation.lastMessage?.decryptedContent ?? (
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">lock</span>
                Encrypted
              </span>
            )}
          </span>
          {unread > 0 && (
            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-on-accent">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
