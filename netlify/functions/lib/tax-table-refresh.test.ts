import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AUTHORIZATION regression tests for the TAX-SYNC scheduled function.
 *
 * The defect these pin: the public /api/tax-table-refresh endpoint previously
 * treated ANY tokenless POST as the trusted cron run (trust-by-omission), which
 * let an anonymous caller drive runRefresh. The fix requires EITHER the shared
 * secret header (x-tax-sync-secret === TAX_SYNC_CRON_SECRET) OR a Bearer token
 * resolving to an accounting_admin; anything else is 403 BEFORE any fetch/DB
 * write. These tests lock that gate so a future edit can't silently reopen it.
 *
 * We stub @supabase/supabase-js so the AUTHORIZED path can reach runRefresh and
 * return its "no active sources" result WITHOUT any real network/DB call. The
 * UNAUTHORIZED paths must reject before the client is ever used.
 */

// Records of any DB chain usage, so we can assert the rejected paths touch nothing.
const dbCalls: string[] = [];

// A chainable, thenable PostgREST-style stub. Every builder method returns the
// same object; awaiting it resolves to an empty, error-free result set — exactly
// what runRefresh's `from('tax_table_sources').select().eq().order()` expects.
function makeQueryBuilder() {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.select = passthrough;
  builder.eq = passthrough;
  builder.order = passthrough;
  builder.update = passthrough;
  builder.insert = passthrough;
  builder.single = () => Promise.resolve({ data: { id: 'x' }, error: null });
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  // Make the builder awaitable (resolves to no active sources ⇒ clean 200).
  (builder as { then: unknown }).then = (
    resolve: (v: { data: unknown[]; error: null }) => unknown
  ) => resolve({ data: [], error: null });
  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    schema: () => ({
      from: (table: string) => {
        dbCalls.push(`from:${table}`);
        return makeQueryBuilder();
      },
    }),
    from: (table: string) => {
      dbCalls.push(`from:${table}`);
      return makeQueryBuilder();
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  }),
}));

// Imported AFTER vi.mock (hoisted) so the handler uses the stubbed client.
import handler from './tax-table-refresh.mjs';

const SECRET = 'top-secret-cron-value';

function makeRequest(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://example.test/api/tax-table-refresh', { method, headers });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  dbCalls.length = 0;
  // Service-role creds so getServiceClient() returns a (stubbed) client rather
  // than the 500 "not configured" branch.
  process.env.VITE_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
  process.env.ACCOUNTING_TAX_SYNC_ENABLED = 'true';
  process.env.TAX_SYNC_CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ACCOUNTING_TAX_SYNC_ENABLED;
  delete process.env.TAX_SYNC_CRON_SECRET;
});

describe('tax-table-refresh handler — authorization gate', () => {
  it('rejects an anonymous POST (no Bearer, no secret) with 403 and touches no DB', async () => {
    const res = await handler(makeRequest());
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.ok).toBe(false);
    expect(dbCalls).toEqual([]); // the bypass is closed BEFORE any DB access
  });

  it('rejects a POST with a wrong secret header with 403 and touches no DB', async () => {
    const res = await handler(makeRequest({ 'x-tax-sync-secret': 'not-the-secret' }));
    expect(res.status).toBe(403);
    expect(dbCalls).toEqual([]);
  });

  it('rejects a non-admin Bearer token with 403', async () => {
    // getUser() is stubbed to return no user ⇒ verifyAccountingAdmin → null.
    const res = await handler(makeRequest({ authorization: 'Bearer some.jwt.token' }));
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error).toBe('Accounting admin access required.');
    expect(dbCalls).toEqual([]);
  });

  it('AUTHORIZES a POST carrying the matching secret header (reaches runRefresh)', async () => {
    const res = await handler(makeRequest({ 'x-tax-sync-secret': SECRET }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.ok).toBe(true);
    // It got past auth into runRefresh, which loaded the (empty) source set.
    expect(dbCalls).toContain('from:tax_table_sources');
  });

  it('treats a missing/empty TAX_SYNC_CRON_SECRET as NOT authorizing (no trust-by-omission)', async () => {
    delete process.env.TAX_SYNC_CRON_SECRET; // secret unset
    // Even sending an empty secret header must not authorize.
    const res = await handler(makeRequest({ 'x-tax-sync-secret': '' }));
    expect(res.status).toBe(403);
    expect(dbCalls).toEqual([]);
  });
});

describe('tax-table-refresh handler — gate ordering & method', () => {
  it('returns the disabled 200 (env gate) BEFORE auth, even for an anonymous POST', async () => {
    process.env.ACCOUNTING_TAX_SYNC_ENABLED = 'false';
    const res = await handler(makeRequest());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.disabled).toBe(true);
    expect(dbCalls).toEqual([]);
  });

  it('rejects a non-POST method with 405', async () => {
    const res = await handler(makeRequest({}, 'GET'));
    expect(res.status).toBe(405);
  });

  it('answers the CORS preflight (OPTIONS) with 200', async () => {
    const res = await handler(makeRequest({}, 'OPTIONS'));
    expect(res.status).toBe(200);
  });
});
