import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isHardeningEnabled,
  rateLimit,
  clientKeyFromEvent,
  enforceBodyLimit,
  safeJsonParse,
  tooManyRequestsResponse,
  payloadTooLargeResponse,
  eventLikeFromRequest,
  LIMITS,
} from './securityHardening.mjs';

/**
 * PHASE E (E5) security-hardening helper tests. The CRITICAL property under test is INERTNESS:
 * with the server gate ACCOUNTING_SECURITY_HARDENING_ENABLED OFF, the limiter and body-cap NEVER
 * block — dropping these into the existing functions must not change their behavior until enabled.
 */

const ENV = 'ACCOUNTING_SECURITY_HARDENING_ENABLED';

afterEach(() => {
  delete process.env[ENV];
  // reset any limit env overrides used in a test
  delete process.env.ACCOUNTING_RL_DEFAULT_PER_MINUTE;
  delete process.env.ACCOUNTING_RL_MAX_BODY_BYTES;
});

describe('isHardeningEnabled (the hard server gate)', () => {
  it('is OFF by default (unset)', () => {
    expect(isHardeningEnabled()).toBe(false);
  });
  it('is OFF for falsey-ish strings', () => {
    for (const v of ['', 'false', '0', 'off', 'no', '  ', 'disabled']) {
      process.env[ENV] = v;
      expect(isHardeningEnabled()).toBe(false);
    }
  });
  it('is ON only for explicit truthy values', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'enabled']) {
      process.env[ENV] = v;
      expect(isHardeningEnabled()).toBe(true);
    }
  });
});

describe('rateLimit', () => {
  it('NEVER limits when the gate is OFF (inert)', () => {
    delete process.env[ENV];
    let last;
    for (let i = 0; i < 1000; i++) last = rateLimit('off:key', 1, 60000);
    expect(last.limited).toBe(false);
  });

  it('limits past the window allowance when the gate is ON', () => {
    process.env[ENV] = 'true';
    const key = `on:key:${Math.random()}`;
    expect(rateLimit(key, 2, 60000).limited).toBe(false); // 1st
    expect(rateLimit(key, 2, 60000).limited).toBe(false); // 2nd
    const third = rateLimit(key, 2, 60000); // 3rd → over
    expect(third.limited).toBe(true);
    expect(third.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('reports remaining allowance', () => {
    process.env[ENV] = 'on';
    const key = `rem:${Math.random()}`;
    expect(rateLimit(key, 3, 60000).remaining).toBe(2);
    expect(rateLimit(key, 3, 60000).remaining).toBe(1);
    expect(rateLimit(key, 3, 60000).remaining).toBe(0);
  });

  it('isolates distinct keys', () => {
    process.env[ENV] = 'true';
    const a = `iso-a:${Math.random()}`;
    const b = `iso-b:${Math.random()}`;
    rateLimit(a, 1, 60000);
    expect(rateLimit(a, 1, 60000).limited).toBe(true); // a exhausted
    expect(rateLimit(b, 1, 60000).limited).toBe(false); // b independent
  });
});

describe('clientKeyFromEvent', () => {
  it('prefers the Netlify client-ip header and includes the route salt', () => {
    const event = { headers: { 'x-nf-client-connection-ip': '203.0.113.7' } };
    expect(clientKeyFromEvent(event, 'tax-refresh')).toBe('tax-refresh:203.0.113.7');
  });
  it('falls back to the first x-forwarded-for hop', () => {
    const event = { headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } };
    expect(clientKeyFromEvent(event, 'r')).toBe('r:198.51.100.9');
  });
  it('degrades to "unknown" with no ip headers', () => {
    expect(clientKeyFromEvent({ headers: {} }, 'r')).toBe('r:unknown');
    expect(clientKeyFromEvent({}, 'r')).toBe('r:unknown');
  });
});

describe('enforceBodyLimit', () => {
  it('is inert when the gate is OFF (never tooLarge)', () => {
    delete process.env[ENV];
    const big = 'x'.repeat(1_000_000);
    expect(enforceBodyLimit({ body: big }, 10).tooLarge).toBe(false);
  });
  it('flags an over-cap body when the gate is ON', () => {
    process.env[ENV] = 'true';
    const res = enforceBodyLimit({ body: 'x'.repeat(100) }, 50);
    expect(res.tooLarge).toBe(true);
    expect(res.bytes).toBe(100);
  });
  it('passes an under-cap body', () => {
    process.env[ENV] = 'true';
    expect(enforceBodyLimit({ body: 'short' }, 50).tooLarge).toBe(false);
  });
  it('treats a null body as empty', () => {
    process.env[ENV] = 'true';
    expect(enforceBodyLimit({ body: null }, 50)).toEqual({ tooLarge: false, bytes: 0 });
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns the fallback on invalid JSON (never throws)', () => {
    expect(safeJsonParse('{bad', { ok: false })).toEqual({ ok: false });
    expect(safeJsonParse('', { d: 1 })).toEqual({ d: 1 });
    expect(safeJsonParse(undefined, 'fb')).toBe('fb');
  });
});

describe('response builders', () => {
  it('tooManyRequestsResponse is a 429 with Retry-After', () => {
    const r = tooManyRequestsResponse({ 'Content-Type': 'application/json' }, 5);
    expect(r.statusCode).toBe(429);
    expect(r.headers['Retry-After']).toBe('5');
  });
  it('payloadTooLargeResponse is a 413', () => {
    const r = payloadTooLargeResponse({ 'Content-Type': 'application/json' }, 1024);
    expect(r.statusCode).toBe(413);
    expect(JSON.parse(r.body).error).toContain('1024');
  });
});

describe('eventLikeFromRequest (Functions-V2 adapter)', () => {
  it('builds a headers map from a Headers instance', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': '192.0.2.5' }) };
    const ev = eventLikeFromRequest(req);
    expect(clientKeyFromEvent(ev, 'v2')).toBe('v2:192.0.2.5');
  });
  it('tolerates a non-iterable headers object', () => {
    const ev = eventLikeFromRequest({ headers: {} });
    expect(ev.headers).toEqual({});
  });
});

describe('LIMITS env overrides', () => {
  it('reads the operator-tunable default with a safe fallback', () => {
    expect(LIMITS.defaultPerMinute()).toBe(30);
    process.env.ACCOUNTING_RL_DEFAULT_PER_MINUTE = '7';
    expect(LIMITS.defaultPerMinute()).toBe(7);
    process.env.ACCOUNTING_RL_DEFAULT_PER_MINUTE = 'garbage';
    expect(LIMITS.defaultPerMinute()).toBe(30); // invalid → fallback
  });
});
