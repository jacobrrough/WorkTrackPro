import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '../../lib/supabaseEnv';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  _client = createClient(supabaseUrl, supabaseAnonKey);
  return _client;
}

/** Lazy-initialized Supabase client so invalid env shows setup screen instead of throwing at import time */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});

export default supabase;
