// QuickBooks Online (QBO) OAuth — WorkTrackAccounting Phase 0 backend.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// Mirrors netlify/functions/ai-chat.mjs: same getServiceClient() + admin-verify approach
// (Bearer token -> supabase.auth.getUser(token) -> profiles.is_admin) and JSON responses
// with GENERIC error messages. Tokens / secrets / client_secret are NEVER returned to the
// client or logged.
//
// The single accounting.qbo_connection row (service-role only; clients can't read tokens)
// holds the realm id, the rotating refresh_token, the short-lived access_token + expiry.
//
// ENDPOINTS
//   GET  /api/qbo-oauth?action=status        (ADMIN)  -> { connected, realmId?, companyName?, connectedAt?, lastSyncAt? }
//   GET  /api/qbo-oauth?action=authorize     (ADMIN)  -> { url }  (Intuit authorize URL, signed state)
//   GET  /api/qbo-oauth/callback?code&realmId&state (PUBLIC; Intuit calls it) -> 302 to the app
//   POST /api/qbo-oauth?action=disconnect    (ADMIN)  -> { ok: true }
//   GET  /api/qbo-oauth?action=companyinfo   (ADMIN)  -> { companyName, ... } (refreshes token if needed)

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// ── Intuit constants ────────────────────────────────────
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '75';
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// Front-end landing after the Intuit redirect (success / failure).
const APP_REDIRECT = '/app/accounting/integrations';

const jsonHeaders = { 'Content-Type': 'application/json' };

// ── Config / env ────────────────────────────────────────

function getConfig() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const environment = (process.env.QBO_ENVIRONMENT || 'sandbox').toLowerCase();
  if (!clientId || !clientSecret || !redirectUri) return null;
  const apiBase =
    environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';
  return { clientId, clientSecret, redirectUri, environment, apiBase };
}

// ── Supabase helpers (match ai-chat.mjs) ────────────────

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

// ── Signed-state (CSRF) helpers ─────────────────────────
// state = base64url(JSON({nonce, ts})) + '.' + hex(HMAC_SHA256(body, client_secret)).
// Callback verifies the HMAC (constant-time) and that ts is < 10 min old.

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecodeToString(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

function signState(clientSecret) {
  const body = base64urlEncode(
    JSON.stringify({ nonce: crypto.randomBytes(16).toString('hex'), ts: Date.now() })
  );
  const sig = crypto.createHmac('sha256', clientSecret).update(body).digest('hex');
  return `${body}.${sig}`;
}

function verifyState(state, clientSecret) {
  if (typeof state !== 'string' || !state.includes('.')) return false;
  const idx = state.lastIndexOf('.');
  const body = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  if (!body || !sig) return false;

  const expected = crypto.createHmac('sha256', clientSecret).update(body).digest('hex');
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws otherwise).
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const parsed = JSON.parse(base64urlDecodeToString(body));
    if (!parsed || typeof parsed.ts !== 'number') return false;
    if (Date.now() - parsed.ts > STATE_MAX_AGE_MS) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Token exchange / refresh ────────────────────────────

function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

// Exchange the authorization code for the first token set.
async function exchangeCodeForTokens(cfg, code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
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
    console.error('qbo-oauth token exchange failed:', resp.status, text.slice(0, 300));
    return null;
  }
  return resp.json().catch(() => null);
}

// Use the stored refresh_token to mint a new access token. Intuit ROTATES the refresh
// token on most refreshes, so the caller MUST persist the returned refresh_token.
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
    console.error('qbo-oauth token refresh failed:', resp.status, text.slice(0, 300));
    return null;
  }
  return resp.json().catch(() => null);
}

// Ensure a non-expired access token, refreshing + PERSISTING the rotated token if needed.
// Returns { accessToken, realmId } or null. `conn` is the current qbo_connection row.
// 60s safety skew so we never hand out an about-to-expire token.
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

  // PERSIST the rotated refresh token (fall back to the old one if Intuit omitted it).
  const { error } = await supabase
    .from('qbo_connection')
    .update({
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      refresh_token: tokens.refresh_token || conn.refresh_token,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);
  if (error) {
    console.error('qbo-oauth failed to persist refreshed token:', error.message);
    return null;
  }

  return { accessToken: tokens.access_token, realmId: conn.realm_id };
}

// ── accounting.qbo_connection access ────────────────────
// The accounting schema is not the default; .schema('accounting') scopes the table.

function qboTable(supabase) {
  return supabase.schema('accounting').from('qbo_connection');
}

async function loadConnection(supabase) {
  const { data, error } = await qboTable(supabase).select('*').limit(1).maybeSingle();
  if (error) {
    console.error('qbo-oauth loadConnection error:', error.message);
    return null;
  }
  return data || null;
}

// ── Responses ───────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function notConfigured() {
  return json({ error: 'QuickBooks not configured' }, 500);
}

function redirectTo(path) {
  return new Response(null, { status: 302, headers: { Location: path } });
}

// ── Endpoint handlers ───────────────────────────────────

async function handleStatus(supabase) {
  const conn = await loadConnection(supabase);
  if (!conn) return json({ connected: false });
  return json({
    connected: true,
    realmId: conn.realm_id,
    companyName: conn.company_name || null,
    connectedAt: conn.connected_at || null,
    lastSyncAt: conn.last_sync_at || null,
    // Incremental-sync high-water mark (set to the prior run's START time, so records
    // changed during that run are still picked up by the next one).
    lastCdcCursor: conn.last_cdc_cursor || null,
  });
}

async function handleAuthorize(cfg, user) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    scope: SCOPE,
    redirect_uri: cfg.redirectUri,
    state: signState(cfg.clientSecret),
  });
  // `user` is the verified admin; recorded on connect via the callback (which is public),
  // so we do not need it in the URL — kept in scope for clarity / future per-user state.
  void user;
  return json({ url: `${AUTH_URL}?${params.toString()}` });
}

async function handleDisconnect(supabase) {
  const conn = await loadConnection(supabase);
  if (conn) {
    const { error } = await qboTable(supabase).delete().eq('id', conn.id);
    if (error) {
      console.error('qbo-oauth disconnect error:', error.message);
      return json({ error: 'Failed to disconnect' }, 500);
    }
  }
  return json({ ok: true });
}

async function handleCompanyInfo(supabase, cfg) {
  const conn = await loadConnection(supabase);
  if (!conn) return json({ error: 'Not connected' }, 400);

  const valid = await ensureValidAccessToken(supabase, cfg, conn);
  if (!valid) return json({ error: 'Unable to obtain a valid QuickBooks token' }, 502);

  const url = `${cfg.apiBase}/v3/company/${valid.realmId}/companyinfo/${valid.realmId}?minorversion=${MINOR_VERSION}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${valid.accessToken}` },
    });
  } catch (err) {
    console.error('qbo-oauth companyinfo fetch error:', err?.message || err);
    return json({ error: 'Unable to reach QuickBooks' }, 502);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('qbo-oauth companyinfo error:', resp.status, text.slice(0, 300));
    return json({ error: 'QuickBooks returned an error' }, 502);
  }

  const data = await resp.json().catch(() => null);
  const info = data?.CompanyInfo || {};
  const companyName = info.CompanyName || info.LegalName || null;

  // Cache the company name + mark this as the last successful sync.
  const { error: updErr } = await qboTable(supabase)
    .update({
      company_name: companyName,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);
  if (updErr) console.error('qbo-oauth companyinfo persist error:', updErr.message);

  return json({
    companyName,
    legalName: info.LegalName || null,
    country: info.Country || null,
    realmId: valid.realmId,
  });
}

// PUBLIC — Intuit redirects the browser here after the user authorizes. Always end in a
// 302 back to the app (never a JSON error page), with ?qbo=connected or ?qbo=error.
async function handleCallback(request, cfg, supabase) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error'); // e.g. access_denied

  if (errorParam) {
    return redirectTo(`${APP_REDIRECT}?qbo=error`);
  }
  if (!code || !realmId || !verifyState(state, cfg.clientSecret)) {
    console.error('qbo-oauth callback rejected: missing params or bad state');
    return redirectTo(`${APP_REDIRECT}?qbo=error`);
  }

  const tokens = await exchangeCodeForTokens(cfg, code);
  if (!tokens || !tokens.access_token || !tokens.refresh_token) {
    return redirectTo(`${APP_REDIRECT}?qbo=error`);
  }

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000).toISOString();

  // Upsert the SINGLE connection row. The DB enforces a singleton (partial unique index on
  // a constant); delete-then-insert keeps "one row" regardless of which row already exists.
  const existing = await loadConnection(supabase);
  const row = {
    realm_id: realmId,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt,
    connected_at: nowIso,
    updated_at: nowIso,
  };

  let dbError = null;
  if (existing) {
    const { error } = await qboTable(supabase).update(row).eq('id', existing.id);
    dbError = error;
  } else {
    const { error } = await qboTable(supabase).insert(row);
    dbError = error;
  }
  if (dbError) {
    console.error('qbo-oauth callback persist error:', dbError.message);
    return redirectTo(`${APP_REDIRECT}?qbo=error`);
  }

  return redirectTo(`${APP_REDIRECT}?qbo=connected`);
}

// ── Main handler (Netlify V2) ───────────────────────────

export default async (request) => {
  const url = new URL(request.url);
  const isCallback = url.pathname.endsWith('/callback');

  const cfg = getConfig();
  const supabase = getServiceClient();

  // The public callback must still degrade to the app (never a raw error) when misconfigured.
  if (!cfg || !supabase) {
    if (isCallback) return redirectTo(`${APP_REDIRECT}?qbo=error`);
    return notConfigured();
  }

  try {
    // PUBLIC callback — no admin gate (Intuit's browser redirect carries the signed state).
    if (isCallback) {
      return await handleCallback(request, cfg, supabase);
    }

    // Everything else is admin-only.
    const authHeader = request.headers.get('authorization') || '';
    const user = await verifyAdminUser(authHeader);
    if (!user) return json({ error: 'Admin access required' }, 403);

    const action = url.searchParams.get('action');

    if (request.method === 'POST') {
      if (action === 'disconnect') return await handleDisconnect(supabase);
      return json({ error: 'Unknown action' }, 400);
    }

    if (request.method === 'GET') {
      if (action === 'status') return await handleStatus(supabase);
      if (action === 'authorize') return await handleAuthorize(cfg, user);
      if (action === 'companyinfo') return await handleCompanyInfo(supabase, cfg);
      return json({ error: 'Unknown action' }, 400);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('qbo-oauth unhandled error:', err?.message || err);
    if (isCallback) return redirectTo(`${APP_REDIRECT}?qbo=error`);
    return json({ error: 'Internal function error' }, 500);
  }
};

// Netlify Function config — V2 function on two paths (admin actions + Intuit callback).
export const config = {
  path: ['/api/qbo-oauth', '/api/qbo-oauth/callback'],
};
