import { describe, it, expect } from 'vitest';
import { detectContext, clampContext, isRequestTooLarge } from '../ai-chat.mjs';

/**
 * Unit tests for the PURE helpers in the ai-chat Netlify V2 function.
 *
 * Scope is deliberately narrow: auth, rate-limiting, the upstream model call, and
 * CORS are NOT exercised here. We only pin the dependency-free request-shaping
 * logic so a future edit cannot silently change which app-data categories a prompt
 * routes to, how the context block is clamped, or what counts as an oversized
 * request. Importing this module must not run the default-export handler.
 */

const userMsg = (content: string) => ({ role: 'user', content });

describe('detectContext', () => {
  it('defaults to the jobs category when there is no user message', () => {
    const { categories, jobCode } = detectContext([{ role: 'assistant', content: 'hello' }]);
    expect([...categories]).toEqual(['jobs']);
    expect(jobCode).toBeNull();
  });

  it('falls back to a summary category for an unrecognized prompt', () => {
    const { categories, jobCode } = detectContext([userMsg('xyzzy plugh frobnicate')]);
    expect([...categories]).toEqual(['summary']);
    expect(jobCode).toBeNull();
  });

  it('detects the inventory category from stock wording', () => {
    const { categories } = detectContext([userMsg('what foam is low stock right now?')]);
    expect(categories.has('inventory')).toBe(true);
  });

  it('detects the parts category from BOM/variant wording', () => {
    const { categories } = detectContext([userMsg('show the BOM and variants for that part')]);
    expect(categories.has('parts')).toBe(true);
  });

  it('detects the shifts category from clock-in wording', () => {
    const { categories } = detectContext([userMsg('who is clocked in on site today?')]);
    expect(categories.has('shifts')).toBe(true);
  });

  it('detects the deliveries category from shipping wording', () => {
    const { categories } = detectContext([
      userMsg('any deliveries with tracking from the carrier?'),
    ]);
    expect(categories.has('deliveries')).toBe(true);
  });

  it('extracts a job code from "Job #1042" and adds the jobs category', () => {
    const { categories, jobCode } = detectContext([userMsg('what is the status of Job #1042?')]);
    expect(jobCode).toBe('1042');
    expect(categories.has('jobs')).toBe(true);
  });

  it('extracts a job code from the "job #73" form', () => {
    const { jobCode } = detectContext([userMsg('details on job #73 please')]);
    expect(jobCode).toBe('73');
  });

  it('does not match a bare "#73" floating after a space (word-boundary behavior)', () => {
    // The #\d+ branch requires a word char before '#', so a standalone "#73"
    // preceded by whitespace is intentionally not treated as a job code.
    const { jobCode } = detectContext([userMsg('details on #73 please')]);
    expect(jobCode).toBeNull();
  });

  it('uses the LAST user message when several are present', () => {
    const { categories, jobCode } = detectContext([
      userMsg('tell me about inventory'),
      { role: 'assistant', content: 'sure' },
      userMsg('actually, Job #5 deliveries'),
    ]);
    expect(jobCode).toBe('5');
    expect(categories.has('deliveries')).toBe(true);
  });

  it('ignores non-string content (no crash, summary fallback)', () => {
    const { categories, jobCode } = detectContext([
      { role: 'user', content: [{ type: 'text', text: 'parts' }] as unknown as string },
    ]);
    expect(jobCode).toBeNull();
    expect(categories.has('summary')).toBe(true);
  });
});

describe('clampContext', () => {
  it('returns short text unchanged with no marker appended', () => {
    const text = 'small context block';
    const out = clampContext(text, 100);
    expect(out).toBe(text);
    expect(out).not.toContain('context truncated');
  });

  it('leaves text exactly at the limit unchanged (boundary)', () => {
    const text = 'x'.repeat(50);
    expect(clampContext(text, 50)).toBe(text);
  });

  it('truncates past the limit and appends the marker', () => {
    const marker = '\n…[context truncated to limit size]';
    const text = 'x'.repeat(51);
    const out = clampContext(text, 50);
    expect(out).toContain('[context truncated to limit size]');
    // Exactly the first `max` chars of the original survive, then the marker —
    // nothing of the original past the limit leaks through.
    expect(out).toBe('x'.repeat(50) + marker);
    expect(out.length).toBe(50 + marker.length);
  });

  it('coerces non-string input to an empty string', () => {
    expect(clampContext(undefined as unknown as string, 10)).toBe('');
    expect(clampContext(null as unknown as string, 10)).toBe('');
  });
});

describe('isRequestTooLarge', () => {
  it('is false for a small, well-formed messages array', () => {
    expect(isRequestTooLarge([userMsg('hi'), userMsg('there')])).toBe(false);
  });

  it('is false at exactly 50 messages (boundary)', () => {
    const msgs = Array.from({ length: 50 }, (_, i) => userMsg(`m${i}`));
    expect(isRequestTooLarge(msgs)).toBe(false);
  });

  it('is true past 50 messages', () => {
    const msgs = Array.from({ length: 51 }, (_, i) => userMsg(`m${i}`));
    expect(isRequestTooLarge(msgs)).toBe(true);
  });

  it('is true when the serialized body exceeds 100k chars', () => {
    // A single huge message blows the byte budget without exceeding the count cap.
    const msgs = [userMsg('x'.repeat(100001))];
    expect(isRequestTooLarge(msgs)).toBe(true);
  });

  it('is false for a non-array input (shape is validated elsewhere)', () => {
    expect(isRequestTooLarge(undefined as unknown as unknown[])).toBe(false);
    expect(isRequestTooLarge(null as unknown as unknown[])).toBe(false);
  });
});

describe('module import side-effects', () => {
  it('does not invoke the handler merely by importing the module', async () => {
    // If importing the module ran the default-export handler, the import at the
    // top of this file would already have thrown or hung (it expects a Request).
    // Re-import explicitly and assert the handler is an uncalled function.
    const mod = await import('../ai-chat.mjs');
    expect(typeof mod.default).toBe('function');
  });
});
