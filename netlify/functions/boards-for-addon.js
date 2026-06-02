import { createClient } from '@supabase/supabase-js';
// PHASE E (E5) — optional, server-gated rate limiting on this add-on helper endpoint. INERT by
// default (ACCOUNTING_SECURITY_HARDENING_ENABLED off ⇒ no-op), so existing behavior is unchanged
// until an operator enables hardening. When on, it adds a per-client-IP request cap.
import {
  isHardeningEnabled,
  rateLimit,
  clientKeyFromEvent,
  tooManyRequestsResponse,
  LIMITS,
} from './lib/securityHardening.mjs';

// Read-only endpoint: returns boards + columns for the Gmail Add-on dropdown.
// Authenticated via a static API key (GMAIL_ADDON_API_KEY env var).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

function verifyApiKey(event) {
  const key = process.env.GMAIL_ADDON_API_KEY;
  if (!key) return false;
  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7).trim() === key;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!verifyApiKey(event)) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // ── E5 rate limit (INERT unless ACCOUNTING_SECURITY_HARDENING_ENABLED). Throttle per client IP. ──
  if (isHardeningEnabled()) {
    const rl = rateLimit(clientKeyFromEvent(event, 'boards-for-addon'), LIMITS.addonPerMinute(), 60 * 1000);
    if (rl.limited) {
      return tooManyRequestsResponse(corsHeaders, rl.retryAfterSec);
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing server configuration' }),
    };
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Optionally scope to a specific user's boards via GMAIL_ADDON_USER_ID.
    const scopedUserId = (process.env.GMAIL_ADDON_USER_ID || '').trim() || null;

    let boardsQuery = supabase
      .from('boards')
      .select('id, name')
      .order('name', { ascending: true });

    if (scopedUserId) {
      boardsQuery = boardsQuery.eq('created_by', scopedUserId);
    }

    const { data: boardRows, error: boardErr } = await boardsQuery;
    if (boardErr) {
      console.error('boards-for-addon: board query failed:', boardErr.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch boards' }),
      };
    }

    const boardIds = (boardRows || []).map((b) => b.id);
    let columnRows = [];
    if (boardIds.length > 0) {
      const { data: cols, error: colErr } = await supabase
        .from('board_columns')
        .select('id, board_id, name, sort_order')
        .in('board_id', boardIds)
        .order('sort_order', { ascending: true });
      if (colErr) {
        console.error('boards-for-addon: column query failed:', colErr.message);
      } else {
        columnRows = cols || [];
      }
    }

    // Group columns by board.
    const colsByBoard = {};
    for (const col of columnRows) {
      if (!colsByBoard[col.board_id]) colsByBoard[col.board_id] = [];
      colsByBoard[col.board_id].push({ id: col.id, name: col.name });
    }

    const boards = (boardRows || []).map((b) => ({
      id: b.id,
      name: b.name,
      columns: colsByBoard[b.id] || [],
    }));

    // ── Job boards (Admin + Shop Floor) ────────────────
    // These use the jobs table with status values as columns.
    const ADMIN_COLUMNS = [
      { id: 'toBeQuoted', name: 'To Be Quoted' },
      { id: 'quoted', name: 'Quoted' },
      { id: 'rfqReceived', name: 'RFQ Received' },
      { id: 'rfqSent', name: 'RFQ Sent' },
      { id: 'pod', name: "PO'd" },
      { id: 'pending', name: 'Pending' },
      { id: 'inProgress', name: 'In Progress' },
      { id: 'qualityControl', name: 'Quality Control' },
      { id: 'onHold', name: 'On Hold' },
      { id: 'finished', name: 'Finished' },
      { id: 'delivered', name: 'Delivered' },
      { id: 'waitingForPayment', name: 'Waiting For Payment' },
      { id: 'projectCompleted', name: 'Project Completed' },
    ];
    const SHOP_COLUMNS = [
      { id: 'pending', name: 'Pending' },
      { id: 'inProgress', name: 'In Progress' },
      { id: 'qualityControl', name: 'Quality Control' },
      { id: 'finished', name: 'Finished' },
      { id: 'delivered', name: 'Delivered' },
      { id: 'onHold', name: 'On Hold' },
    ];

    const jobBoards = [
      { id: 'job-admin', name: 'Admin Board (Jobs)', columns: ADMIN_COLUMNS },
      { id: 'job-shopFloor', name: 'Shop Floor Board (Jobs)', columns: SHOP_COLUMNS },
    ];

    // Put job boards first since they're the primary boards.
    const allBoards = [...jobBoards, ...boards];

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, boards: allBoards }),
    };
  } catch (error) {
    console.error('boards-for-addon: unexpected error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected error',
      }),
    };
  }
}
