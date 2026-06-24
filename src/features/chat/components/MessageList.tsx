import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Message } from '@/core/types';
import { MessageBubble } from './MessageBubble';
import { decryptMessage } from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';

interface MessageListProps {
  pages: Message[][] | undefined;
  currentUserId: string;
  conversationId: string;
  hasMore: boolean;
  isFetchingMore: boolean;
  onFetchMore: () => void;
  onMessagesVisible: (messageIds: string[]) => void;
}

export function MessageList({
  pages,
  currentUserId,
  conversationId,
  hasMore,
  isFetchingMore,
  onFetchMore,
  onMessagesVisible,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const [decryptedCache, setDecryptedCache] = React.useState<Map<string, string>>(new Map());

  const allMessages = useMemo(() => {
    if (!pages) return [];
    const flat = pages.flatMap((p) => p);
    flat.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return flat;
  }, [pages]);

  useEffect(() => {
    const convKey = cryptoKeyCache.getConversationKey(conversationId);
    if (!convKey) return;

    const toDecrypt = allMessages.filter(
      (m) => !decryptedCache.has(m.id) && m.encryptedContent && !m.decryptedContent
    );
    if (toDecrypt.length === 0) return;

    let cancelled = false;
    Promise.all(
      toDecrypt.map(async (m) => {
        try {
          const text = await decryptMessage(m.encryptedContent, m.contentIv, convKey);
          return [m.id, text] as const;
        } catch {
          return [m.id, '[Decryption failed]'] as const;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setDecryptedCache((prev) => {
        const next = new Map(prev);
        for (const [id, text] of results) next.set(id, text);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [allMessages, conversationId, decryptedCache]);

  useEffect(() => {
    setDecryptedCache(new Map());
  }, [conversationId]);

  useEffect(() => {
    if (allMessages.length > prevMessageCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCountRef.current = allMessages.length;
  }, [allMessages.length]);

  useEffect(() => {
    const unread = allMessages.filter((m) => m.senderId !== currentUserId).map((m) => m.id);
    if (unread.length > 0) onMessagesVisible(unread);
  }, [allMessages, currentUserId, onMessagesVisible]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isFetchingMore || !hasMore) return;
    if (el.scrollTop < 100) onFetchMore();
  }, [isFetchingMore, hasMore, onFetchMore]);

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3">
      {isFetchingMore && (
        <div className="mb-4 text-center">
          <span className="text-xs text-subtle">Loading older messages...</span>
        </div>
      )}

      {hasMore && !isFetchingMore && (
        <div className="mb-4 text-center">
          <button
            type="button"
            onClick={onFetchMore}
            className="text-xs text-primary hover:underline"
          >
            Load older messages
          </button>
        </div>
      )}

      {allMessages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="material-symbols-outlined mb-2 text-4xl text-subtle">lock</span>
          <p className="text-sm text-muted">Messages are end-to-end encrypted.</p>
          <p className="mt-1 text-xs text-subtle">Send a message to start the conversation.</p>
        </div>
      )}

      {allMessages.map((msg) => {
        const enriched = {
          ...msg,
          decryptedContent: msg.decryptedContent ?? decryptedCache.get(msg.id) ?? undefined,
        };
        return (
          <MessageBubble key={msg.id} message={enriched} isMine={msg.senderId === currentUserId} />
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
