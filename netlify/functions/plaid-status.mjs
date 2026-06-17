// Plaid — CONNECTION STATUS — WorkTrackAccounting bank-feeds backend.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// ADMIN-ONLY, GET. Mirrors netlify/functions/qbo-oauth.mjs for the admin-auth +
// service-client + JSON-response skeleton and netlify/functions/ai-chat.mjs for the CORS
// headers.
//
// accounting.plaid_items is service-role-only (RLS on, no policy — the browser client can
// never read it), so THIS function is how the UI lists its Plaid connections. It returns
// ONLY the SAFE, non-secret columns — never access_token, never cursor.
//
//   GET /api/plaid-status   (ADMIN)
//     -> { items: [{ id, itemId, institutionName, status, lastError, lastSyncAt, connectedAt }] }

import { createClient } from '@supabase/supabase-js';

// ── CORS (mirror ai-chat.mjs; GET endpoint) ─────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
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
  if (request.method !== 'GET') {
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

  try {
    // SAFE columns ONLY — never select access_token or cursor.
    const { data, error } = await plaidItemsTable(supabase)
      .select('id, item_id, institution_name, status, last_error, last_sync_at, connected_at')
      .order('connected_at', { ascending: false });
    if (error) {
      console.error('plaid-status query error:', error.message);
      return json({ error: 'Failed to load Plaid connections' }, 500);
    }

    const items = (data || []).map((r) => ({
      id: r.id,
      itemId: r.item_id,
      institutionName: r.institution_name,
      status: r.status,
      lastError: r.last_error,
      lastSyncAt: r.last_sync_at,
      connectedAt: r.connected_at,
    }));

    return json({ items });
  } catch (err) {
    console.error('plaid-status error:', err?.message || 'unknown');
    return json({ error: 'Internal function error' }, 500);
  }
};

// Netlify Function config — V2 function on a single admin path.
export const config = {
  path: '/api/plaid-status',
};
