import { describe, it, expect } from 'vitest';
import { isAuthorized } from './boards-for-addon.js';

/**
 * Unit tests for the PURE auth helper in the boards-for-addon Netlify function.
 *
 * Scope is deliberately narrow: the Supabase reads, board/column shaping, and CORS
 * are NOT exercised here. We only pin the static-Bearer comparison that gates the
 * endpoint — the one boundary that decides whether the Gmail Add-on key holder gets
 * in. Importing the module must not run the `handler` export.
 */

const KEY = 'super-secret-addon-key';

describe('isAuthorized', () => {
  it('authorizes a correct "Bearer <key>" header', () => {
    expect(isAuthorized(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  it('tolerates surrounding whitespace and a padded token (existing .trim() behavior)', () => {
    expect(isAuthorized(`  Bearer   ${KEY}   `, KEY)).toBe(true);
  });

  it('rejects a wrong key', () => {
    expect(isAuthorized(`Bearer ${KEY}-nope`, KEY)).toBe(false);
    expect(isAuthorized('Bearer something-else', KEY)).toBe(false);
  });

  it('rejects a missing header (undefined/null/empty)', () => {
    expect(isAuthorized(undefined as unknown as string, KEY)).toBe(false);
    expect(isAuthorized(null as unknown as string, KEY)).toBe(false);
    expect(isAuthorized('', KEY)).toBe(false);
  });

  it('rejects a header without the "Bearer " scheme prefix', () => {
    // The raw key alone, or another scheme, must not pass.
    expect(isAuthorized(KEY, KEY)).toBe(false);
    expect(isAuthorized(`Basic ${KEY}`, KEY)).toBe(false);
    expect(isAuthorized(`bearer ${KEY}`, KEY)).toBe(false); // scheme is case-sensitive
  });

  it('rejects an empty Bearer token', () => {
    expect(isAuthorized('Bearer ', KEY)).toBe(false);
    expect(isAuthorized('Bearer    ', KEY)).toBe(false);
  });

  it('never authorizes when the expected key is missing/empty (unconfigured env)', () => {
    // Mirrors the `if (!key) return false` guard: with no configured key, even a
    // structurally valid header (or an empty token that would "match") is denied.
    expect(isAuthorized(`Bearer ${KEY}`, '')).toBe(false);
    expect(isAuthorized('Bearer ', '')).toBe(false);
    expect(isAuthorized(`Bearer ${KEY}`, undefined as unknown as string)).toBe(false);
  });
});

describe('module import side-effects', () => {
  it('does not invoke the handler merely by importing the module', async () => {
    // If importing ran the handler, the import at the top of this file would have
    // thrown/hung (it expects a Netlify event). Re-import and assert the handler
    // is an uncalled function.
    const mod = await import('./boards-for-addon.js');
    expect(typeof mod.handler).toBe('function');
  });
});
