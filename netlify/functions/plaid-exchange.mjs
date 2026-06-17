// Plaid — EXCHANGE PUBLIC TOKEN — WorkTrackAccounting bank-feeds backend.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// ADMIN-ONLY. Mirrors netlify/functions/qbo-oauth.mjs for the admin-auth + service-client
// + JSON-response skeleton and netlify/functions/ai-chat.mjs for the CORS headers.
//
// Completes a Plaid Link flow: the browser sends the short-lived public_token it received
// from react-plaid-link; we exchange it for the long-lived access_token + item_id, fetch the
// institution + account list, and UPSERT one accounting.plaid_items row (one per Item),
// storing the access_token ENCRYPTED at rest. The Item's accounts are returned (safe fields
// only) so the UI can map them onto bank accounts.
//
// SECURITY: the Plaid client_id/secret live in the function env only (read inside
// lib/plaid.mjs). The access_token is stored encrypted via tokenCrypto.mjs and is NEVER
// returned to the client and NEVER logged.
//
//   POST /api/plaid-exchange   (ADMIN)  body { publicToken }
//     -> { itemId, institutionName, accounts: [{ plaidAccountId, name, mask, subtype, type }] }

import { createClient } from '@supabase/supabase-js';
import {
  exchangePublicToken,
  getItem,
  getInstitution,
  getAccounts,
} from './lib/plaid.mjs';
import { encryptSecret } from './lib/tokenCrypto.mjs';

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
  const publicToken = typeof body?.publicToken === 'string' ? body.publicToken.trim() : '';
  if (!publicToken) return json({ error: 'publicToken is required' }, 400);

  try {
    // 1) Exchange the short-lived public_token for the long-lived access_token + item_id.
    const exchanged = await exchangePublicToken(publicToken);
    const accessToken = exchanged?.access_token;
    const plaidItemId = exchanged?.item_id;
    if (!accessToken || !plaidItemId) {
      console.error('plaid-exchange: Plaid returned no access_token/item_id');
      return json({ error: 'Plaid did not return an access token' }, 502);
    }

    // 2) Item metadata -> institution_id; then look up the display name.
    let institutionId = null;
    let institutionName = null;
    try {
      const itemRes = await getItem(accessToken);
      institutionId = itemRes?.item?.institution_id || null;
      if (institutionId) {
        const instRes = await getInstitution(institutionId);
        institutionName = instRes?.institution?.name || null;
      }
    } catch (err) {
      // Institution lookup is best-effort metadata; a connected Item is still valid
      // without a cached name. Never let it block the connection.
      console.error(
        'plaid-exchange institution lookup error:',
        err?.plaidErrorCode || err?.message || 'unknown'
      );
    }

    // 3) Account list (safe fields only) for the UI to map onto bank accounts.
    const accountsRes = await getAccounts(accessToken);
    const rawAccounts = Array.isArray(accountsRes?.accounts) ? accountsRes.accounts : [];
    const accounts = rawAccounts.map((a) => ({
      plaidAccountId: a.account_id,
      name: a.name,
      mask: a.mask,
      subtype: a.subtype,
      type: a.type,
    }));

    // 4) UPSERT the plaid_items row keyed on the Plaid item_id, storing the access_token
    //    ENCRYPTED at rest. cursor null = first sync starts fresh.
    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await plaidItemsTable(supabase).upsert(
      {
        item_id: plaidItemId,
        access_token: encryptSecret(accessToken),
        institution_id: institutionId,
        institution_name: institutionName,
        connected_by: admin.id,
        status: 'active',
        cursor: null,
        last_error: null,
        connected_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'item_id' }
    );
    if (upsertErr) {
      console.error('plaid-exchange upsert error:', upsertErr.message);
      return json({ error: 'Failed to save Plaid connection' }, 500);
    }

    // NEVER return access_token.
    return json({ itemId: plaidItemId, institutionName, accounts });
  } catch (err) {
    // lib/plaid.mjs throws an Error whose message is safe to surface (no secrets).
    console.error('plaid-exchange error:', err?.plaidErrorCode || err?.message || 'unknown');
    return json({ error: err?.message || 'Failed to exchange public token' }, 502);
  }
};

// Netlify Function config — V2 function on a single admin path.
export const config = {
  path: '/api/plaid-exchange',
};
