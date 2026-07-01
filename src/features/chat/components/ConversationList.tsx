import { useState } from 'react';
import type { Conversation } from '@/core/types';
import { useUnreadNotificationCount } from '@/hooks/useSystemNotifications';
import { ConversationItem } from './ConversationItem';

export const SYSTEM_NOTIFICATIONS_ID = '__system_notifications__';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  currentUserId: string;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onBack?: () => void;
}

export function ConversationList({
  conversations,
  activeConversationId,
  currentUserId,
  isLoading,
  onSelect,
  onNewConversation,
  onBack,
}: ConversationListProps) {
  const [search, setSearch] = useState('');

  const { data: unreadCount } = useUnreadNotificationCount(true);

  const filtered = search.trim()
    ? conversations.filter((c) => (c.name ?? '').toLowerCase().includes(search.toLowerCase()))
    : conversations;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-overlay/10 hover:text-white md:flex"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
          )}
          <h2 className="text-lg font-bold text-white">Messages</h2>
        </div>
        <button
          type="button"
          onClick={onNewConversation}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary transition-colors hover:bg-primary/30"
          title="New conversation"
        >
          <span className="material-symbols-outlined text-xl">edit_square</span>
        </button>
      </div>

      <div className="px-4 py-2">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-lg text-subtle">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full rounded-lg border border-line bg-overlay/5 py-1.5 pl-9 pr-3 text-sm text-white placeholder-subtle focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Pinned system notifications entry */}
        <button
          type="button"
          onClick={() => onSelect(SYSTEM_NOTIFICATIONS_ID)}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
            activeConversationId === SYSTEM_NOTIFICATIONS_ID
              ? 'border-l-2 border-primary bg-primary/10'
              : 'border-l-2 border-transparent hover:bg-overlay/5'
          }`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
            <span className="material-symbols-outlined text-xl">notifications</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-white">Notifications</span>
              {(unreadCount ?? 0) > 0 && (
                <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-on-accent">
                  {(unreadCount ?? 0) > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <span className="truncate text-xs text-muted">System alerts &amp; mentions</span>
          </div>
        </button>

        <div className="mx-4 border-b border-line/60" />

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted">Loading conversations...</p>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-subtle">chat_bubble</span>
            <p className="text-sm text-muted">
              {search ? 'No conversations found' : 'No conversations yet'}
            </p>
            {!search && (
              <button
                type="button"
                onClick={onNewConversation}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-accent hover:bg-primary/90"
              >
                Start a conversation
              </button>
            )}
          </div>
        )}

        {filtered.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeConversationId}
            currentUserId={currentUserId}
            onClick={() => onSelect(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}
