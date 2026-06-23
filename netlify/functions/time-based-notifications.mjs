// WorkTrackPro — time-based-notifications — V2 SCHEDULED function
// ============================================================================
// Creates IN-APP notifications for time-based accounting conditions that have no row
// event to trigger on: overdue invoices (internal alert) and bills due soon / overdue.
// Recipients are accounting readers (approved admins + accounting.user_roles), respecting
// each reader's in_app preference. In-app only — this function never sends email and never
// moves money; the email channel (if enabled) picks these up like any other notification.
//
// Runs daily at 13:00 UTC (config.schedule below) AND is reachable on-demand for an admin
// "run now" at POST /api/time-based-notifications (Bearer admin) via the /api/* redirect.
//
// HARD ENV GATE: NOTIFICATION_TIME_BASED_ENABLED (default OFF) — when off, exits
// immediately with no query and no write.
//
// Anti-spam:
//   • Dedup window: an entity that already produced a notification of the same type in the
//     last 7 days is skipped (so an overdue invoice re-alerts at most weekly).
//   • Recency bound: only entities due within the last 90 days are considered, so first
//     enable cannot blast on an ancient backlog.
//   • Per-run cap on entities as a defensive backstop.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { sanitizeText } from './lib/resendMailer.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

const DEDUP_DAYS = 7;
const RECENCY_BOUND_DAYS = 90;
const BILL_DUE_SOON_DAYS = 3;
const HARD_MAX_ENTITIES = 200;

function isEnabled() {
  const v = (process.env.NOTIFICATION_TIME_BASED_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'enabled';
}

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function verifyAdmin(client, authHeader) {
  const token = sanitizeText(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) return false;
    const { data: profile } = await client
      .from('profiles')
      .select('is_admin, is_approved')
      .eq('id', user.id)
      .maybeSingle();
    return Boolean(profile && profile.is_admin === true && profile.is_approved === true);
  } catch {
    return false;
  }
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function money(n) {
  return Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function partyName(party) {
  if (!party) return null;
  return sanitizeText(party.display_name) || sanitizeText(party.company_name) || null;
}

/** Approved accounting readers + their in_app preference map. */
async function getAccountingReaders(client) {
  const [{ data: profiles }, { data: roleRows }] = await Promise.all([
    client.from('profiles').select('id, is_admin, is_approved').eq('is_approved', true),
    client.schema('accounting').from('user_roles').select('user_id'),
  ]);
  const roleUserIds = new Set((roleRows ?? []).map((r) => r.user_id));
  const readerIds = (profiles ?? [])
    .filter((p) => p.is_admin === true || roleUserIds.has(p.id))
    .map((p) => p.id);
  if (readerIds.length === 0) return [];

  const { data: prefRows } = await client
    .from('user_notification_preferences')
    .select('user_id, preferences')
    .in('user_id', readerIds);
  const prefsByUser = new Map((prefRows ?? []).map((r) => [r.user_id, r.preferences]));

  return readerIds.map((id) => ({ id, prefs: prefsByUser.get(id) }));
}

/** Entity ids that already got a notification of `type` within the dedup window. */
async function recentlyNotified(client, type, idKey) {
  const sinceIso = new Date(Date.now() - DEDUP_DAYS * 86400000).toISOString();
  const { data } = await client
    .from('system_notifications')
    .select('metadata')
    .eq('type', type)
    .gte('created_at', sinceIso);
  const seen = new Set();
  for (const row of data ?? []) {
    const id = row?.metadata?.[idKey];
    if (id) seen.add(id);
  }
  return seen;
}

/** Build one notification row per reader who hasn't muted this type in-app. */
function rowsForEntity(readers, type, title, message, link, metadata) {
  const rows = [];
  for (const reader of readers) {
    const inApp = reader.prefs?.in_app;
    // Default to notifying when the preference is absent (matches should_notify()).
    if (inApp && inApp[type] === false) continue;
    rows.push({ user_id: reader.id, type, title, message, link, metadata });
  }
  return rows;
}

async function run(client, trigger) {
  const readers = await getAccountingReaders(client);
  if (readers.length === 0) {
    return { ok: true, created: 0, message: 'No accounting readers to notify.' };
  }

  const acct = client.schema('accounting');
  const today = new Date().toISOString().slice(0, 10);
  const lowerBound = isoDaysFromNow(-RECENCY_BOUND_DAYS);
  const allRows = [];

  // ── Overdue invoices (internal alert) ──
  {
    const { data: invoices, error } = await acct
      .from('invoices')
      .select('id, invoice_number, due_date, balance_due, customer:customers(display_name, company_name)')
      .in('status', ['sent', 'partially_paid'])
      .gt('balance_due', 0)
      .lt('due_date', today)
      .gte('due_date', lowerBound)
      .order('due_date', { ascending: true })
      .limit(HARD_MAX_ENTITIES);
    if (error) return { ok: false, error: `overdue invoices query failed: ${error.message}` };

    const seen = await recentlyNotified(client, 'invoice_overdue', 'invoice_id');
    for (const inv of invoices ?? []) {
      if (seen.has(inv.id)) continue;
      const cust = partyName(inv.customer) || 'a customer';
      allRows.push(
        ...rowsForEntity(
          readers,
          'invoice_overdue',
          'Invoice Overdue',
          `Invoice ${sanitizeText(inv.invoice_number)} for ${cust} is overdue — $${money(inv.balance_due)} (due ${inv.due_date})`,
          `accounting-invoice:${inv.id}`,
          { invoice_id: inv.id, invoice_number: inv.invoice_number, balance_due: inv.balance_due, due_date: inv.due_date }
        )
      );
    }
  }

  // ── Bills due soon / overdue ──
  {
    const dueThrough = isoDaysFromNow(BILL_DUE_SOON_DAYS);
    const { data: bills, error } = await acct
      .from('bills')
      .select('id, bill_number, due_date, balance_due, vendor:vendors(display_name, company_name)')
      .in('status', ['open', 'partially_paid'])
      .gt('balance_due', 0)
      .lte('due_date', dueThrough)
      .gte('due_date', lowerBound)
      .order('due_date', { ascending: true })
      .limit(HARD_MAX_ENTITIES);
    if (error) return { ok: false, error: `bills due query failed: ${error.message}` };

    const seen = await recentlyNotified(client, 'bill_due_soon', 'bill_id');
    for (const bill of bills ?? []) {
      if (seen.has(bill.id)) continue;
      const vendor = partyName(bill.vendor) || 'a vendor';
      const overdue = bill.due_date < today;
      allRows.push(
        ...rowsForEntity(
          readers,
          'bill_due_soon',
          overdue ? 'Bill Overdue' : 'Bill Due Soon',
          `Bill ${sanitizeText(bill.bill_number)} from ${vendor} — $${money(bill.balance_due)} ${overdue ? 'was due' : 'due'} ${bill.due_date}`,
          `accounting-bill:${bill.id}`,
          { bill_id: bill.id, bill_number: bill.bill_number, balance_due: bill.balance_due, due_date: bill.due_date }
        )
      );
    }
  }

  // Insert in chunks.
  let created = 0;
  for (let i = 0; i < allRows.length; i += 500) {
    const chunk = allRows.slice(i, i + 500);
    const { error } = await client.from('system_notifications').insert(chunk);
    if (error) {
      console.error('time-based-notifications: insert failed:', error.message);
    } else {
      created += chunk.length;
    }
  }

  return {
    ok: true,
    created,
    message: `Time-based notifications (${trigger}): created ${created} notification(s) across ${readers.length} reader(s).`,
  };
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (!isEnabled()) {
    return new Response(
      JSON.stringify({
        ok: true,
        disabled: true,
        message:
          'Time-based notifications are disabled on the server (NOTIFICATION_TIME_BASED_ENABLED is off). ' +
          'No query or database write was performed.',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server is not configured (missing service-role credentials).' }),
      { status: 500, headers: corsHeaders }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const isManual = authHeader.startsWith('Bearer ');
  if (isManual) {
    const ok = await verifyAdmin(client, authHeader);
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: 'Admin access required.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }
  }

  try {
    const result = await run(client, isManual ? 'manual' : 'scheduled');
    return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: corsHeaders });
  } catch (err) {
    console.error('time-based-notifications unhandled error:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Time-based notification run failed.',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

// Netlify Functions V2 config: daily at 13:00 UTC. A scheduled function MUST NOT declare a
// custom `path`. The admin "run now" reaches it at /api/time-based-notifications.
export const config = {
  schedule: '0 13 * * *',
};
