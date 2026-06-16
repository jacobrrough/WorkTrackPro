import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted, encryptionEnabled } from './tokenCrypto.mjs';

/**
 * Encryption-at-rest for QBO/Plaid tokens. These tests pin the two load-bearing
 * guarantees the live QuickBooks connection depends on:
 *   1. With NO key set, encrypt/decrypt are byte-for-byte passthrough — enabling the
 *      module can never alter today's behavior.
 *   2. With a key set, encrypt→decrypt round-trips, legacy plaintext rows stay readable
 *      (no migration required), and any tampered/garbage/wrong-key ciphertext fails CLOSED
 *      to null rather than returning corrupt bytes or throwing.
 */

const KEY_B64 = Buffer.alloc(32, 7).toString('base64'); // deterministic 32-byte key
const KEY_HEX = Buffer.alloc(32, 9).toString('hex'); // 64 hex chars
const OTHER_KEY_B64 = Buffer.alloc(32, 42).toString('base64');

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.TOKEN_ENC_KEY;
  delete process.env.TOKEN_ENC_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.TOKEN_ENC_KEY;
  else process.env.TOKEN_ENC_KEY = savedKey;
});

describe('no key set (backward-compatible passthrough)', () => {
  it('encryptSecret returns the value unchanged', () => {
    expect(encryptSecret('a-refresh-token')).toBe('a-refresh-token');
  });

  it('decryptSecret returns the value unchanged', () => {
    expect(decryptSecret('a-refresh-token')).toBe('a-refresh-token');
  });

  it('encryptionEnabled() is false', () => {
    expect(encryptionEnabled()).toBe(false);
  });

  it('an invalid-length key is treated as no key (passthrough, not a throw)', () => {
    process.env.TOKEN_ENC_KEY = Buffer.alloc(16, 1).toString('base64'); // 16 bytes, too short
    expect(encryptionEnabled()).toBe(false);
    expect(encryptSecret('tok')).toBe('tok');
  });
});

describe('key set (base64)', () => {
  beforeEach(() => {
    process.env.TOKEN_ENC_KEY = KEY_B64;
  });

  it('encryptionEnabled() is true', () => {
    expect(encryptionEnabled()).toBe(true);
  });

  it('round-trips a secret', () => {
    const secret = 'AQB1234-intuit-refresh-token-xyz';
    const enc = encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces a fresh IV each call, yet both decrypt back (no deterministic ciphertext)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('reads a legacy plaintext row unchanged (no migration needed)', () => {
    expect(decryptSecret('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  it('is idempotent — never double-encrypts an already-tagged value', () => {
    const once = encryptSecret('tok');
    expect(encryptSecret(once)).toBe(once);
  });

  it('fails closed (null) on a tampered ciphertext', () => {
    const enc = encryptSecret('tok');
    // Decode the envelope and flip a byte in the 16-byte auth tag (offset 12..28),
    // then re-encode — GCM tag verification must fail and yield null.
    const raw = Buffer.from(enc.slice('enc:v1:'.length), 'base64');
    raw[12] ^= 0xff;
    const tampered = 'enc:v1:' + raw.toString('base64');
    expect(decryptSecret(tampered)).toBeNull();
  });

  it('fails closed (null) on garbage after the prefix', () => {
    expect(decryptSecret('enc:v1:not-valid-base64-$$$')).toBeNull();
  });
});

describe('key set (hex)', () => {
  it('accepts a 64-hex-char key and round-trips', () => {
    process.env.TOKEN_ENC_KEY = KEY_HEX;
    const enc = encryptSecret('hex-keyed-token');
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe('hex-keyed-token');
  });
});

describe('wrong key', () => {
  it('cannot decrypt a value encrypted under a different key (null, not throw)', () => {
    process.env.TOKEN_ENC_KEY = KEY_B64;
    const enc = encryptSecret('tok');
    process.env.TOKEN_ENC_KEY = OTHER_KEY_B64;
    expect(decryptSecret(enc)).toBeNull();
  });

  it('an encrypted value with the key since removed returns null', () => {
    process.env.TOKEN_ENC_KEY = KEY_B64;
    const enc = encryptSecret('tok');
    delete process.env.TOKEN_ENC_KEY;
    expect(decryptSecret(enc)).toBeNull();
  });
});

describe('null / undefined handling', () => {
  it('passes through null and undefined on both paths regardless of key', () => {
    process.env.TOKEN_ENC_KEY = KEY_B64;
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret(undefined)).toBeUndefined();
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeUndefined();
  });
});
