import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { UserEncryptionKeys } from '@/core/types';

/**
 * Regression coverage for the "non-creator adds a member -> permanently dead key
 * row" defect in addGroupMember.
 *
 * The conversation key is wrapped per member with ECDH(adderPrivate,
 * memberPublic), but every decrypt path derives the shared secret from the
 * CREATOR's public key — ECDH(memberPrivate, creatorPublic). Those secrets only
 * agree when the adder IS the creator. addGroupMember now guards on that: it
 * refuses (and writes nothing) unless the caller's own public key matches the
 * creator public key it was handed.
 */

const CREATOR_PUBKEY = 'creator-public-key';
const OTHER_PUBKEY = 'someone-elses-public-key';
const CONV_ID = 'conv-1';
const NEW_MEMBER_ID = 'new-member';

const FAKE_CONV_KEY = { __fake: 'convKey' } as unknown as CryptoKey;
const FAKE_PRIVATE_KEY = { __fake: 'privKey' } as unknown as CryptoKey;

// ── Crypto mocks ────────────────────────────────────────────────────────────
// useChatMutations imports several named exports from '@/lib/crypto'; the module
// is mocked wholesale so the import resolves. Only encryptConversationKeyForMember
// matters for the add-member path under test.

const encryptConversationKeyForMember = vi.fn(async (..._args: unknown[]) => ({
  encryptedKey: 'wrapped',
  iv: 'wrap-iv',
}));
vi.mock('@/lib/crypto', () => ({
  encryptMessage: vi.fn(),
  encryptFile: vi.fn(),
  generateConversationKey: vi.fn(),
  encryptConversationKeyForMember: (...args: unknown[]) => encryptConversationKeyForMember(...args),
  decryptConversationKey: vi.fn(async () => FAKE_CONV_KEY),
}));

// keyCache is a singleton; stub the pieces addGroupMember touches.
const getPrivateKey = vi.fn(() => FAKE_PRIVATE_KEY as CryptoKey | null);
const getConversationKey = vi.fn(() => FAKE_CONV_KEY as CryptoKey | null);
const setConversationKey = vi.fn();
const removeConversationKey = vi.fn();
vi.mock('@/lib/crypto/keyCache', () => ({
  cryptoKeyCache: {
    getPrivateKey: () => getPrivateKey(),
    getConversationKey: () => getConversationKey(),
    setConversationKey: (...args: unknown[]) => setConversationKey(...args),
    removeConversationKey: (...args: unknown[]) => removeConversationKey(...args),
  },
}));

// ── Service mocks ───────────────────────────────────────────────────────────

const getMyKeys = vi.fn<() => Promise<UserEncryptionKeys | null>>();
const getPublicKey = vi.fn(async (_userId: string) => 'member-public-key' as string | null);
vi.mock('@/services/api/encryptionKeys', () => ({
  encryptionKeyService: {
    getMyKeys: () => getMyKeys(),
    getPublicKey: (userId: string) => getPublicKey(userId),
  },
}));

const addMember = vi.fn(async (..._args: unknown[]) => ({ id: 'mem-x' }));
const getMyConversationKey = vi.fn(async (_id: string) => ({ encryptedKey: 'enc', keyIv: 'iv' }));
vi.mock('@/services/api/chat', () => ({
  chatService: {
    addMember: (...args: unknown[]) => addMember(...args),
    getMyConversationKey: (id: string) => getMyConversationKey(id),
  },
}));

import { useChatMutations } from './useChatMutations';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function keysWithPublic(publicKey: string): UserEncryptionKeys {
  return {
    id: 'k1',
    userId: 'me',
    publicKey,
    encryptedPrivateKey: 'enc',
    keySalt: 'salt',
    keyIv: 'iv',
    algorithm: 'ECDH-P256-AES-GCM',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('useChatMutations.addGroupMember creator-only guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrivateKey.mockReturnValue(FAKE_PRIVATE_KEY);
    getConversationKey.mockReturnValue(FAKE_CONV_KEY);
    // The success path re-exports/re-imports the (fake) conversation key via
    // real WebCrypto before wrapping it. Stub those two primitives so the test
    // does not depend on jsdom minting a genuine AES-GCM CryptoKey.
    // exportKey is overloaded (ArrayBuffer | JsonWebKey); cast the resolved
    // value to satisfy the union without pinning a single overload.
    vi.spyOn(crypto.subtle, 'exportKey').mockResolvedValue(new ArrayBuffer(32) as never);
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(FAKE_CONV_KEY);
  });

  it('refuses to add a member and writes nothing when the caller is not the creator', async () => {
    // Caller's own public key differs from the creator public key it was handed.
    getMyKeys.mockResolvedValue(keysWithPublic(OTHER_PUBKEY));

    const { result } = renderHook(() => useChatMutations(), { wrapper });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addGroupMember(CONV_ID, NEW_MEMBER_ID, CREATOR_PUBKEY);
    });

    expect(ok).toBe(false);
    // The guard must fire before any key wrapping or DB write happens.
    expect(addMember).not.toHaveBeenCalled();
    expect(encryptConversationKeyForMember).not.toHaveBeenCalled();
  });

  it('adds the member when the caller is the creator (own pubkey matches)', async () => {
    getMyKeys.mockResolvedValue(keysWithPublic(CREATOR_PUBKEY));

    const { result } = renderHook(() => useChatMutations(), { wrapper });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addGroupMember(CONV_ID, NEW_MEMBER_ID, CREATOR_PUBKEY);
    });

    expect(ok).toBe(true);
    expect(encryptConversationKeyForMember).toHaveBeenCalledTimes(1);
    expect(addMember).toHaveBeenCalledTimes(1);
    expect(addMember).toHaveBeenCalledWith(
      CONV_ID,
      expect.objectContaining({ userId: NEW_MEMBER_ID, encryptedKey: 'wrapped', keyIv: 'wrap-iv' })
    );
  });

  it('refuses (and writes nothing) when the caller has no encryption keys set up', async () => {
    getMyKeys.mockResolvedValue(null);

    const { result } = renderHook(() => useChatMutations(), { wrapper });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addGroupMember(CONV_ID, NEW_MEMBER_ID, CREATOR_PUBKEY);
    });

    expect(ok).toBe(false);
    expect(addMember).not.toHaveBeenCalled();
  });
});
