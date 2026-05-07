import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscriptions } from '@/services/api/subscriptions';
import type { Conversation, Message } from '@/core/types';

export function useChatSubscriptions(activeConversationId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const unsub = subscriptions.subscribeToConversationUpdates((conversationId) => {
      queryClient.setQueryData<Conversation[]>(['chat', 'conversations'], (prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((c) => c.id === conversationId);
        if (idx === -1) {
          queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
          return prev;
        }
        const updated = [...prev];
        const conv = { ...updated[idx], updatedAt: new Date().toISOString() };
        updated.splice(idx, 1);
        updated.unshift(conv);
        return updated;
      });
    });

    return unsub;
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!activeConversationId || !enabled) return;

    const unsub = subscriptions.subscribeToChatMessages(activeConversationId, (action, msg) => {
      if (action === 'create') {
        queryClient.setQueryData<{ pages: Message[][]; pageParams: unknown[] }>(
          ['chat', 'messages', activeConversationId],
          (old) => {
            if (!old) return old;
            const firstPage = old.pages[0] ?? [];
            const exists = firstPage.some((m) => m.id === msg.id);
            if (exists) return old;
            return {
              ...old,
              pages: [[msg, ...firstPage], ...old.pages.slice(1)],
            };
          }
        );
      }
      if (action === 'update') {
        queryClient.setQueryData<{ pages: Message[][]; pageParams: unknown[] }>(
          ['chat', 'messages', activeConversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((page) =>
                page.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
              ),
            };
          }
        );
      }
    });

    return unsub;
  }, [activeConversationId, enabled, queryClient]);

  useEffect(() => {
    if (!activeConversationId || !enabled) return;

    const unsub = subscriptions.subscribeToChatReceipts(
      activeConversationId,
      (_action, receipt) => {
        queryClient.setQueryData<{ pages: Message[][]; pageParams: unknown[] }>(
          ['chat', 'messages', activeConversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((page) =>
                page.map((m) => {
                  if (m.id !== receipt.messageId) return m;
                  const existing = m.receipts ?? [];
                  const idx = existing.findIndex((r) => r.userId === receipt.userId);
                  const updated =
                    idx >= 0
                      ? existing.map((r, i) => (i === idx ? receipt : r))
                      : [...existing, receipt];
                  return { ...m, receipts: updated };
                })
              ),
            };
          }
        );
      }
    );

    return unsub;
  }, [activeConversationId, enabled, queryClient]);
}
