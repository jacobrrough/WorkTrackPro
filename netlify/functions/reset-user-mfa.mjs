// Reset (remove) a user's enrolled MFA factors — ADMIN recovery path.
//
// Netlify V2 function (export default async (request) => Response; export const config).
// ADMIN-ONLY, POST. Mirrors netlify/functions/plaid-status.mjs for the admin-auth +
// service-client + CORS + JSON-response skeleton.
//
// This is the locked-out-user recovery escape hatch: when a user loses their TOTP
// authenticator and cannot complete the login MFA step, an admin clicks "Reset 2FA"
// in Admin Settings, which POSTs the user's id here. We delete ALL of that user's
// MFA factors with the service-role admin API so they can re-enroll on next login.
// Combined with the require_mfa org kill-switch, no user can ever be permanently
// locked out with no recovery.
//
//   POST /api/reset-user-mfa   (ADMIN)   body { userId }
//     -> { ok: true, removed: n }
//
// Never logs TOTP secrets, QR URIs, or factor secrets — only counts.

import { createClient } from '@supabase/supabase-js';

// ── CORS (mirror plaid-status.mjs; POST endpoint) ───────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// ── Supabase helpers (match plaid-status.mjs / qbo-oauth.mjs) ─
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

// ── Responses ───────────────────────────────────────────
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

// ── Main handler (Netlify V2) ───────────────────────────
export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return json({ error: 'Server not configured' }, 500);
  }

  // Admin gate.
  const authHeader = request.headers.get('authorization') || '';
  const admin = await verifyAdminUser(authHeader);
  if (!admin) return json({ error: 'Admin access required' }, 401);

  // Parse + validate the target user id.
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  if (!userId) {
    return json({ error: 'userId is required' }, 400);
  }

  try {
    // List the target user's MFA factors with the service-role admin API.
    const { data: factorsData, error: listError } = await supabase.auth.admin.mfa.listFactors({
      userId,
    });
    if (listError) {
      console.error('reset-user-mfa listFactors error:', listError.message);
      return json({ error: 'Failed to list MFA factors' }, 500);
    }

    const factors = factorsData?.factors || [];

    // Delete each factor. Deleting all of them clears both verified and any leftover
    // unverified enrollments so the user starts clean and can re-enroll on next login.
    let removed = 0;
    for (const factor of factors) {
      const { error: delError } = await supabase.auth.admin.mfa.deleteFactor({
        userId,
        id: factor.id,
      });
      if (delError) {
        console.error('reset-user-mfa deleteFactor error:', delError.message);
        return json({ error: 'Failed to remove an MFA factor' }, 500);
      }
      removed += 1;
    }

    return json({ ok: true, removed });
  } catch (err) {
    console.error('reset-user-mfa error:', err?.message || 'unknown');
    return json({ error: 'Internal function error' }, 500);
  }
};

// Netlify Function config — V2 function on a single admin path.
export const config = {
  path: '/api/reset-user-mfa',
};
