import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '../../lib/supabaseEnv';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  try {
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        // Heartbeat from a Web Worker instead of a main-thread setInterval.
        // Main-thread timers are throttled in backgrounded tabs / locked phones,
        // which silently starved the heartbeat until Supabase dropped the socket
        // (~60s), causing the cyclic "[realtime:core] TIMED_OUT — reconnecting"
        // and stalled live updates (chat, boards, notifications) while away.
        // The worker file is served same-origin to satisfy the CSP in
        // public/_headers (the realtime-js default is a Blob URL, which
        // script-src 'self' blocks). Protocol notes in public/realtime-worker.js.
        worker: true,
        workerUrl: '/realtime-worker.js',
      },
    });
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
    return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default supabase;
