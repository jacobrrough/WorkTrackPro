// WorkTrackAccounting — #7 portal-invoice (PUBLIC, token-gated)
// ============================================================================
// POST /api/portal-invoice  { token }
//
// The customer portal (src/public/portal/CustomerPortal.tsx) calls this with the opaque
// token from the /portal/<token> URL. This is the ONLY way the portal reads accounting
// data — the browser NEVER gets a Supabase/accounting client.
//
// WHAT THIS DOES
//   1. Rate-limits by IP via public.check_rate_limit (fail-open on limiter error so an
//      outage can't lock out legitimate customers).
//   2. Hashes the opaque token with node:crypto SHA-256 (the DB stores ONLY the hash).
//   3. Calls accounting.portal_invoice_payload(p_token_hash) via a SERVICE-ROLE client.
//      That SECURITY DEFINER function validates the token (exists, not revoked, not
//      expired), bumps last_used_at, and returns ONLY a safe projection (invoice header +
//      lines + customer display name + balance + statement) — never journal_entry_id,
//      cost, or internal notes.
//   4. Returns that payload, or 404 for an invalid/expired/revoked token.
//
// SECURITY
//   • The token is read from the POST BODY (not the URL/query) so it does not land in
//     access logs / referrers.
//   • The token comparison is delegated to the DB function (exact hash match). The token's
//     256-bit entropy + the service-role-only payload RPC are the real gate; the shape check
//     is not security-critical.
//   • CORS is LOCKED to the site origin (APP_PUBLIC_URL) and is OMITTED (never '*') if unset.
//   • Moves NO money, posts NO journal entry — read-only.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

function resolveAllowedOrigin() {
  const base = (process.env.APP_PUBLIC_URL ?? '').trim();
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

// Lock CORS to the configured site origin. NEVER fall back to '*': if APP_PUBLIC_URL is
// unset/unparseable we OMIT the Allow-Origin header (browsers then block cross-origin reads)
// rather than open the endpoint to every origin (security review M-2).
const ALLOWED_ORIGIN = resolveAllowedOrigin();
const corsHeaders = {
  ...(ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } : {}),
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Opaque tokens are 32 random bytes base64url-encoded (~43 url-safe chars). We only sanity-check
 * the SHAPE here — the real gate is the DB hash lookup (the token's 256-bit entropy + the
 * service-role-only payload RPC), so no constant-time games are needed on the format check.
 */
function isWellFormedToken(token) {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (t.length < 40 || t.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Portal is not configured.' }),
      { status: 500, headers: corsHeaders }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request body.' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!isWellFormedToken(token)) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid or expired link.' }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  // Per-IP rate limit. Use ONLY Netlify's trusted client-IP header — never the spoofable
  // x-forwarded-for (an attacker could otherwise evade the limit or poison others' buckets;
  // security review M-3). Fail-open on limiter error: 256-bit tokens make brute force infeasible
  // regardless, so availability for legitimate customers wins on a limiter outage.
  const ip = request.headers.get('x-nf-client-connection-ip') || 'unknown';
  try {
    const { data: allowed } = await client.rpc('check_rate_limit', {
      p_key: `portal-invoice:${ip}`,
      p_max: 10,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Too many requests. Please try again shortly.' }),
        { status: 429, headers: corsHeaders }
      );
    }
  } catch (rateLimitError) {
    console.error('portal-invoice rate limit check failed (failing open):', rateLimitError?.message || rateLimitError);
  }

  // Hash the opaque token; only the hash is ever sent to / stored in the DB.
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  try {
    const { data, error } = await client
      .schema('accounting')
      .rpc('portal_invoice_payload', { p_token_hash: tokenHash });

    if (error) {
      console.error('portal-invoice payload rpc error:', error.message);
      return new Response(JSON.stringify({ ok: false, error: 'Unable to load this invoice.' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // The function returns NULL for a missing/revoked/expired token.
    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid or expired link.' }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ ok: true, payload: data }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error('portal-invoice unhandled error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Unable to load this invoice.' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};
