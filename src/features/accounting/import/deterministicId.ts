/**
 * Deterministic UUID v5 (name-based, SHA-1) used to give every imported QuickBooks
 * transaction a stable accounting.journal_entries.source_id. Re-importing the same
 * transaction produces the same id, so the importer can skip what it already wrote
 * — the import is idempotent and safely resumable after a partial failure.
 *
 * Implemented per RFC 4122 §4.3 with the Web Crypto API (no dependency); validated
 * against the canonical DNS-namespace test vector in the unit tests.
 */

/** Fixed namespace for WorkTrack ↔ QuickBooks imports (a random v4 UUID, constant forever). */
export const QBO_IMPORT_NAMESPACE = '6f9b1d2e-7a3c-4c5b-9e21-0a4d8f6b1c70';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(b: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(b[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

export async function uuidv5(
  name: string,
  namespace: string = QBO_IMPORT_NAMESPACE
): Promise<string> {
  const ns = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns, 0);
  data.set(nameBytes, ns.length);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  const out = digest.slice(0, 16);
  out[6] = (out[6] & 0x0f) | 0x50; // version 5
  out[8] = (out[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(out);
}
