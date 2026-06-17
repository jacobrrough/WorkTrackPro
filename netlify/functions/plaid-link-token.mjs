// Plaid — CREATE LINK TOKEN — WorkTrackAccounting bank-feeds backend.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// ADMIN-ONLY. Mirrors netlify/functions/qbo-oauth.mjs for the admin-auth + service-client
// + JSON-response skeleton and netlify/functions/ai-chat.mjs for the CORS headers.
//
// Mints a short-lived Plaid Link token the browser hands to react-plaid-link to open the
// Link flow. Two modes:
//   • initial connect  — body {}            -> createLinkToken({ clientUserId })
//   • re-auth / update  — body { itemId }   -> load that plaid_items row, DECRYPT its
//                         access_token, and createLinkToken({ clientUserId, accessToken })
//                         (Plaid UPDATE mode re-authenticates a broken Item).
//
// SECURITY: the Plaid client_id/secret live in the function env only (read inside
// lib/plaid.mjs). The stored access_token is decrypted here solely to pass it to Plaid in
// UPDATE mode; it is NEVER returned to the client and NEVER logged. The response is only
// { linkToken }.
//
//   POST /api/plaid-link-token   (ADMIN)  body { itemId? }  -> { linkToken }

import { createClient } from '@supabase/supabase-js';
import { createLinkToken } from './lib/plaid.mjs';
import { decryptSecret } from './lib/tokenCrypto.mjs';

// ── CORS (mirror ai-chat.mjs) ───────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// ── Supabase helpers (match qbo-oauth.mjs / ai-chat.mjs) ─
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

// accounting.plaid_items is the secret-bearing table (service-role only).
function plaidItemsTable(supabase) {
  return supabase.schema('accounting').from('plaid_items');
}

// ── Responses ───────────────────────────────────────────
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

// Fail-closed when the Plaid credentials are absent — never proceed unauthenticated.
function plaidConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// ── Main handler (Netlify V2) ───────────────────────────
export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Fail-closed if Plaid is not configured.
  if (!plaidConfigured()) {
    return json({ error: 'Plaid not configured' }, 500);
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return json({ error: 'Server not configured' }, 500);
  }

  // Admin gate.
  const authHeader = request.headers.get('authorization') || '';
  const admin = await verifyAdminUser(authHeader);
  if (!admin) return json({ error: 'Admin access required' }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const itemId = typeof body?.itemId === 'string' ? body.itemId.trim() : '';

  try {
    let accessToken;

    // UPDATE mode — load the Item and decrypt its access token to re-authenticate it.
    if (itemId) {
      const { data: row, error } = await plaidItemsTable(supabase)
        .select('access_token')
        .eq('item_id', itemId)
        .maybeSingle();
      if (error) {
        console.error('plaid-link-token load item error:', error.message);
        return json({ error: 'Failed to load Plaid item' }, 500);
      }
      if (!row) return json({ error: 'Plaid item not found' }, 404);

      accessToken = decryptSecret(row.access_token);
      if (!accessToken) {
        // Can't decrypt (key rotated / null token) — can't re-auth this Item.
        return json({ error: 'Unable to read stored Plaid token' }, 502);
      }
    }

    const result = await createLinkToken({ clientUserId: admin.id, accessToken });
    const linkToken = result?.link_token || null;
    if (!linkToken) {
      console.error('plaid-link-token: Plaid returned no link_token');
      return json({ error: 'Plaid did not return a link token' }, 502);
    }

    return json({ linkToken });
  } catch (err) {
    // lib/plaid.mjs throws an Error whose message is safe to surface (no secrets).
    console.error('plaid-link-token error:', err?.plaidErrorCode || err?.message || 'unknown');
    return json({ error: err?.message || 'Failed to create link token' }, 502);
  }
};

// Netlify Function config — V2 function on a single admin path.
export const config = {
  path: '/api/plaid-link-token',
};
