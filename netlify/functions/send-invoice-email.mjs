// WorkTrackAccounting — #6 send-invoice-email (on-demand, admin-authed)
// ============================================================================
// POST /api/send-invoice-email  { invoiceId, toEmail?, subject?, scope?, expiresInDays? }
//
// WHAT THIS DOES (manual "Email invoice" from the invoice detail view):
//   1. Authorizes the caller as an accounting_admin (Bearer token; mirrors
//      tax-table-refresh.mjs / accounting.has_role('accounting_admin')).
//   2. Loads the invoice (service-role; accounting schema) + its customer.
//   3. Mints a portal token: inserts a portal_tokens row holding ONLY the SHA-256 hash;
//      the RAW token is returned exactly once, embedded in the portal link.
//   4. Sends the invoice email via the shared resendMailer with that portal link.
//   5. Writes an accounting.invoice_emails row (kind='manual_send') capturing the recipient,
//      the Resend message id + last delivery event, and the minted portal_token_id.
//
// SAFETY / INVARIANTS
//   • Moves NO money, posts NO journal entry (G3): it only sends an email + logs metadata.
//   • Service role via createClient(...).schema('accounting') (same pattern as the other
//     accounting functions); RLS is bypassed by the service role, but the ADMIN CHECK above
//     is the authorization gate.
//   • The recipient defaults to the customer's email; an explicit toEmail is validated.
//   • CORS locked to the site origin via APP_PUBLIC_URL (falls back to '*').
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import {
  sendResendEmail,
  getResendEmailLastEvent,
  isTerminalEmailFailure,
  normalizeResendError,
  sanitizeText,
} from './lib/resendMailer.mjs';
import {
  verifyAccountingAdmin,
  mintPortalToken,
  portalUrlFor,
  fetchInvoiceBranding,
  renderInvoiceEmail,
} from './lib/accountingMailerShared.mjs';

function resolveAllowedOrigin() {
  const base = sanitizeText(process.env.APP_PUBLIC_URL);
  if (!base) return '*';
  try {
    return new URL(base).origin;
  } catch {
    return '*';
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': resolveAllowedOrigin(),
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // ── Authorize: accounting_admin only. ──
  const authHeader = request.headers.get('authorization') || '';
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

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request body.' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const invoiceId = sanitizeText(payload?.invoiceId);
  if (!invoiceId) {
    return new Response(JSON.stringify({ ok: false, error: 'invoiceId is required.' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
  const scope = payload?.scope === 'customer' ? 'customer' : 'invoice';
  const explicitTo = sanitizeText(payload?.toEmail);
  const explicitSubject = sanitizeText(payload?.subject);
  const expiresInDays = Number(payload?.expiresInDays);

  const acct = client.schema('accounting');

  try {
    // Load the invoice header + its customer (display name + email).
    const { data: invoice, error: invErr } = await acct
      .from('invoices')
      .select(
        'id, invoice_number, customer_id, invoice_date, due_date, terms, status, subtotal, discount_total, tax_total, total, amount_paid, balance_due, memo, customer:customers(display_name, email)'
      )
      .eq('id', invoiceId)
      .maybeSingle();
    if (invErr) {
      return new Response(JSON.stringify({ ok: false, error: invErr.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    if (!invoice) {
      return new Response(JSON.stringify({ ok: false, error: 'Invoice not found.' }), {
        status: 404,
        headers: corsHeaders,
      });
    }
    if (invoice.status === 'draft') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Send the invoice before emailing it (it is still a draft).' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const customerName = sanitizeText(invoice.customer?.display_name);
    const toEmail = explicitTo || sanitizeText(invoice.customer?.email);
    if (!toEmail || !EMAIL_RE.test(toEmail)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: explicitTo
            ? 'Please provide a valid recipient email address.'
            : 'This customer has no email address on file. Add one or supply a recipient.',
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    const fromEmail =
      sanitizeText(process.env.ACCOUNTING_FROM_EMAIL) ||
      sanitizeText(process.env.PROPOSAL_FROM_EMAIL) ||
      sanitizeText(process.env.RESEND_FROM_EMAIL);
    if (!fromEmail) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No From address configured (set ACCOUNTING_FROM_EMAIL).' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Mint the portal token (store hash only; raw token goes into the link).
    const expiresAt =
      Number.isFinite(expiresInDays) && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
        : new Date(Date.now() + 30 * 86400000).toISOString(); // default 30-day link
    const minted = await mintPortalToken(acct, {
      customerId: invoice.customer_id,
      scope,
      invoiceId: invoice.id,
      expiresAt,
      createdBy: admin.id,
    });
    if (minted.error) {
      return new Response(JSON.stringify({ ok: false, error: minted.error }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    const portalUrl = portalUrlFor(minted.rawToken);

    const branding = await fetchInvoiceBranding(client);
    const rendered = renderInvoiceEmail({
      kind: 'manual_send',
      invoice,
      customerName,
      branding,
      portalUrl,
    });
    const subject = explicitSubject || rendered.subject;

    const sent = await sendResendEmail({
      from: fromEmail,
      to: toEmail,
      subject,
      html: rendered.html,
      text: rendered.text,
    });

    // Log the attempt regardless of outcome.
    let status = 'queued';
    let providerMessageId = null;
    let providerLastEvent = null;
    let errorText = null;
    if (!sent.ok) {
      status = 'failed';
      errorText = normalizeResendError(sent.error);
    } else {
      providerMessageId = sent.id;
      providerLastEvent = await getResendEmailLastEvent(sent.id);
      status = isTerminalEmailFailure(providerLastEvent) ? 'bounced' : 'sent';
    }

    const { error: logErr } = await acct.from('invoice_emails').insert({
      invoice_id: invoice.id,
      kind: 'manual_send',
      reminder_offset_days: null,
      to_email: toEmail,
      from_email: fromEmail,
      subject,
      status,
      provider_message_id: providerMessageId,
      provider_last_event: providerLastEvent,
      error: errorText,
      portal_token_id: minted.tokenId,
      created_by: admin.id,
    });
    if (logErr) {
      console.error('send-invoice-email: failed to write invoice_emails row:', logErr.message);
    }

    if (status === 'failed') {
      return new Response(JSON.stringify({ ok: false, error: errorText || 'Email failed to send.' }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, status, toEmail, portalUrl, tokenId: minted.tokenId }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error('send-invoice-email unhandled error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to send the invoice email.' }),
      { status: 500, headers: corsHeaders }
    );
  }
};
