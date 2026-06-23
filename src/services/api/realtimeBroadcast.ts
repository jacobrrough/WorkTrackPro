import { supabase } from './supabaseClient';

/**
 * Supabase Broadcast foundation (PRIVATE channels).
 *
 * Two patterns live here, per the project's realtime architecture:
 *   1. Broadcast-from-Database — a Postgres trigger calls realtime.broadcast_changes()
 *      and the client subscribes to a topic to receive INSERT/UPDATE/DELETE events.
 *      This is the scalable replacement for the legacy postgres_changes approach and
 *      is used for database-driven realtime (e.g. the accounting.* tables).
 *   2. Client-to-client Broadcast — a client send()s an ephemeral event (e.g. a chat
 *      typing indicator) that other subscribers receive. Never touches the database.
 *
 * Every channel here is PRIVATE (`config.private = true`), so delivery is gated by the
 * RLS policies on `realtime.messages` (see migration *_realtime_broadcast_authorization,
 * function public.realtime_authorize). Private channels require the realtime socket to
 * carry the user's JWT — callers don't manage that; the helpers below call
 * ensureRealtimeAuth() before joining.
 *
 * NOTE: this is deliberately separate from subscriptions.ts (the legacy postgres_changes
 * hub). New realtime should be built here; the old hub keeps running untouched.
 */

// ── Topic conventions ────────────────────────────────────────────────────────
// These MUST stay in lockstep with public.realtime_authorize() in the
// realtime-broadcast-authorization migration, which decides who may read/write each
// topic. Changing a prefix here means changing that RLS function too.
export const broadcastTopics = {
  /** All accounting-table realtime (broadcast_changes). Gated by accounting.can_read(). */
  accounting: (): string => 'accounting',
  /** Per-user private topic for personal events. Gated to the owner only. */
  user: (userId: string): string => `user:${userId}`,
  /** Chat message stream for a conversation. Gated to active conversation members. */
  chat: (conversationId: string): string => `chat:${conversationId}`,
  /** Ephemeral typing indicator for a conversation. Gated to active conversation members. */
  typing: (conversationId: string): string => `typing:${conversationId}`,
  /** Presence (online/idle) for a conversation. Gated to active conversation members. */
  presence: (conversationId: string): string => `presence:${conversationId}`,
} as const;

/**
 * Push the current auth JWT onto the realtime socket. Required before joining a
 * private channel. supabase-js auto-forwards refreshed tokens to realtime, so this is
 * belt-and-suspenders for the initial join; it's cheap (getSession reads the locally
 * cached token without a network round-trip unless a refresh is actually due).
 *
 * Returns false when there is no session (caller should skip subscribing).
 */
export async function ensureRealtimeAuth(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return false;
  await supabase.realtime.setAuth(token);
  return true;
}

export type BroadcastHandler = (event: string, payload: Record<string, unknown>) => void;

/**
 * Subscribe to one or more broadcast events on a PRIVATE topic, with the same
 * auto-reconnect/backoff posture as subscriptions.subscribeToCoreChanges. Returns an
 * unsubscribe fn.
 *
 * Works for both broadcast_changes (DB-driven; events 'INSERT'|'UPDATE'|'DELETE') and
 * client-to-client events (e.g. 'typing'). The payload is passed through raw so the
 * caller can map it; for broadcast_changes it carries { record, old_record, operation,
 * table, schema, ... }.
 */
export function subscribeToPrivateBroadcast(
  topic: string,
  events: string[],
  handler: BroadcastHandler
): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;

  async function connect(): Promise<void> {
    if (disposed) return;
    // A private channel will not authorize without the JWT on the socket.
    const authed = await ensureRealtimeAuth();
    if (disposed || !authed) return;

    let ch = supabase.channel(topic, { config: { private: true } });
    for (const event of events) {
      ch = ch.on('broadcast', { event }, (message) => {
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        handler(event, payload ?? {});
      });
    }
    channel = ch.subscribe((status) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        attempt = 0; // reset backoff on success
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(
          `[realtime:broadcast:${topic}] ${status} — reconnecting (attempt ${attempt + 1})`
        );
        teardown();
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        attempt++;
        reconnectTimer = setTimeout(() => void connect(), delay);
      }
    });
  }

  function teardown(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  }

  void connect();

  return () => {
    disposed = true;
    teardown();
  };
}

/**
 * Open a private channel for SENDING client-to-client broadcasts (e.g. a chat typing
 * indicator). Returns send() + close(). The channel is created lazily and stays open
 * until close(), so rapid throttled sends reuse one socket. Events are dropped silently
 * until the channel has joined — fine for fire-and-forget ephemera like typing.
 */
export function openBroadcastSender(topic: string): {
  send: (event: string, payload: Record<string, unknown>) => void;
  close: () => void;
} {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let ready = false;
  let disposed = false;

  void (async () => {
    const authed = await ensureRealtimeAuth();
    if (!authed || disposed) return;
    channel = supabase.channel(topic, { config: { private: true } }).subscribe((status) => {
      ready = status === 'SUBSCRIBED';
    });
  })();

  return {
    send: (event, payload) => {
      if (!channel || !ready) return; // drop until joined — acceptable for ephemeral events
      void channel.send({ type: 'broadcast', event, payload });
    },
    close: () => {
      disposed = true;
      ready = false;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    },
  };
}

export type PresenceState = Record<string, Array<Record<string, unknown>>>;

/**
 * Track this client's presence on a PRIVATE topic and receive the merged presence state of
 * all subscribers (online/idle status — NOT high-frequency cursors; use broadcast for those).
 * `selfState` is published under `selfKey`. `onState` fires on every sync with the full
 * presenceState(). Returns an unsubscribe fn that untracks + closes the channel.
 */
export function subscribeToPresence(
  topic: string,
  selfKey: string,
  selfState: Record<string, unknown>,
  onState: (state: PresenceState) => void
): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let disposed = false;

  void (async () => {
    const authed = await ensureRealtimeAuth();
    if (!authed || disposed) return;
    const ch = supabase.channel(topic, {
      config: { private: true, presence: { key: selfKey } },
    });
    ch.on('presence', { event: 'sync' }, () => {
      onState(ch.presenceState() as PresenceState);
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !disposed) {
        void ch.track(selfState);
      }
    });
    channel = ch;
  })();

  return () => {
    disposed = true;
    if (channel) {
      void channel.untrack();
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}
