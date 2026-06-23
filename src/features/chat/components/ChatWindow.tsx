import { useCallback, useEffect, useState } from 'react';
import { useChatMessages, useConversationWithMembers } from '@/hooks/useChatQueries';
import { useChatMutations } from '@/hooks/useChatMutations';
import { encryptionKeyService } from '@/services/api/encryptionKeys';
import { decryptConversationKey } from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useChatTyping } from '../hooks/useChatTyping';
import { useChatPresence } from '../hooks/useChatPresence';

function formatTyping(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

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

  const currentUserName =
    convData?.members.find((m) => m.userId === currentUserId)?.userName ?? 'Someone';
  const { typingNames, notifyTyping } = useChatTyping(
    conversationId,
    currentUserId,
    currentUserName
  );
  const onlineUserIds = useChatPresence(conversationId, currentUserId);

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

  // Prime the conversation key as soon as the conversation loads so message
  // history decrypts on open — without this, ensureConversationKey only ran on
  // send, leaving a non-sending participant's history encrypted until they
  // typed something. `keyReady` flips once the key is cached; it is threaded
  // into the MessageList `key` below so MessageList remounts and re-runs its
  // decrypt effect against the now-available key. Reset to false whenever the
  // conversation changes.
  const [keyReady, setKeyReady] = useState(false);

  useEffect(() => {
    setKeyReady(false);
  }, [conversationId]);

  useEffect(() => {
    // Wait until the conversation (and thus its creator) is loaded; without
    // convData, ensureConversationKey cannot resolve the creator public key.
    if (!convData) return;

    let cancelled = false;
    (async () => {
      try {
        await ensureConversationKey();
        if (!cancelled) setKeyReady(true);
      } catch (err) {
        // Degrade gracefully into the locked / read-only path. The common
        // cases are an unlocked identity not being present ('Keys not
        // unlocked') or the member row lacking a key ('No conversation key');
        // neither should crash the window. History simply stays encrypted.
        if (!cancelled) {
          console.warn('ChatWindow: could not prime conversation key:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, convData, ensureConversationKey]);

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
        onlineUserIds={onlineUserIds}
        onBack={onBack}
      />
      <MessageList
        key={`${conversationId}:${keyReady}`}
        pages={messageData?.pages}
        currentUserId={currentUserId}
        conversationId={conversationId}
        hasMore={!!hasNextPage}
        isFetchingMore={isFetchingNextPage}
        onFetchMore={() => fetchNextPage()}
        onMessagesVisible={handleMessagesVisible}
      />
      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-xs italic text-slate-400">{formatTyping(typingNames)}</div>
      )}
      <MessageInput
        onSendText={handleSendText}
        onSendFile={handleSendFile}
        onTyping={notifyTyping}
      />
    </div>
  );
}
