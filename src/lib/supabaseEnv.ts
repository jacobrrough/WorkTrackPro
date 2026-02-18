/**
 * Single source for Supabase URL and anon key. Values come ONLY from env:
 *   - Local: .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
 *   - Netlify: Site configuration → Environment variables (same names)
 * Validates and normalizes so Netlify-stored values (e.g. with accidental quotes) still work.
 * Vite bakes these at build time — after changing env vars in Netlify, trigger "Clear cache and deploy".
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
    // Must be https (http allowed for local dev but warn)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // Hostname must end with .supabase.co
    if (!u.hostname.endsWith('.supabase.co')) return false;
    // No path, query, or hash allowed (Supabase URL is just the base)
    if (u.pathname !== '/' && u.pathname !== '') return false;
    if (u.search) return false;
    if (u.hash) return false;
    // Hostname should match pattern: [project-ref].supabase.co
    const hostParts = u.hostname.split('.');
    if (hostParts.length !== 3 || hostParts[1] !== 'supabase' || hostParts[2] !== 'co') return false;
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
