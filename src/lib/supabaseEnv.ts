/**
 * Validates Supabase env vars. Use for guarding app load and for trimming before createClient.
 * Supabase URL must be: https://<project-ref>.supabase.co (optional trailing slash).
 */

const RAW_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const RAW_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

// Must be https and contain .supabase.co (no path, no query)
const SUPABASE_URL_PATTERN = /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/;

export function getSupabaseUrl(): string {
  return RAW_URL;
}

export function getSupabaseAnonKey(): string {
  return RAW_KEY;
}

export function isSupabaseUrlValid(): boolean {
  return SUPABASE_URL_PATTERN.test(RAW_URL);
}

export function isSupabaseConfigured(): boolean {
  return RAW_KEY.length > 0 && isSupabaseUrlValid();
}
