import { useState } from 'react';
import type { Conversation } from '@/core/types';
import { ConversationItem } from './ConversationItem';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  currentUserId: string;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
}

export function ConversationList({
  conversations,
  activeConversationId,
  currentUserId,
  isLoading,
  onSelect,
  onNewConversation,
}: ConversationListProps) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? conversations.filter((c) => (c.name ?? '').toLowerCase().includes(search.toLowerCase()))
    : conversations;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-lg font-bold text-white">Messages</h2>
        <button
          type="button"
          onClick={onNewConversation}
          className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary/20 text-primary transition-colors hover:bg-primary/30"
          title="New conversation"
        >
          <span className="material-symbols-outlined text-xl">edit_square</span>
        </button>
      </div>

      <div className="px-4 py-2">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-lg text-slate-500">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full rounded-sm border border-white/10 bg-white/5 py-1.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-slate-400">Loading conversations...</p>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-600">chat_bubble</span>
            <p className="text-sm text-slate-400">
              {search ? 'No conversations found' : 'No conversations yet'}
            </p>
            {!search && (
              <button
                type="button"
                onClick={onNewConversation}
                className="mt-2 rounded-sm bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90"
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
