import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/AppContext';
import { ChatProvider, useChat } from './ChatContext';
import { EncryptionSetup } from './components/EncryptionSetup';
import { ConversationList, SYSTEM_NOTIFICATIONS_ID } from './components/ConversationList';
import { ChatWindow } from './components/ChatWindow';
import { SystemNotificationsView } from './components/SystemNotificationsView';
import { NewConversationModal } from './components/NewConversationModal';
import { useChatMutations } from '@/hooks/useChatMutations';
import { useSystemNotificationSubscription } from '@/hooks/useSystemNotifications';
import type { ViewState } from '@/core/types';

interface ChatViewInnerProps {
  conversationId?: string;
  onNavigate?: (view: ViewState, id?: string) => void;
  onBack?: () => void;
}

function ChatViewInner({
  conversationId: initialConversationId,
  onNavigate,
  onBack,
}: ChatViewInnerProps) {
  const { currentUser } = useAuth();
  const { users } = useApp();
  const {
    activeConversationId,
    setActiveConversationId,
    keyState,
    generateKeys,
    unlockKeys,
    recoverKeys,
    regenerateKeys,
    conversations,
  } = useChat();
  const { createDirectConversation, createGroupConversation } = useChatMutations();
  const [showNewModal, setShowNewModal] = useState(false);

  useSystemNotificationSubscription(currentUser?.id ?? null, keyState.status === 'unlocked');

  React.useEffect(() => {
    if (initialConversationId && !activeConversationId) {
      setActiveConversationId(initialConversationId);
    }
  }, [initialConversationId, activeConversationId, setActiveConversationId]);

  if (!currentUser) return null;

  if (keyState.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark">
        <p className="text-muted">Loading encryption keys...</p>
      </div>
    );
  }

  if (
    keyState.status === 'not_setup' ||
    keyState.status === 'locked' ||
    keyState.status === 'error'
  ) {
    return (
      <div className="min-h-screen bg-background-dark">
        <EncryptionSetup
          keyState={keyState}
          onGenerate={generateKeys}
          onUnlock={unlockKeys}
          onRecover={recoverKeys}
          onRegenerate={regenerateKeys}
        />
      </div>
    );
  }

  const handleCreateDirect = async (userId: string) => {
    const conv = await createDirectConversation(userId);
    if (conv) setActiveConversationId(conv.id);
  };

  const handleCreateGroup = async (name: string, memberIds: string[]) => {
    const conv = await createGroupConversation(name, memberIds);
    if (conv) setActiveConversationId(conv.id);
  };

  const showList = !activeConversationId;
  const showChat = !!activeConversationId;

  return (
    <div className="flex h-[100dvh] bg-background-dark">
      {/* Conversation list — always visible on desktop, hidden when chat is open on mobile */}
      <aside
        className={`w-full border-r border-line md:flex md:w-80 md:flex-col ${
          showList ? 'flex flex-col' : 'hidden'
        }`}
      >
        <ConversationList
          conversations={conversations.data ?? []}
          activeConversationId={activeConversationId}
          currentUserId={currentUser.id}
          isLoading={conversations.isLoading}
          onSelect={setActiveConversationId}
          onNewConversation={() => setShowNewModal(true)}
          onBack={onBack}
        />
      </aside>

      {/* Chat window — always visible on desktop, replaces list on mobile */}
      <main className={`flex-1 flex-col ${showChat ? 'flex' : 'hidden md:flex'}`}>
        {activeConversationId === SYSTEM_NOTIFICATIONS_ID ? (
          <SystemNotificationsView
            onBack={() => setActiveConversationId(null)}
            onNavigate={(link) => {
              if (!onNavigate || !link) return;
              if (link.startsWith('/')) {
                // Real deep link URL (new format) — navigate directly
                window.location.assign(link);
              } else {
                // Legacy view:id format fallback (for any old notifications still in DB)
                const [linkView, linkId] = link.split(':');
                if (linkView && linkId) onNavigate(linkView as ViewState, linkId);
              }
            }}
          />
        ) : activeConversationId ? (
          <ChatWindow
            conversationId={activeConversationId}
            currentUserId={currentUser.id}
            onBack={() => setActiveConversationId(null)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="material-symbols-outlined text-5xl text-subtle">forum</span>
            <p className="text-muted">Select a conversation or start a new one</p>
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-accent hover:bg-primary/90"
            >
              New Conversation
            </button>
          </div>
        )}
      </main>

      {showNewModal && (
        <NewConversationModal
          users={users}
          currentUserId={currentUser.id}
          onCreateDirect={handleCreateDirect}
          onCreateGroup={handleCreateGroup}
          onClose={() => setShowNewModal(false)}
        />
      )}
    </div>
  );
}

interface ChatViewProps {
  conversationId?: string;
  onNavigate?: (view: ViewState, id?: string) => void;
  onBack?: () => void;
}

export default function ChatView({ conversationId, onNavigate, onBack }: ChatViewProps) {
  return (
    <ChatProvider>
      <ChatViewInner conversationId={conversationId} onNavigate={onNavigate} onBack={onBack} />
    </ChatProvider>
  );
}
