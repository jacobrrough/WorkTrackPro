import { describe, it, expect } from 'vitest';
import { isValidProposalEmail, sanitizeText, firstNonEmpty } from '../submit-proposal.js';

/**
 * Unit tests for the PURE input-validation helpers in the submit-proposal Netlify
 * function. Auth/Turnstile, rate-limiting, the Resend email call, Supabase writes,
 * and CORS are intentionally NOT exercised here.
 *
 * `isValidProposalEmail` is the load-bearing one: the submitted email is reflected
 * into a confirmation sent FROM our verified domain, so this shape check is the
 * guard against an open-relay / email-bombing vector toward an attacker-chosen
 * recipient. These tests pin that boundary plus the two normalization helpers it
 * sits alongside.
 */

describe('isValidProposalEmail', () => {
  it('accepts ordinary, plus-tagged, and subdomained addresses', () => {
    expect(isValidProposalEmail('person@example.com')).toBe(true);
    expect(isValidProposalEmail('a.b+tag@sub.example.co.uk')).toBe(true);
  });

  it('rejects addresses missing the @ or the dotted domain', () => {
    expect(isValidProposalEmail('not-an-email')).toBe(false);
    expect(isValidProposalEmail('person@localhost')).toBe(false);
    expect(isValidProposalEmail('person@.com')).toBe(false);
    expect(isValidProposalEmail('@example.com')).toBe(false);
  });

  it('rejects empty input and values containing whitespace', () => {
    expect(isValidProposalEmail('')).toBe(false);
    expect(isValidProposalEmail('person @example.com')).toBe(false);
    expect(isValidProposalEmail('person@exam ple.com')).toBe(false);
    // A header-injection attempt (newline) must not pass the shape check.
    expect(isValidProposalEmail('person@example.com\nbcc:victim@x.com')).toBe(false);
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

describe('firstNonEmpty', () => {
  it('returns the first non-empty trimmed string', () => {
    expect(firstNonEmpty('', '  ', ' picked ', 'later')).toBe('picked');
  });

  it('skips non-string values', () => {
    expect(firstNonEmpty(undefined as unknown as string, 0 as unknown as string, 'ok')).toBe('ok');
  });

  it('returns an empty string when nothing qualifies', () => {
    expect(firstNonEmpty('', '   ', undefined as unknown as string)).toBe('');
  });
});
