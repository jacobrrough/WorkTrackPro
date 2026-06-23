import { useCallback, useEffect, useRef, useState } from 'react';
import {
  broadcastTopics,
  openBroadcastSender,
  subscribeToPrivateBroadcast,
} from '@/services/api/realtimeBroadcast';

// Don't emit more than one "typing" event per this window while the user keeps typing.
const TYPING_SEND_THROTTLE_MS = 2500;
// Drop a remote typer this long after their last event (covers a missed "stopped" signal).
const TYPING_EXPIRE_MS = 4000;
const SWEEP_INTERVAL_MS = 1500;

/**
 * Chat typing indicator over client-to-client Broadcast (private topic typing:<conv>).
 * Returns the display names currently typing (excluding the current user) and a throttled
 * notifyTyping() to call on each keystroke. Ephemeral — nothing is persisted.
 */
export function useChatTyping(
  conversationId: string | null,
  currentUserId: string,
  currentUserName: string
): { typingNames: string[]; notifyTyping: () => void } {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const senderRef = useRef<ReturnType<typeof openBroadcastSender> | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!conversationId) return;
    const topic = broadcastTopics.typing(conversationId);
    const sender = openBroadcastSender(topic);
    senderRef.current = sender;
    setTypingNames([]);

    // Local to this subscription; recreated whenever the conversation changes, so there is
    // no shared ref to read back in the cleanup function.
    const typers = new Map<string, { name: string; at: number }>();
    const recompute = () => {
      setTypingNames([...new Set([...typers.values()].map((t) => t.name))]);
    };

    const unsub = subscribeToPrivateBroadcast(topic, ['typing'], (_event, payload) => {
      const uid = typeof payload.userId === 'string' ? payload.userId : '';
      if (!uid || uid === currentUserId) return; // ignore our own echo
      const name = typeof payload.name === 'string' && payload.name ? payload.name : 'Someone';
      typers.set(uid, { name, at: Date.now() });
      recompute();
    });

    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [uid, t] of typers) {
        if (now - t.at > TYPING_EXPIRE_MS) {
          typers.delete(uid);
          changed = true;
        }
      }
      if (changed) recompute();
    }, SWEEP_INTERVAL_MS);

    return () => {
      unsub();
      sender.close();
      senderRef.current = null;
      clearInterval(sweep);
    };
  }, [conversationId, currentUserId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_SEND_THROTTLE_MS) return;
    lastSentRef.current = now;
    senderRef.current?.send('typing', { userId: currentUserId, name: currentUserName });
  }, [currentUserId, currentUserName]);

  return { typingNames, notifyTyping };
}
