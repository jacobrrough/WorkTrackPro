import { useCallback } from 'react';
import { useChatMessages, useConversationWithMembers } from '@/hooks/useChatQueries';
import { useChatMutations } from '@/hooks/useChatMutations';
import { encryptionKeyService } from '@/services/api/encryptionKeys';
import { decryptConversationKey } from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

interface ChatWindowProps {
  conversationId: string;
  currentUserId: string;
  onBack: () => void;
}

export function ChatWindow({ conversationId, currentUserId, onBack }: ChatWindowProps) {
  const { data: convData } = useConversationWithMembers(conversationId);
  const {
    data: messageData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useChatMessages(conversationId);
  const { sendTextMessage, sendFileMessage, markRead } = useChatMutations();

  const ensureConversationKey = useCallback(async (): Promise<string> => {
    // To decrypt our copy of the conversation key we need the conversation
    // creator's public key. The creator encrypted every member's copy using
    // ECDH(creatorPrivate, memberPublic), so to decrypt we derive the same
    // shared secret via ECDH(myPrivate, creatorPublic).
    const creatorId = convData?.conversation.createdBy;

    const cached = cryptoKeyCache.getConversationKey(conversationId);
    if (cached) {
      const pubKey = creatorId ? await encryptionKeyService.getPublicKey(creatorId) : null;
      return pubKey ?? '';
    }

    const privateKey = cryptoKeyCache.getPrivateKey();
    if (!privateKey) throw new Error('Keys not unlocked');

    const keyData = await (
      await import('@/services/api/chat')
    ).chatService.getMyConversationKey(conversationId);
    if (!keyData) throw new Error('No conversation key');

    if (!creatorId) throw new Error('Cannot determine conversation creator');
    const creatorPubKey = await encryptionKeyService.getPublicKey(creatorId);
    if (!creatorPubKey) throw new Error('Cannot find creator public key');

    const convKey = await decryptConversationKey(
      keyData.encryptedKey,
      keyData.keyIv,
      privateKey,
      creatorPubKey
    );
    cryptoKeyCache.setConversationKey(conversationId, convKey);
    return creatorPubKey;
  }, [conversationId, convData]);

  const handleSendText = useCallback(
    async (text: string) => {
      const pubKey = await ensureConversationKey();
      await sendTextMessage(conversationId, text, pubKey);
    },
    [conversationId, ensureConversationKey, sendTextMessage]
  );

  const handleSendFile = useCallback(
    async (file: File) => {
      const pubKey = await ensureConversationKey();
      await sendFileMessage(conversationId, file, pubKey);
    },
    [conversationId, ensureConversationKey, sendFileMessage]
  );

  const handleMessagesVisible = useCallback(
    (messageIds: string[]) => {
      markRead(messageIds);
    },
    [markRead]
  );

  if (!convData) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-400">Loading conversation...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <ChatHeader
        conversation={convData.conversation}
        members={convData.members}
        currentUserId={currentUserId}
        onBack={onBack}
      />
      <MessageList
        pages={messageData?.pages}
        currentUserId={currentUserId}
        conversationId={conversationId}
        hasMore={!!hasNextPage}
        isFetchingMore={isFetchingNextPage}
        onFetchMore={() => fetchNextPage()}
        onMessagesVisible={handleMessagesVisible}
      />
      <MessageInput onSendText={handleSendText} onSendFile={handleSendFile} />
    </div>
  );
}
