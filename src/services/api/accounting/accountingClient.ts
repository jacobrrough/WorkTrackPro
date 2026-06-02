import { supabase } from '../supabaseClient';

/**
 * Scoped Supabase client for the dedicated `accounting` Postgres schema.
 *
 * All accounting tables live in their own schema (isolated + purely additive — no
 * existing `public` table is touched). supabase-js v2 reaches a non-public schema
 * via `.schema('accounting')`; this wrapper centralizes that so every accounting
 * service reads/writes the right schema.
 *
 * ISOLATION NOTE: the browser client can only see this schema once `accounting` is
 * added to the project's PostgREST "Exposed schemas" (Supabase Dashboard → Project
 * Settings → API). Until then these calls error by design — that is the
 * develop-in-isolation kill switch. Row-Level Security on every accounting table is
 * the real per-row guard regardless of exposure.
 *
 * Usage:
 *   acct().from('accounts').select('*')
 *   acct().rpc('post_journal_entry', { p_entry_id })
 */
export const acct = () => supabase.schema('accounting');
