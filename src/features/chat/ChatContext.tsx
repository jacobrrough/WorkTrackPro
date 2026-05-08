import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCryptoKeys, type KeyState } from '@/hooks/useCryptoKeys';
import { useChatConversations } from '@/hooks/useChatQueries';
import { useChatSubscriptions } from '@/hooks/useChatSubscriptions';

interface ChatContextType {
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  keyState: KeyState;
  generateKeys: (password: string) => Promise<void>;
  unlockKeys: (password: string) => Promise<boolean>;
  recoverKeys: (oldPassword: string, currentPassword: string) => Promise<boolean>;
  regenerateKeys: (password: string) => Promise<void>;
  conversations: ReturnType<typeof useChatConversations>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const { keyState, generateKeys, unlock, recoverWithOldPassword, regenerateKeys } = useCryptoKeys(
    currentUser?.id
  );

  const isReady = keyState.status === 'unlocked' && !!currentUser?.isApproved;
  const conversations = useChatConversations(isReady);

  useChatSubscriptions(activeConversationId, isReady);

  const handleSetActive = useCallback((id: string | null) => {
    setActiveConversationId(id);
  }, []);

  const value = useMemo(
    (): ChatContextType => ({
      activeConversationId,
      setActiveConversationId: handleSetActive,
      keyState,
      generateKeys,
      unlockKeys: unlock,
      recoverKeys: recoverWithOldPassword,
      regenerateKeys,
      conversations,
    }),
    [
      activeConversationId,
      handleSetActive,
      keyState,
      generateKeys,
      unlock,
      recoverWithOldPassword,
      regenerateKeys,
      conversations,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChat(): ChatContextType {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
}
