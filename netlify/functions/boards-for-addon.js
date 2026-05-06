import { createClient } from '@supabase/supabase-js';

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

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, boards }),
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
