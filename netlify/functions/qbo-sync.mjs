// QuickBooks Online (QBO) data-sync proxy — WorkTrackAccounting Phases 1–5 backend.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// Mirrors netlify/functions/qbo-oauth.mjs: same getServiceClient() + admin-verify approach
// and JSON responses with GENERIC error messages. Tokens / client_secret NEVER reach the
// client or the logs.
//
// DESIGN: this function is a THIN, READ-ONLY proxy to the Intuit API. All entity mapping
// and database writes happen in the browser (the accountant's session, normal accounting
// RLS) via the existing service layer — exactly like the CSV importers. The proxy exists
// only because the OAuth tokens must stay server-side. Every Intuit call here is a GET;
// the live QuickBooks company can never be modified by this function.
//
// ENDPOINTS (all ADMIN unless noted)
//   GET  /api/qbo-sync?action=count&entity=Invoice[&changedSince=ISO]
//          -> { count }
//   GET  /api/qbo-sync?action=query&entity=Invoice&startPosition=1&maxResults=500[&changedSince=ISO]
//          -> { items: [...], startPosition, maxResults }
//   GET  /api/qbo-sync?action=report&name=TrialBalance[&start_date&end_date&report_date&accounting_method]
//          -> { report: <raw QBO report JSON> }
//   POST /api/qbo-sync?action=mark-synced   body: { cdcCursor?: ISO }
//          -> { ok: true }   (bumps qbo_connection.last_sync_at / last_cdc_cursor)
//
// SAFETY: entity + report names are strict whitelists; numbers are clamped; changedSince
// is parsed and re-serialized (never embedded raw), so no caller-controlled text ever
// reaches the QBO query string un-validated. QBO 429 throttling is surfaced as 429 with
// a retryAfter hint so the client-stepped sync can back off.

import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = '75';

const jsonHeaders = { 'Content-Type': 'application/json' };

// Every QBO entity the replica sync may read. Masters, documents, then the
// completeness-pass transaction types (docs/QUICKBOOKS_IMPORT_PLAN.md).
const ENTITY_WHITELIST = new Set([
  'Account',
  'Item',
  'Customer',
  'Vendor',
  'Term',
  'TaxCode',
  'TaxRate',
  'Estimate',
  'Invoice',
  'Bill',
  'Payment',
  'BillPayment',
  'CreditMemo',
  'SalesReceipt',
  'RefundReceipt',
  'VendorCredit',
  'Deposit',
  'Transfer',
  'JournalEntry',
  'Purchase',
]);

// Master entities that carry an Active flag. QBO queries return ONLY active records
// unless the query opts in via `Active IN (true, false)` — a true replica must also
// pull inactive masters (historical documents reference retired customers/accounts).
// Transaction entities have no Active field (the clause would be a QBO query error).
const ENTITIES_WITH_ACTIVE_FLAG = new Set([
  'Account',
  'Item',
  'Customer',
  'Vendor',
  'Term',
  'TaxCode',
]);

// Verification reports diffed against WorkTrack's report engine (Phase 5).
const REPORT_WHITELIST = new Set([
  'TrialBalance',
  'BalanceSheet',
  'ProfitAndLoss',
  'AgedReceivables',
  'AgedPayables',
  'CustomerBalance',
  'VendorBalance',
  'GeneralLedger',
]);

// Report query params we pass through, each with a strict value validator.
const REPORT_PARAM_VALIDATORS = {
  start_date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  end_date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  report_date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  accounting_method: (v) => v === 'Accrual' || v === 'Cash',
};

// ── Config / env (mirrors qbo-oauth.mjs) ────────────────

function getConfig() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT || 'sandbox').toLowerCase();
  if (!clientId || !clientSecret) return null;
  const apiBase =
    environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';
  return { clientId, clientSecret, environment, apiBase };
}

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyAdminUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const supabase = getServiceClient();
  if (!supabase) return null;

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || !profile.is_admin) return null;
  return user;
}

// ── qbo_connection access + token refresh (mirrors qbo-oauth.mjs) ──

function qboTable(supabase) {
  return supabase.schema('accounting').from('qbo_connection');
}

async function loadConnection(supabase) {
  const { data, error } = await qboTable(supabase).select('*').limit(1).maybeSingle();
  if (error) {
    console.error('qbo-sync loadConnection error:', error.message);
    return null;
  }
  return data || null;
}

function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function refreshAccessToken(cfg, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(cfg.clientId, cfg.clientSecret),
    },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('qbo-sync token refresh failed:', resp.status, text.slice(0, 300));
    return null;
  }
  return resp.json().catch(() => null);
}

// Ensure a non-expired access token, refreshing + PERSISTING the rotated token if needed.
async function ensureValidAccessToken(supabase, cfg, conn) {
  const skewMs = 60 * 1000;
  const notExpired =
    conn.access_token &&
    conn.access_token_expires_at &&
    new Date(conn.access_token_expires_at).getTime() - skewMs > Date.now();

  if (notExpired) {
    return { accessToken: conn.access_token, realmId: conn.realm_id };
  }

  const tokens = await refreshAccessToken(cfg, conn.refresh_token);
  if (!tokens || !tokens.access_token) return null;

  const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000).toISOString();
  const { error } = await supabase
    .schema('accounting')
    .from('qbo_connection')
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      refresh_token: tokens.refresh_token || conn.refresh_token,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);
  if (error) {
    console.error('qbo-sync failed to persist refreshed token:', error.message);
    return null;
  }

  return { accessToken: tokens.access_token, realmId: conn.realm_id };
}

// ── Responses ───────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// ── Intuit GET with throttle passthrough ────────────────

async function intuitGet(cfg, valid, path, searchParams) {
  const qs = searchParams ? `&${searchParams.toString()}` : '';
  const url = `${cfg.apiBase}/v3/company/${valid.realmId}${path}?minorversion=${MINOR_VERSION}${qs}`;

  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${valid.accessToken}` },
    });
  } catch (err) {
    console.error('qbo-sync fetch error:', err?.message || err);
    return { error: json({ error: 'Unable to reach QuickBooks' }, 502) };
  }

  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get('Retry-After')) || 60;
    return { error: json({ error: 'QuickBooks rate limit', retryAfter }, 429) };
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('qbo-sync QBO error:', resp.status, text.slice(0, 500));
    return { error: json({ error: 'QuickBooks returned an error' }, 502) };
  }

  const data = await resp.json().catch(() => null);
  if (!data) return { error: json({ error: 'QuickBooks returned an unreadable response' }, 502) };
  return { data };
}

// ── Query-string validation helpers ─────────────────────

function parsePositiveInt(value, fallback, max) {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

// Parse + RE-SERIALIZE so only a canonical ISO string is ever embedded in the query.
function parseChangedSince(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return undefined; // present but invalid
  return new Date(t).toISOString();
}

// ── Endpoint handlers ───────────────────────────────────

// Build the validated WHERE clause shared by count + query. Returns null on bad input.
function buildWhere(url, entity) {
  const changedSince = parseChangedSince(url.searchParams.get('changedSince'));
  if (changedSince === undefined) return null;

  const clauses = [];
  if (changedSince) clauses.push(`Metadata.LastUpdatedTime > '${changedSince}'`);
  if (
    url.searchParams.get('includeInactive') === 'true' &&
    ENTITIES_WITH_ACTIVE_FLAG.has(entity)
  ) {
    clauses.push('Active IN (true, false)');
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

async function handleCount(cfg, valid, url) {
  const entity = url.searchParams.get('entity') || '';
  if (!ENTITY_WHITELIST.has(entity)) return json({ error: 'Unknown entity' }, 400);

  const where = buildWhere(url, entity);
  if (where === null) return json({ error: 'Invalid changedSince' }, 400);

  const query = `SELECT COUNT(*) FROM ${entity}${where}`;
  const { data, error } = await intuitGet(cfg, valid, '/query', new URLSearchParams({ query }));
  if (error) return error;

  const count = Number(data?.QueryResponse?.totalCount ?? 0);
  return json({ count });
}

async function handleQuery(cfg, valid, url) {
  const entity = url.searchParams.get('entity') || '';
  if (!ENTITY_WHITELIST.has(entity)) return json({ error: 'Unknown entity' }, 400);

  const startPosition = parsePositiveInt(url.searchParams.get('startPosition'), 1);
  const maxResults = parsePositiveInt(url.searchParams.get('maxResults'), 1000, 1000);

  const where = buildWhere(url, entity);
  if (where === null) return json({ error: 'Invalid changedSince' }, 400);

  const query = `SELECT * FROM ${entity}${where} ORDERBY Id STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
  const { data, error } = await intuitGet(cfg, valid, '/query', new URLSearchParams({ query }));
  if (error) return error;

  const qr = data?.QueryResponse || {};
  const items = Array.isArray(qr[entity]) ? qr[entity] : [];
  return json({ items, startPosition, maxResults });
}

async function handleReport(cfg, valid, url) {
  const name = url.searchParams.get('name') || '';
  if (!REPORT_WHITELIST.has(name)) return json({ error: 'Unknown report' }, 400);

  const params = new URLSearchParams();
  for (const [key, validate] of Object.entries(REPORT_PARAM_VALIDATORS)) {
    const value = url.searchParams.get(key);
    if (value == null) continue;
    if (!validate(value)) return json({ error: `Invalid ${key}` }, 400);
    params.set(key, value);
  }

  const { data, error } = await intuitGet(cfg, valid, `/reports/${name}`, params);
  if (error) return error;
  return json({ report: data });
}

async function handleMarkSynced(request, supabase, conn) {
  const body = await request.json().catch(() => ({}));
  const update = {
    last_sync_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const cursor = parseChangedSince(body?.cdcCursor);
  if (cursor === undefined) return json({ error: 'Invalid cdcCursor' }, 400);
  if (cursor) update.last_cdc_cursor = cursor;

  const { error } = await qboTable(supabase).update(update).eq('id', conn.id);
  if (error) {
    console.error('qbo-sync mark-synced error:', error.message);
    return json({ error: 'Failed to record sync' }, 500);
  }
  return json({ ok: true });
}

// ── Main handler (Netlify V2) ───────────────────────────

export default async (request) => {
  const cfg = getConfig();
  const supabase = getServiceClient();
  if (!cfg || !supabase) return json({ error: 'QuickBooks not configured' }, 500);

  try {
    const authHeader = request.headers.get('authorization') || '';
    const user = await verifyAdminUser(authHeader);
    if (!user) return json({ error: 'Admin access required' }, 403);

    const conn = await loadConnection(supabase);
    if (!conn) return json({ error: 'QuickBooks is not connected' }, 400);

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (request.method === 'POST') {
      if (action === 'mark-synced') return await handleMarkSynced(request, supabase, conn);
      return json({ error: 'Unknown action' }, 400);
    }

    if (request.method === 'GET') {
      const valid = await ensureValidAccessToken(supabase, cfg, conn);
      if (!valid) return json({ error: 'Unable to obtain a valid QuickBooks token' }, 502);

      if (action === 'count') return await handleCount(cfg, valid, url);
      if (action === 'query') return await handleQuery(cfg, valid, url);
      if (action === 'report') return await handleReport(cfg, valid, url);
      return json({ error: 'Unknown action' }, 400);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('qbo-sync unhandled error:', err?.message || err);
    return json({ error: 'Internal function error' }, 500);
  }
};

export const config = {
  path: '/api/qbo-sync',
};
