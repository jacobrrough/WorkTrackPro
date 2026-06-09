import { describe, it, expect } from 'vitest';
import {
  isAuthorized,
  sanitizeText,
  sanitizeFileName,
  parseCardInput,
} from '../create-card-from-email.js';

/**
 * Unit tests for the PURE helpers in the create-card-from-email Netlify function.
 *
 * Scope is deliberately narrow: the Supabase job/card writes, attachment uploads to
 * Storage, and CORS are NOT exercised here. We pin the static-Bearer auth boundary,
 * the text/filename sanitizers, and the payload parse + required-field validation.
 * Importing the module must not run the `handler` export.
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
    expect(isAuthorized(KEY, KEY)).toBe(false);
    expect(isAuthorized(`Basic ${KEY}`, KEY)).toBe(false);
    expect(isAuthorized(`bearer ${KEY}`, KEY)).toBe(false); // scheme is case-sensitive
  });

  it('rejects an empty Bearer token', () => {
    expect(isAuthorized('Bearer ', KEY)).toBe(false);
    expect(isAuthorized('Bearer    ', KEY)).toBe(false);
  });

  it('never authorizes when the expected key is missing/empty (unconfigured env)', () => {
    expect(isAuthorized(`Bearer ${KEY}`, '')).toBe(false);
    expect(isAuthorized('Bearer ', '')).toBe(false);
    expect(isAuthorized(`Bearer ${KEY}`, undefined as unknown as string)).toBe(false);
  });
});

describe('sanitizeText', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('coerces nullish input to an empty string', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });

  it('stringifies non-string scalars', () => {
    expect(sanitizeText(42 as unknown as string)).toBe('42');
  });
});

describe('sanitizeFileName', () => {
  it('keeps safe filename characters intact', () => {
    expect(sanitizeFileName('My_File-1.0.pdf')).toBe('My_File-1.0.pdf');
  });

  it('replaces disallowed characters (incl. path separators) with underscores', () => {
    // Slashes and spaces are stripped so a name cannot escape its storage prefix.
    expect(sanitizeFileName('../etc/pa ss wd')).toBe('.._etc_pa_ss_wd');
    expect(sanitizeFileName('a b@c#d.txt')).toBe('a_b_c_d.txt');
  });

  it('falls back to "file.bin" for empty/all-stripped/nullish input', () => {
    expect(sanitizeFileName('')).toBe('file.bin');
    expect(sanitizeFileName('   ')).toBe('file.bin');
    expect(sanitizeFileName(null)).toBe('file.bin');
  });
});

describe('parseCardInput', () => {
  it('parses and trims a complete payload, marking it valid', () => {
    const out = parseCardInput({
      boardId: '  board-1 ',
      columnId: ' col-1 ',
      title: '  Hello  ',
      description: '  some text ',
      attachments: [{ filename: 'a.pdf' }],
      emailMetadata: { from: 'a@b.com', date: 'today' },
    });
    expect(out.valid).toBe(true);
    expect(out.boardId).toBe('board-1');
    expect(out.columnId).toBe('col-1');
    expect(out.title).toBe('Hello');
    expect(out.description).toBe('some text');
    expect(out.attachments).toEqual([{ filename: 'a.pdf' }]);
    expect(out.emailMeta).toEqual({ from: 'a@b.com', date: 'today' });
  });

  it('is invalid when any required field is missing or whitespace-only', () => {
    expect(parseCardInput({ columnId: 'c', title: 't' }).valid).toBe(false); // no boardId
    expect(parseCardInput({ boardId: 'b', title: 't' }).valid).toBe(false); // no columnId
    expect(parseCardInput({ boardId: 'b', columnId: 'c' }).valid).toBe(false); // no title
    expect(parseCardInput({ boardId: '   ', columnId: 'c', title: 't' }).valid).toBe(false);
    expect(parseCardInput({ boardId: 'b', columnId: 'c', title: '   ' }).valid).toBe(false);
  });

  it('defaults attachments to [] for non-array (or missing) input', () => {
    expect(parseCardInput({ boardId: 'b', columnId: 'c', title: 't' }).attachments).toEqual([]);
    expect(
      parseCardInput({ boardId: 'b', columnId: 'c', title: 't', attachments: 'nope' }).attachments
    ).toEqual([]);
  });

  it('defaults emailMeta to {} when absent or nullish', () => {
    expect(parseCardInput({ boardId: 'b', columnId: 'c', title: 't' }).emailMeta).toEqual({});
    expect(
      parseCardInput({ boardId: 'b', columnId: 'c', title: 't', emailMetadata: null }).emailMeta
    ).toEqual({});
  });

  it('tolerates an entirely empty/absent payload (invalid, with safe defaults)', () => {
    const out = parseCardInput(undefined);
    expect(out.valid).toBe(false);
    expect(out.boardId).toBe('');
    expect(out.columnId).toBe('');
    expect(out.title).toBe('');
    expect(out.description).toBe('');
    expect(out.attachments).toEqual([]);
    expect(out.emailMeta).toEqual({});
    expect(parseCardInput({}).valid).toBe(false);
  });
});

describe('module import side-effects', () => {
  it('does not invoke the handler merely by importing the module', async () => {
    // If importing ran the handler, the import at the top of this file would have
    // thrown/hung (it expects a Netlify event). Re-import and assert the handler
    // is an uncalled function.
    const mod = await import('../create-card-from-email.js');
    expect(typeof mod.handler).toBe('function');
  });
});
