// Plaid — DISCONNECT ITEM — WorkTrackAccounting bank-feeds backend.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// ADMIN-ONLY. Mirrors netlify/functions/qbo-oauth.mjs for the admin-auth + service-client
// + JSON-response skeleton and netlify/functions/ai-chat.mjs for the CORS headers.
//
// Disconnects one Plaid Item: best-effort tells Plaid to /item/remove (revokes the token &
// stops billing), then marks the local plaid_items row 'disconnected' and NULLS its
// access_token — but KEEPS the row for history. It also clears the Plaid link columns on any
// accounting.bank_accounts wired to this Item so they stop syncing.
//
// SECURITY: the Plaid client_id/secret live in the function env only (read inside
// lib/plaid.mjs). The stored access_token is decrypted here solely to call /item/remove; it
// is NEVER returned to the client and NEVER logged.
//
//   POST /api/plaid-disconnect   (ADMIN)  body { itemId }  -> { ok: true }

import { createClient } from '@supabase/supabase-js';
import { removeItem } from './lib/plaid.mjs';
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

// accounting tables.
function plaidItemsTable(supabase) {
  return supabase.schema('accounting').from('plaid_items');
}
function bankAccountsTable(supabase) {
  return supabase.schema('accounting').from('bank_accounts');
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
  if (!itemId) return json({ error: 'itemId is required' }, 400);

  try {
    // Load the row (id for the bank-account unlink + access_token for the Plaid revoke).
    const { data: row, error: loadErr } = await plaidItemsTable(supabase)
      .select('id, access_token')
      .eq('item_id', itemId)
      .maybeSingle();
    if (loadErr) {
      console.error('plaid-disconnect load item error:', loadErr.message);
      return json({ error: 'Failed to load Plaid item' }, 500);
    }
    if (!row) return json({ error: 'Plaid item not found' }, 404);

    // Best-effort revoke at Plaid. Ignore Plaid errors — the Item may already be removed,
    // the token may be unreadable, or Plaid may be down; the local cleanup must still run.
    const accessToken = decryptSecret(row.access_token);
    if (accessToken) {
      try {
        await removeItem(accessToken);
      } catch (err) {
        console.error(
          'plaid-disconnect removeItem ignored:',
          err?.plaidErrorCode || err?.message || 'unknown'
        );
      }
    }

    // Mark the row disconnected and NULL the token, but KEEP the row for history.
    const { error: updErr } = await plaidItemsTable(supabase)
      .update({
        status: 'disconnected',
        access_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (updErr) {
      console.error('plaid-disconnect update item error:', updErr.message);
      return json({ error: 'Failed to disconnect Plaid item' }, 500);
    }

    // Unlink any bank accounts wired to this Item so they stop syncing.
    const { error: bankErr } = await bankAccountsTable(supabase)
      .update({ plaid_item_id: null, plaid_account_id: null })
      .eq('plaid_item_id', row.id);
    if (bankErr) {
      // The Item is already disconnected; surface the partial failure but don't crash.
      console.error('plaid-disconnect unlink bank_accounts error:', bankErr.message);
      return json({ error: 'Disconnected, but failed to unlink bank accounts' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('plaid-disconnect error:', err?.message || 'unknown');
    return json({ error: 'Internal function error' }, 500);
  }
};

// Netlify Function config — V2 function on a single admin path.
export const config = {
  path: '/api/plaid-disconnect',
};
