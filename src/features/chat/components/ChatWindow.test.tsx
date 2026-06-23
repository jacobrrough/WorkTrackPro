import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Conversation, ConversationMember, Message } from '@/core/types';

/**
 * Regression coverage for the "history never decrypts until you send" defect.
 *
 * Previously ChatWindow only ran ensureConversationKey() from the send
 * handlers, so a participant who merely OPENED an existing conversation saw
 * encrypted placeholders until they typed something (which primed + cached the
 * conversation key, after which MessageList's decrypt effect happened to
 * re-run). ChatWindow now primes the conversation key in an effect on open and
 * remounts MessageList (via a `key` that includes a `keyReady` flag) so the
 * decrypt effect re-runs against the freshly cached key.
 *
 * These tests exercise the full prime -> cache -> MessageList-decrypts path
 * with the real cryptoKeyCache singleton and a stubbed crypto/service layer.
 */

const PLAINTEXT = 'hello from the past';
const CONV_ID = 'conv-1';
const CREATOR_ID = 'creator-1';
const ME = 'me-1';

// A real CryptoKey is awkward to mint in jsdom; the cache only stores/returns
// it opaquely and our mocked decryptMessage ignores it, so a sentinel object
// stands in fine.
const FAKE_CONV_KEY = { __fake: 'convKey' } as unknown as CryptoKey;

// ── Hook mocks ──────────────────────────────────────────────────────────────

const useConversationWithMembers = vi.fn();
const useChatMessages = vi.fn();
vi.mock('@/hooks/useChatQueries', () => ({
  useConversationWithMembers: (id: string | null) => useConversationWithMembers(id),
  useChatMessages: (id: string | null) => useChatMessages(id),
}));

const markRead = vi.fn();
vi.mock('@/hooks/useChatMutations', () => ({
  useChatMutations: () => ({
    sendTextMessage: vi.fn(),
    sendFileMessage: vi.fn(),
    markRead,
  }),
}));

// ChatWindow now mounts useChatTyping/useChatPresence, which reach the realtime layer
// (Supabase Broadcast/Presence). Stub it so the component renders without a live client.
vi.mock('@/services/api/realtimeBroadcast', () => ({
  broadcastTopics: {
    accounting: () => 'accounting',
    user: (id: string) => `user:${id}`,
    chat: (id: string) => `chat:${id}`,
    typing: (id: string) => `typing:${id}`,
    presence: (id: string) => `presence:${id}`,
  },
  ensureRealtimeAuth: vi.fn(async () => false),
  subscribeToPrivateBroadcast: vi.fn(() => () => {}),
  openBroadcastSender: vi.fn(() => ({ send: vi.fn(), close: vi.fn() })),
  subscribeToPresence: vi.fn(() => () => {}),
}));

// ── Crypto + service mocks ──────────────────────────────────────────────────
// ChatWindow imports decryptConversationKey and MessageList imports
// decryptMessage, both from '@/lib/crypto' — one mock covers both.

const decryptConversationKey = vi.fn(async (..._args: unknown[]) => FAKE_CONV_KEY);
const decryptMessage = vi.fn(async (..._args: unknown[]) => PLAINTEXT);
vi.mock('@/lib/crypto', () => ({
  decryptConversationKey: (...args: unknown[]) => decryptConversationKey(...args),
  decryptMessage: (...args: unknown[]) => decryptMessage(...args),
}));

const getPublicKey = vi.fn(async (_userId: string) => 'creator-public-key');
vi.mock('@/services/api/encryptionKeys', () => ({
  encryptionKeyService: {
    getPublicKey: (userId: string) => getPublicKey(userId),
  },
}));

const getMyConversationKey = vi.fn(async (_id: string) => ({ encryptedKey: 'enc', keyIv: 'iv' }));
vi.mock('@/services/api/chat', () => ({
  chatService: {
    getMyConversationKey: (id: string) => getMyConversationKey(id),
  },
}));

// Import the real in-memory key cache (a plain singleton) and the component
// AFTER mocks are registered.
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import { ChatWindow } from './ChatWindow';

// ── Fixtures ────────────────────────────────────────────────────────────────

function conversation(): Conversation {
  return {
    id: CONV_ID,
    type: 'direct',
    createdBy: CREATOR_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function member(userId: string): ConversationMember {
  return {
    id: `mem-${userId}`,
    conversationId: CONV_ID,
    userId,
    role: userId === CREATOR_ID ? 'admin' : 'member',
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** One inbound, still-encrypted history message authored by the OTHER user. */
function historyMessage(): Message {
  return {
    id: 'msg-1',
    conversationId: CONV_ID,
    senderId: CREATOR_ID,
    senderName: 'Creator',
    encryptedContent: 'ciphertext',
    contentIv: 'msg-iv',
    messageType: 'text',
    createdAt: '2026-01-01T00:00:01.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  };
}

function primeHooks() {
  useConversationWithMembers.mockReturnValue({
    data: { conversation: conversation(), members: [member(CREATOR_ID), member(ME)] },
  });
  useChatMessages.mockReturnValue({
    data: { pages: [[historyMessage()]] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cryptoKeyCache.clear();
  primeHooks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ChatWindow conversation-key priming', () => {
  it('decrypts existing history on open without the user sending a message', async () => {
    // Identity is unlocked but the conversation key has NOT been cached yet —
    // exactly the "just opened a conversation" state.
    cryptoKeyCache.setIdentityKeys(
      { __fake: 'priv' } as unknown as CryptoKey,
      { __fake: 'pub' } as unknown as CryptoKey
    );

    render(<ChatWindow conversationId={CONV_ID} currentUserId={ME} onBack={() => {}} />);

    // The placeholder for an undecrypted bubble — must NOT be the final state.
    await waitFor(() => expect(screen.getByText(PLAINTEXT)).toBeInTheDocument());

    // Priming actually walked the decrypt path (no send occurred).
    expect(getMyConversationKey).toHaveBeenCalledWith(CONV_ID);
    expect(decryptConversationKey).toHaveBeenCalledTimes(1);
    // And the key landed in the shared cache for MessageList to consume.
    expect(cryptoKeyCache.getConversationKey(CONV_ID)).toBe(FAKE_CONV_KEY);
  });

  it('decrypts history on open when the conversation key is already cached (no re-decrypt of the key)', async () => {
    cryptoKeyCache.setIdentityKeys(
      { __fake: 'priv' } as unknown as CryptoKey,
      { __fake: 'pub' } as unknown as CryptoKey
    );
    // Key already present (e.g. used earlier this session).
    cryptoKeyCache.setConversationKey(CONV_ID, FAKE_CONV_KEY);

    render(<ChatWindow conversationId={CONV_ID} currentUserId={ME} onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText(PLAINTEXT)).toBeInTheDocument());

    // Cached path short-circuits before fetching/decrypting the conversation key.
    expect(getMyConversationKey).not.toHaveBeenCalled();
    expect(decryptConversationKey).not.toHaveBeenCalled();
  });

  it('degrades gracefully (no crash) when identity keys are locked', async () => {
    // No identity keys in cache -> ensureConversationKey throws 'Keys not
    // unlocked'; the window must still render the encrypted placeholder.
    render(<ChatWindow conversationId={CONV_ID} currentUserId={ME} onBack={() => {}} />);

    // The placeholder <p> also contains an adjacent "lock" icon glyph, so match
    // the label with a substring matcher rather than an exact string.
    await waitFor(() => expect(screen.getByText(/Encrypted message/)).toBeInTheDocument());

    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
    // We never reached the key fetch because the private key was missing.
    expect(getMyConversationKey).not.toHaveBeenCalled();
    expect(decryptMessage).not.toHaveBeenCalled();
  });
});
