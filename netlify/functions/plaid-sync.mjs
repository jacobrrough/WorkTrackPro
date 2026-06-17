// Plaid SYNC — WorkTrackAccounting bank-feeds backend (admin "Sync now").
//
// Netlify V2 function (export default async (request) => Response; export const config).
// Mirrors netlify/functions/qbo-oauth.mjs: same getServiceClient() + verifyAdminUser()
// (Bearer token -> supabase.auth.getUser(token) -> profiles.is_admin) and JSON responses
// with GENERIC error messages. Plaid access tokens are stored app-layer-ENCRYPTED on
// accounting.plaid_items and NEVER reach the browser — this function only ever returns
// counts, never a token.
//
// ENDPOINT
//   POST /api/plaid-sync   (ADMIN)   body { itemId? }
//     -> { synced, added, modified, removed, errors? }
//
// Loads the active accounting.plaid_items rows (the single `itemId` if supplied, else every
// row with status='active') and runs lib/plaidSync.mjs `syncItem()` for each, landing posted
// transactions in accounting.bank_transactions. ONE bad Item never aborts the rest: per-item
// failures are caught, recorded under `errors`, and the loop continues.

import { createClient } from '@supabase/supabase-js';
import { syncItem } from './lib/plaidSync.mjs';

const jsonHeaders = { 'Content-Type': 'application/json' };

// ── Supabase helpers (match qbo-oauth.mjs) ──────────────

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

// accounting is not the default schema; scope the table explicitly (matches qbo-oauth.mjs).
function acct(supabase, table) {
  return supabase.schema('accounting').from(table);
}

// ── Responses ───────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// Load the plaid_items to sync: the one `itemId` if given, else every active connection.
// Selects the full row so syncItem() has id/access_token/cursor.
async function loadItems(supabase, itemId) {
  let query = acct(supabase, 'plaid_items').select('*');
  if (itemId) {
    query = query.eq('id', itemId);
  } else {
    query = query.eq('status', 'active');
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load Plaid connections: ${error.message}`);
  return data || [];
}

// ── Main handler (Netlify V2) ───────────────────────────

export default async (request) => {
  const supabase = getServiceClient();
  if (!supabase) return json({ error: 'Bank feeds not configured' }, 500);

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Admin-only.
  const authHeader = request.headers.get('authorization') || '';
  const user = await verifyAdminUser(authHeader);
  if (!user) return json({ error: 'Admin access required' }, 403);

  try {
    // Body is optional; tolerate an empty/non-JSON body (a "sync all" with no payload).
    let itemId = null;
    try {
      const body = await request.json();
      if (body && typeof body.itemId === 'string' && body.itemId.trim()) {
        itemId = body.itemId.trim();
      }
    } catch {
      // no body / not JSON → sync all active items
    }

    const items = await loadItems(supabase, itemId);

    // Aggregate counts across every Item; collect per-item errors so one bad connection
    // doesn't abort the others (the response still reports what failed).
    let synced = 0;
    let added = 0;
    let modified = 0;
    let removed = 0;
    const errors = [];

    for (const row of items) {
      try {
        const counts = await syncItem(supabase, row);
        synced += 1;
        added += counts.added || 0;
        modified += counts.modified || 0;
        removed += counts.removed || 0;
      } catch (err) {
        // syncItem() already recorded the error on the plaid_items row + audit log and
        // threw a SAFE (non-secret) message. Surface it per-item; keep going.
        errors.push({ itemId: row.id, error: err?.message || 'Sync failed' });
      }
    }

    const result = { synced, added, modified, removed };
    if (errors.length > 0) result.errors = errors;
    return json(result);
  } catch (err) {
    console.error('plaid-sync unhandled error:', err?.message || err);
    return json({ error: 'Internal function error' }, 500);
  }
};

// Netlify Function config — V2 function. Reached at /api/plaid-sync via the netlify.toml
// /api/* redirect to /.netlify/functions/plaid-sync.
export const config = {
  path: '/api/plaid-sync',
};
