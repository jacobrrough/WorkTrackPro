import type { Conversation, ConversationMember } from '@/core/types';

interface ChatHeaderProps {
  conversation: Conversation;
  members: ConversationMember[];
  currentUserId: string;
  onlineUserIds?: Set<string>;
  onBack: () => void;
  onSettings?: () => void;
}

export function ChatHeader({
  conversation,
  members,
  currentUserId,
  onlineUserIds,
  onBack,
  onSettings,
}: ChatHeaderProps) {
  const isGroup = conversation.type === 'group';
  const otherMembers = members.filter((m) => m.userId !== currentUserId);
  const displayName =
    conversation.name ?? otherMembers.map((m) => m.userName ?? 'Unknown').join(', ') ?? 'Chat';
  const memberCount = members.length;
  const onlineOthers = otherMembers.filter((m) => onlineUserIds?.has(m.userId)).length;

  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"
      >
        <span className="material-symbols-outlined">arrow_back</span>
      </button>

      <div
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          isGroup ? 'bg-primary/20 text-primary' : 'bg-white/10 text-slate-300'
        }`}
      >
        <span className="material-symbols-outlined text-lg">{isGroup ? 'group' : 'person'}</span>
        {onlineOthers > 0 && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-dark bg-green-500"
            title="Online"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-white">{displayName}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {isGroup
              ? `${memberCount} members${onlineOthers > 0 ? ` · ${onlineOthers} online` : ''}`
              : onlineOthers > 0
                ? 'Online'
                : (otherMembers[0]?.userName ?? '')}
          </span>
          <span
            className="material-symbols-outlined text-[12px] text-green-500"
            title="End-to-end encrypted"
          >
            lock
          </span>
        </div>
      </div>

      {isGroup && onSettings && (
        <button
          type="button"
          onClick={onSettings}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          title="Group settings"
        >
          <span className="material-symbols-outlined text-xl">settings</span>
        </button>
      )}
    </div>
  );
}
