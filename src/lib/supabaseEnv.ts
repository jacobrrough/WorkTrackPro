/**
 * Validates Supabase env vars. Use for guarding app load and for trimming before createClient.
 * Supabase URL must be a valid HTTP/HTTPS URL (same check the Supabase client uses).
 */

const RAW_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const RAW_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** Must be valid URL per URL constructor and https + *.supabase.co (avoids "Invalid supabaseUrl" at createClient) */
export function isSupabaseUrlValid(): boolean {
  if (!RAW_URL) return false;
  try {
    const u = new URL(RAW_URL);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return u.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export function getSupabaseUrl(): string {
  return RAW_URL;
}

export function getSupabaseAnonKey(): string {
  return RAW_KEY;
}

export function isSupabaseConfigured(): boolean {
  return RAW_KEY.length > 0 && isSupabaseUrlValid();
}
