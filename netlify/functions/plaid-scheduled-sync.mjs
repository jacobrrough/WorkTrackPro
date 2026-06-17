// Plaid SCHEDULED SYNC — WorkTrackAccounting bank-feeds daily auto-sync.
//
// Netlify V2 SCHEDULED function: it runs on a cron, NOT on an HTTP path. There is NO admin
// gate because there is no caller to authenticate — Netlify's internal scheduler invokes it
// as the platform (it carries no Bearer token), and it uses the service-role Supabase client
// (RLS-bypassing) exactly like netlify/functions/tax-table-refresh.mjs and qbo-oauth.mjs.
//
// Each run loads every accounting.plaid_items row with status='active' and runs
// lib/plaidSync.mjs `syncItem()` for each, landing new posted transactions in
// accounting.bank_transactions. Per-item failures are CAUGHT and logged (safely — no token,
// no PII) so one bad connection never aborts the daily batch; syncItem() itself records the
// failure on the plaid_items row + audit log. Plaid access tokens never leave the server.
//
// CRITICAL DEPLOY NOTE — a V2 scheduled function MUST declare ONLY `schedule` in its config
// and MUST NOT also set a custom `path`; Netlify rejects that at deploy time ("Scheduled
// functions must not specify a custom path"). So there is no /api/* route for this function
// and netlify.toml needs NO [functions] schedule block (V2 schedules are in-file only —
// mirrors tax-table-refresh.mjs / invoice-reminders.mjs).

import { createClient } from '@supabase/supabase-js';
import { syncItem } from './lib/plaidSync.mjs';

// Service-role client (mirrors qbo-oauth.mjs / tax-table-refresh.mjs). Bypasses RLS; the
// accounting schema is already exposed in PostgREST.
function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// accounting is not the default schema; scope the table explicitly (matches qbo-oauth.mjs).
function acct(supabase, table) {
  return supabase.schema('accounting').from(table);
}

export default async () => {
  const supabase = getServiceClient();
  if (!supabase) {
    console.error('plaid-scheduled-sync: Supabase service client not configured; skipping run');
    return new Response(JSON.stringify({ ok: false, error: 'not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let synced = 0;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let failed = 0;

  try {
    const { data: items, error } = await acct(supabase, 'plaid_items')
      .select('*')
      .eq('status', 'active');
    if (error) throw new Error(`Failed to load Plaid connections: ${error.message}`);

    for (const row of items || []) {
      try {
        const counts = await syncItem(supabase, row);
        synced += 1;
        added += counts.added || 0;
        modified += counts.modified || 0;
        removed += counts.removed || 0;
      } catch (err) {
        // syncItem() already flagged the item + audit row; log a SAFE message (its thrown
        // message is non-secret) and keep going so one bad Item can't abort the batch.
        failed += 1;
        console.error(`plaid-scheduled-sync: item ${row?.id} failed:`, err?.message || 'sync error');
      }
    }

    return new Response(JSON.stringify({ ok: true, synced, added, modified, removed, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Top-level fail-safe: never leak a stack; the daily batch degrades cleanly.
    console.error('plaid-scheduled-sync unhandled error:', err?.message || err);
    return new Response(JSON.stringify({ ok: false, error: 'Scheduled Plaid sync failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Netlify Functions V2 scheduled config — daily auto-sync. ONLY `schedule` here: a scheduled
// function must NOT also declare a custom `path` (that breaks the Netlify deploy).
export const config = {
  schedule: '@daily',
};
