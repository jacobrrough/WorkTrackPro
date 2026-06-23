import { useEffect, useState } from 'react';
import { broadcastTopics, subscribeToPresence } from '@/services/api/realtimeBroadcast';

/**
 * Online presence for a conversation via Supabase Presence on the private topic
 * presence:<conv>. Returns the set of user ids currently online (tracking this conversation).
 * Best-effort and ephemeral; used for the green online dot in the chat header.
 */
export function useChatPresence(conversationId: string | null, currentUserId: string): Set<string> {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!conversationId || !currentUserId) return;
    const topic = broadcastTopics.presence(conversationId);

    const unsub = subscribeToPresence(
      topic,
      currentUserId,
      { userId: currentUserId, online_at: new Date().toISOString() },
      (state) => {
        const ids = new Set<string>();
        for (const entries of Object.values(state)) {
          for (const entry of entries) {
            const uid = (entry as { userId?: unknown }).userId;
            if (typeof uid === 'string') ids.add(uid);
          }
        }
        setOnlineUserIds(ids);
      }
    );

    return () => {
      unsub();
      setOnlineUserIds(new Set());
    };
  }, [conversationId, currentUserId]);

  return onlineUserIds;
}
