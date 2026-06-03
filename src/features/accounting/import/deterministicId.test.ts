import { describe, it, expect } from 'vitest';
import { uuidv5 } from './deterministicId';

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidv5', () => {
  it('matches the canonical RFC test vector (DNS namespace, "python.org")', async () => {
    expect(await uuidv5('python.org', NAMESPACE_DNS)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('is deterministic for the same input', async () => {
    const a = await uuidv5('Invoice|1001|2023-01-15');
    const b = await uuidv5('Invoice|1001|2023-01-15');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    expect(await uuidv5('a')).not.toBe(await uuidv5('b'));
  });

  it('sets the version (5) and RFC-4122 variant nibbles', async () => {
    const id = await uuidv5('anything');
    expect(id[14]).toBe('5'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(id[19]); // variant nibble
  });
});
