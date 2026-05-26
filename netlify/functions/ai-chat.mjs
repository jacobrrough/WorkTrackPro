import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

async function verifyAdminUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

export default async (request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    return await handlePost(request);
  } catch (err) {
    console.error('ai-chat unhandled error:', err);
    return new Response(
      JSON.stringify({
        error: 'Internal function error',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

async function handlePost(request) {
  const aiModelUrl = process.env.AI_MODEL_URL;
  const aiProxySecret = process.env.AI_PROXY_SECRET;
  if (!aiModelUrl || !aiProxySecret) {
    return new Response(JSON.stringify({ error: 'AI service not configured' }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const authHeader = request.headers.get('authorization') || '';
  const user = await verifyAdminUser(authHeader);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { messages } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array is required' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Build the endpoint URL — AI_MODEL_URL may omit the protocol or trailing path.
  const withProtocol = /^https?:\/\//i.test(aiModelUrl) ? aiModelUrl : `https://${aiModelUrl}`;
  const baseUrl = withProtocol.replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/v1/chat/completions')
    ? baseUrl
    : `${baseUrl}/v1/chat/completions`;

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiProxySecret}`,
      },
      body: JSON.stringify({
        messages,
        model: 'default',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (error) {
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'AI model request timed out' }), {
        status: 504,
        headers: corsHeaders,
      });
    }
    console.error('ai-chat fetch error:', error.message || error);
    return new Response(
      JSON.stringify({
        error: 'Unable to reach AI service',
        detail: error.message || 'Connection failed',
      }),
      { status: 502, headers: corsHeaders }
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('AI model error:', response.status, errorText);
    return new Response(
      JSON.stringify({
        error: 'AI model returned an error',
        status: response.status,
        detail: errorText.slice(0, 200),
      }),
      { status: 502, headers: corsHeaders }
    );
  }

  // Read body as text first, then parse.
  const rawBody = await response.text().catch(() => '');
  let result;
  try {
    result = JSON.parse(rawBody);
  } catch (parseError) {
    console.error('ai-chat JSON parse error:', parseError.message, 'body:', rawBody.slice(0, 500));
    return new Response(JSON.stringify({ error: 'AI service returned invalid response' }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  const reply = result.choices?.[0]?.message?.content ?? '';

  return new Response(JSON.stringify({ ok: true, reply }), {
    status: 200,
    headers: corsHeaders,
  });
}

// Netlify Function config — V2 functions have a longer default timeout.
export const config = {
  path: '/api/ai-chat',
};
