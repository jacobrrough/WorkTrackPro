/**
 * Validates Supabase env vars. Use for guarding app load and for trimming before createClient.
 * Normalizes so Netlify-stored values (e.g. with accidental quotes) still work.
 * Note: Vite bakes these at build time—after changing env vars in Netlify, trigger "Clear cache and deploy".
 */

function normalizeEnvValue(value: string): string {
  return value
    .replace(/^[\s"'\uFEFF]+|[\s"']+$/g, '') // trim whitespace, quotes, BOM
    .replace(/\/+$/, '');                     // no trailing slash (Supabase adds it)
}

const RAW_URL = normalizeEnvValue(String(import.meta.env.VITE_SUPABASE_URL ?? ''));
const RAW_KEY = normalizeEnvValue(String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''));

/** Must be valid URL per URL constructor and https + *.supabase.co (avoids "Invalid supabaseUrl" at createClient) */
export function isSupabaseUrlValid(): boolean {
  if (!RAW_URL) return false;
  try {
    const u = new URL(RAW_URL);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (!u.hostname.endsWith('.supabase.co')) return false;
    return true;
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
