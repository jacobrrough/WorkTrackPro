import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '../../lib/supabaseEnv';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  try {
    _client = createClient(supabaseUrl, supabaseAnonKey);
    return _client;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Supabase connection failed: ${msg}. In Netlify env vars, remove any quotes around VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Use the "Anon key (Legacy)" from Supabase → API. Then: Clear cache and deploy site.`
    );
  }
}

/** Lazy-initialized Supabase client so invalid env shows setup screen instead of throwing at import time */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});

export default supabase;
