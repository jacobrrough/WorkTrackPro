// App-layer encryption-at-rest for secret columns (QBO OAuth tokens now; Plaid access
// tokens and vendor TINs later). Pure ESM; only node:crypto. Shared by qbo-oauth.mjs and
// qbo-sync.mjs so there is ONE implementation of the on-disk format.
//
// THREAT MODEL: this protects the secrets if a database dump / backup / replica leaks OR
// if the SUPABASE_SERVICE_ROLE_KEY leaks — the ciphertext is useless without TOKEN_ENC_KEY,
// which lives ONLY in the Netlify function environment (never in the DB). It is envelope-
// style key separation: an attacker now needs BOTH the data and the Netlify-held key.
//
// BACKWARD-COMPATIBLE BY DESIGN (the live QuickBooks connection must not break):
//   • TOKEN_ENC_KEY unset  → encryptSecret() returns the value unchanged; decryptSecret()
//                            returns it unchanged. Behavior is byte-for-byte today's.
//   • TOKEN_ENC_KEY set    → encryptSecret() returns 'enc:v1:'<base64(iv|tag|ciphertext)>;
//                            decryptSecret() transparently decrypts tagged values AND passes
//                            through any untagged (legacy plaintext) value. So you can flip
//                            the key on with NO migration — existing rows stay readable and
//                            get encrypted the next time a token naturally rotates.
//
// FORMAT: AES-256-GCM, 12-byte random IV, 16-byte auth tag. Stored string is
//   'enc:v1:' + base64( iv(12) || tag(16) || ciphertext ).
// The version tag ('v1') lets the format evolve without ambiguity.
//
// KEY: TOKEN_ENC_KEY is a 32-byte key, supplied as 64 hex chars OR base64. Generate with
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Store it in Netlify env (Production + Deploy-preview as desired). Losing it makes any
// already-encrypted tokens unreadable — but tokens self-heal: a disconnect/reconnect (or
// the next refresh once a readable refresh_token exists) re-mints them.

import crypto from 'node:crypto';

const ENC_PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Resolve the 32-byte key from the environment, or null if unset/invalid. Read on every
// call (NOT cached at module load) so tests — and a redeploy that adds the key — see the
// current env without a cold start juggling stale state.
function getEncKey() {
  const raw = (process.env.TOKEN_ENC_KEY || '').trim();
  if (!raw) return null;

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex'); // 64 hex chars → 32 bytes
  } else {
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      return null;
    }
  }
  return key.length === 32 ? key : null;
}

// True if a stored value is in our encrypted envelope format.
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

// True if encryption is currently active (a valid key is configured). Surfaced so callers /
// health checks can report posture without exposing the key.
export function encryptionEnabled() {
  return getEncKey() !== null;
}

// Encrypt a plaintext secret for storage.
//   • null/undefined  → returned as-is (lets callers pass optional fields straight through).
//   • already 'enc:v1:' → returned as-is (idempotent; never double-encrypts a value that was
//                          accidentally passed back without decrypting first).
//   • no key set      → returned as-is (backward-compatible passthrough).
// CONTRACT: callers must pass PLAINTEXT. Always decryptSecret() a stored value before
// re-encrypting it (e.g. the refresh-token fallback path) so this never sees ciphertext.
export function encryptSecret(plaintext) {
  if (plaintext == null) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const key = getEncKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

// Decrypt a stored secret.
//   • null/undefined or non-string  → returned as-is.
//   • not 'enc:v1:' tagged          → returned as-is (legacy plaintext row).
//   • tagged but no key / bad tag / garbage → null (logged). Callers treat null as "no usable
//     token" and fail closed (e.g. a generic 502), never crash.
export function decryptSecret(stored) {
  if (!isEncrypted(stored)) return stored;

  const key = getEncKey();
  if (!key) {
    console.error('tokenCrypto: encrypted value present but TOKEN_ENC_KEY is not set');
    return null;
  }

  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('tokenCrypto: decryption failed:', err?.message || err);
    return null;
  }
}
