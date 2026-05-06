export { cryptoKeyCache } from './keyCache';

const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

// ── KEK derivation (password → wrapping key) ─────────

async function deriveKEK(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

// ── Identity key pair (ECDH P-256) ───────────────────

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return toBase64(spki);
}

async function importPublicKey(base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(base64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function wrapPrivateKey(
  privateKey: CryptoKey,
  kek: CryptoKey
): Promise<{ encryptedPrivateKey: string; iv: string }> {
  const iv = randomIv();
  const wrapped = await crypto.subtle.wrapKey('pkcs8', privateKey, kek, {
    name: 'AES-GCM',
    iv,
  });
  return { encryptedPrivateKey: toBase64(wrapped), iv: toBase64(iv) };
}

async function unwrapPrivateKey(
  encryptedPrivateKey: string,
  kek: CryptoKey,
  iv: string
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'pkcs8',
    fromBase64(encryptedPrivateKey),
    kek,
    { name: 'AES-GCM', iv: fromBase64(iv) },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
}

// ── Full key generation + wrapping for signup ────────

export async function generateAndWrapKeyPair(password: string): Promise<{
  publicKey: string;
  encryptedPrivateKey: string;
  keySalt: string;
  keyIv: string;
}> {
  const keyPair = await generateKeyPair();
  const salt = randomSalt();
  const kek = await deriveKEK(password, salt);
  const publicKey = await exportPublicKey(keyPair.publicKey);
  const { encryptedPrivateKey, iv } = await wrapPrivateKey(keyPair.privateKey, kek);
  return {
    publicKey,
    encryptedPrivateKey,
    keySalt: toBase64(salt),
    keyIv: iv,
  };
}

// ── Unlock private key from stored encrypted form ────

export async function unlockPrivateKey(
  encryptedPrivateKey: string,
  keySalt: string,
  keyIv: string,
  password: string
): Promise<CryptoKey> {
  const salt = new Uint8Array(fromBase64(keySalt));
  const kek = await deriveKEK(password, salt);
  return unwrapPrivateKey(encryptedPrivateKey, kek, keyIv);
}

// ── Re-wrap private key with new password ────────────

export async function rewrapPrivateKey(
  privateKey: CryptoKey,
  newPassword: string
): Promise<{ encryptedPrivateKey: string; keySalt: string; keyIv: string }> {
  const exportable = await crypto.subtle.exportKey('pkcs8', privateKey);
  const reImported = await crypto.subtle.importKey(
    'pkcs8',
    exportable,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const salt = randomSalt();
  const kek = await deriveKEK(newPassword, salt);
  const { encryptedPrivateKey, iv } = await wrapPrivateKey(reImported, kek);
  return { encryptedPrivateKey, keySalt: toBase64(salt), keyIv: iv };
}

// ── ECDH shared secret derivation ────────────────────

async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Conversation key management ──────────────────────

export async function generateConversationKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptConversationKeyForMember(
  conversationKey: CryptoKey,
  myPrivateKey: CryptoKey,
  memberPublicKeyBase64: string
): Promise<{ encryptedKey: string; iv: string }> {
  const memberPubKey = await importPublicKey(memberPublicKeyBase64);
  const sharedKey = await deriveSharedKey(myPrivateKey, memberPubKey);
  const rawConvKey = await crypto.subtle.exportKey('raw', conversationKey);
  const iv = randomIv();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, rawConvKey);
  return { encryptedKey: toBase64(encrypted), iv: toBase64(iv) };
}

export async function decryptConversationKey(
  encryptedKey: string,
  iv: string,
  myPrivateKey: CryptoKey,
  senderPublicKeyBase64: string
): Promise<CryptoKey> {
  const senderPubKey = await importPublicKey(senderPublicKeyBase64);
  const sharedKey = await deriveSharedKey(myPrivateKey, senderPubKey);
  const rawKeyBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    sharedKey,
    fromBase64(encryptedKey)
  );
  return crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

// ── Message encryption/decryption ────────────────────

export async function encryptMessage(
  plaintext: string,
  conversationKey: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomIv();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    conversationKey,
    encoder.encode(plaintext)
  );
  return { ciphertext: toBase64(encrypted), iv: toBase64(iv) };
}

export async function decryptMessage(
  ciphertext: string,
  iv: string,
  conversationKey: CryptoKey
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    conversationKey,
    fromBase64(ciphertext)
  );
  return decoder.decode(decrypted);
}

// ── File encryption/decryption ───────────────────────

export async function encryptFile(
  file: ArrayBuffer,
  conversationKey: CryptoKey
): Promise<{
  encryptedBlob: Blob;
  encryptedFileKey: string;
  fileIv: string;
  fileKeyIv: string;
}> {
  const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const fileIv = randomIv();
  const encryptedFile = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, fileKey, file);

  const rawFileKey = await crypto.subtle.exportKey('raw', fileKey);
  const fileKeyIv = randomIv();
  const encryptedFileKeyBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: fileKeyIv },
    conversationKey,
    rawFileKey
  );

  return {
    encryptedBlob: new Blob([encryptedFile]),
    encryptedFileKey: toBase64(encryptedFileKeyBuf),
    fileIv: toBase64(fileIv),
    fileKeyIv: toBase64(fileKeyIv),
  };
}

export async function decryptFile(
  encryptedBlob: Blob,
  encryptedFileKey: string,
  fileIv: string,
  fileKeyIv: string,
  conversationKey: CryptoKey
): Promise<Blob> {
  const rawFileKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(fileKeyIv) },
    conversationKey,
    fromBase64(encryptedFileKey)
  );
  const fileKey = await crypto.subtle.importKey(
    'raw',
    rawFileKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const encryptedData = await encryptedBlob.arrayBuffer();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(fileIv) },
    fileKey,
    encryptedData
  );
  return new Blob([decrypted]);
}

// Re-export importPublicKey for use in services
export { importPublicKey };
