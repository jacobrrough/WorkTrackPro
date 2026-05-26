import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

async function verifyAdminUser(event) {
  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const aiModelUrl = process.env.AI_MODEL_URL;
  const aiProxySecret = process.env.AI_PROXY_SECRET;
  if (!aiModelUrl || !aiProxySecret) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'AI service not configured' }),
    };
  }

  const user = await verifyAdminUser(event);
  if (!user) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Admin access required' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { messages } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'messages array is required' }),
    };
  }

  // Build the endpoint URL — AI_MODEL_URL may or may not include the path already.
  const baseUrl = aiModelUrl.replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/v1/chat/completions')
    ? baseUrl
    : `${baseUrl}/v1/chat/completions`;

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

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
      return {
        statusCode: 504,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'AI model request timed out' }),
      };
    }
    console.error('ai-chat fetch error:', error.message || error);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Unable to reach AI service',
        detail: error.message || 'Connection failed',
      }),
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('AI model error:', response.status, errorText);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'AI model returned an error',
        status: response.status,
        detail: errorText.slice(0, 200),
      }),
    };
  }

  let result;
  try {
    result = await response.json();
  } catch (parseError) {
    const raw = await response.text().catch(() => '');
    console.error('ai-chat JSON parse error:', parseError.message, 'body:', raw.slice(0, 500));
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'AI service returned invalid response' }),
    };
  }

  const reply = result.choices?.[0]?.message?.content ?? '';

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ ok: true, reply }),
  };
}
