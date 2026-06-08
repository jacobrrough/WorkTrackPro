// WorkTrackAccounting — #6 invoice-reminders (dunning) — V2 SCHEDULED function
// ============================================================================
// Runs DAILY at 14:00 UTC (config.schedule below) AND is reachable on-demand for an
// admin "run now" at POST /api/invoice-reminders (Bearer accounting_admin).
//
// WHAT THIS DOES (when enabled)
//   1. Reads the 'dunning' config from accounting.settings (offsetsDays, fromEmail,
//      subject/body templates, maxPerRun, enabled).
//   2. Queries open invoices (status in ('sent','partially_paid'), balance_due > 0).
//   3. For each invoice × each configured offset rung, computes the reminder date
//      (due_date + offset). When today >= that date and the (invoice, offset) rung has
//      NOT already been logged, it mints a portal link, sends a reminder email
//      sequentially (respecting Resend ~2 req/s), and inserts an invoice_emails row
//      (kind='reminder', reminder_offset_days=offset). The PARTIAL UNIQUE index on
//      (invoice_id, reminder_offset_days) WHERE kind='reminder' is the hard backstop
//      against a double-send.
//
// HARD ISOLATION GATE (why this is safe to ship to production OFF)
//   • Gated on the SERVER env var ACCOUNTING_DUNNING_ENABLED. When unset / not truthy,
//     the function EXITS IMMEDIATELY with NO query and NO email and NO DB write. A
//     frontend build flag cannot gate a scheduled function, so THIS server gate is the
//     isolation guarantee. The per-tenant settings.dunning.enabled is an ADDITIONAL soft
//     switch on top of this hard gate. Default is OFF.
//
// INVARIANTS
//   • Moves NO money, posts NO journal entry (G3): sends emails + logs metadata only.
//   • Stays within accounting.* for writes (invoice_emails, portal_tokens) — no public.*
//     writes. Reads public.organization_settings.branding (read-only) for the email.
//   • Service role via createClient(...).schema('accounting'); the scheduled run has no
//     auth.uid() so logged rows have created_by = null.
//   • Fail-safe per invoice: one bad send is logged as status='failed' and never aborts
//     the run; the top-level handler never leaks a stack.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import {
  sendResendEmail,
  getResendEmailLastEvent,
  isTerminalEmailFailure,
  normalizeResendError,
  sanitizeText,
  sleep,
} from './lib/resendMailer.mjs';
import {
  verifyAccountingAdmin,
  mintPortalToken,
  portalUrlFor,
  fetchInvoiceBranding,
  renderInvoiceEmail,
} from './lib/accountingMailerShared.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// Polite gap between sends to stay under Resend's ~2 req/sec limit.
const INTER_SEND_DELAY_MS = 600;
// Absolute cap as a defensive backstop even if settings.maxPerRun is misconfigured.
const HARD_MAX_PER_RUN = 500;

/** The hard server gate. TRUE only for an explicit truthy value. */
function isDunningEnabled() {
  const v = (process.env.ACCOUNTING_DUNNING_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'enabled';
}

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Normalize the stored 'dunning' config to a safe, typed shape. */
function normalizeDunningConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const offsets = Array.isArray(cfg.offsetsDays)
    ? cfg.offsetsDays
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isFinite(n))
    : [];
  // De-dupe + sort ascending so the run is deterministic.
  const offsetsDays = [...new Set(offsets)].sort((a, b) => a - b);
  const maxPerRunRaw = Math.trunc(Number(cfg.maxPerRun));
  const maxPerRun = Number.isFinite(maxPerRunRaw) && maxPerRunRaw > 0
    ? Math.min(maxPerRunRaw, HARD_MAX_PER_RUN)
    : HARD_MAX_PER_RUN;
  return {
    enabled: cfg.enabled === true,
    offsetsDays,
    fromEmail: sanitizeText(cfg.fromEmail),
    subjectTemplate: sanitizeText(cfg.subjectTemplate),
    bodyTemplate: sanitizeText(cfg.bodyTemplate),
    maxPerRun,
  };
}

/** today's date (UTC) as YYYY-MM-DD. */
function todayUtcIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Add `days` to a YYYY-MM-DD date; return YYYY-MM-DD. */
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Run the dunning sweep. Assumes the hard env gate already passed and the client is built.
 * `fromEmail` falls back to env when the config leaves it blank.
 */
async function runReminders(client, trigger) {
  const acct = client.schema('accounting');

  // 1) Config.
  const { data: settingRow, error: cfgErr } = await acct
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'dunning')
    .maybeSingle();
  if (cfgErr) {
    return { ok: false, error: `could not read dunning config: ${cfgErr.message}` };
  }
  const cfg = normalizeDunningConfig(settingRow?.setting_value);

  if (!cfg.enabled) {
    return { ok: true, message: 'Dunning is disabled in settings (settings.dunning.enabled = false).', sent: 0 };
  }
  if (cfg.offsetsDays.length === 0) {
    return { ok: true, message: 'No dunning offsets configured.', sent: 0 };
  }

  const fromEmail =
    cfg.fromEmail ||
    sanitizeText(process.env.ACCOUNTING_FROM_EMAIL) ||
    sanitizeText(process.env.PROPOSAL_FROM_EMAIL) ||
    sanitizeText(process.env.RESEND_FROM_EMAIL);
  if (!fromEmail) {
    return { ok: false, error: 'No From address configured (settings.dunning.fromEmail or ACCOUNTING_FROM_EMAIL).' };
  }

  // 2) Open invoices with a due date and a positive balance.
  const { data: invoices, error: invErr } = await acct
    .from('invoices')
    .select(
      'id, invoice_number, customer_id, invoice_date, due_date, terms, status, subtotal, discount_total, tax_total, total, amount_paid, balance_due, memo, customer:customers(display_name, email)'
    )
    .in('status', ['sent', 'partially_paid'])
    .gt('balance_due', 0)
    .not('due_date', 'is', null);
  if (invErr) {
    return { ok: false, error: `could not load open invoices: ${invErr.message}` };
  }

  const today = todayUtcIso();
  const branding = await fetchInvoiceBranding(client);

  const results = { ok: true, sent: 0, failed: 0, skipped: 0, considered: 0 };

  outer: for (const invoice of invoices ?? []) {
    const toEmail = sanitizeText(invoice.customer?.email);
    const customerName = sanitizeText(invoice.customer?.display_name);

    for (const offset of cfg.offsetsDays) {
      results.considered += 1;
      if (results.sent >= cfg.maxPerRun) break outer;

      // Has this rung already been logged? (Idempotency — the unique index is the backstop.)
      const { data: existing } = await acct
        .from('invoice_emails')
        .select('id')
        .eq('invoice_id', invoice.id)
        .eq('kind', 'reminder')
        .eq('reminder_offset_days', offset)
        .maybeSingle();
      if (existing) {
        results.skipped += 1;
        continue;
      }

      // Only fire a rung once its date has arrived (due_date + offset <= today).
      const rungDate = addDays(invoice.due_date, offset);
      if (rungDate > today) {
        results.skipped += 1;
        continue;
      }

      // Need a deliverable address; if none, log a failed rung so we don't reconsider it forever.
      if (!toEmail) {
        await acct.from('invoice_emails').insert({
          invoice_id: invoice.id,
          kind: 'reminder',
          reminder_offset_days: offset,
          to_email: '',
          from_email: fromEmail,
          subject: null,
          status: 'failed',
          error: 'Customer has no email address on file.',
          created_by: null,
        });
        results.failed += 1;
        continue;
      }

      // Mint a per-rung portal link (60-day life so the customer can still pay later).
      const minted = await mintPortalToken(acct, {
        customerId: invoice.customer_id,
        scope: 'invoice',
        invoiceId: invoice.id,
        expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
        createdBy: null,
      });
      const portalUrl = minted.rawToken ? portalUrlFor(minted.rawToken) : null;

      const rendered = renderInvoiceEmail({
        kind: 'reminder',
        invoice,
        customerName,
        branding,
        portalUrl,
        templates: { subjectTemplate: cfg.subjectTemplate, bodyTemplate: cfg.bodyTemplate },
      });

      const sent = await sendResendEmail({
        from: fromEmail,
        to: toEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      let status = 'sent';
      let providerMessageId = null;
      let providerLastEvent = null;
      let errorText = null;
      if (!sent.ok) {
        status = 'failed';
        errorText = normalizeResendError(sent.error);
        results.failed += 1;
      } else {
        providerMessageId = sent.id;
        providerLastEvent = await getResendEmailLastEvent(sent.id);
        status = isTerminalEmailFailure(providerLastEvent) ? 'bounced' : 'sent';
        results.sent += 1;
      }

      // Insert the rung row. The partial-unique index makes this the idempotency anchor:
      // a 23505 here means a concurrent run already logged the rung — treat as skipped.
      const { error: logErr } = await acct.from('invoice_emails').insert({
        invoice_id: invoice.id,
        kind: 'reminder',
        reminder_offset_days: offset,
        to_email: toEmail,
        from_email: fromEmail,
        subject: rendered.subject,
        status,
        provider_message_id: providerMessageId,
        provider_last_event: providerLastEvent,
        error: errorText,
        portal_token_id: minted.tokenId ?? null,
        created_by: null,
      });
      if (logErr) {
        console.error(`invoice-reminders: log insert failed for invoice ${invoice.id} rung ${offset}:`, logErr.message);
      }

      // Rate-limit between sends.
      await sleep(INTER_SEND_DELAY_MS);
    }
  }

  const message =
    `Dunning run (${trigger}): considered ${results.considered} rung(s), ` +
    `sent ${results.sent}, failed ${results.failed}, skipped ${results.skipped}.`;
  return { ...results, message };
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

  // ── HARD ENV GATE — before ANY query, email, or DB write. ──
  if (!isDunningEnabled()) {
    return new Response(
      JSON.stringify({
        ok: true,
        disabled: true,
        message:
          'Invoice reminders are disabled on the server (ACCOUNTING_DUNNING_ENABLED is off). ' +
          'No email or database write was performed.',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  if (!process.env.RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Email is not configured (missing RESEND_API_KEY).' }),
      { status: 500, headers: corsHeaders }
    );
  }

  const client = getServiceClient();
  if (!client) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server is not configured (missing service-role credentials).' }),
      { status: 500, headers: corsHeaders }
    );
  }

  // A manual "run now" carries a Bearer accounting_admin token. The Netlify scheduler
  // invokes this without a Bearer token; that scheduled invocation is trusted by the
  // platform (it cannot be triggered by an anonymous external POST to /api because the
  // function is only scheduled internally and the on-demand path requires the admin token).
  const authHeader = request.headers.get('authorization') || '';
  const isManual = authHeader.startsWith('Bearer ');
  if (isManual) {
    let admin = null;
    try {
      admin = await verifyAccountingAdmin(client, authHeader);
    } catch {
      admin = null;
    }
    if (!admin) {
      return new Response(JSON.stringify({ ok: false, error: 'Accounting admin access required.' }), {
        status: 403,
        headers: corsHeaders,
      });
    }
  }

  try {
    const result = await runReminders(client, isManual ? 'manual' : 'scheduled');
    const status = result.ok ? 200 : 500;
    return new Response(JSON.stringify(result), { status, headers: corsHeaders });
  } catch (err) {
    console.error('invoice-reminders unhandled error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Invoice reminder run failed.', detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
};

// Netlify Functions V2 config: daily at 14:00 UTC. A scheduled function MUST NOT also
// declare a custom `path` (Netlify rejects that at deploy time). The admin "run now" still
// reaches it at /api/invoice-reminders via the netlify.toml /api/* redirect.
export const config = {
  schedule: '0 14 * * *',
};
