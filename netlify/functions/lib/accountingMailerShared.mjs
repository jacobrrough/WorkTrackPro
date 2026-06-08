// Shared server-side helpers for the accounting email + dunning + portal functions.
// Pure ESM. The Supabase client itself is created by each function (so each can fail
// independently); this module only holds the cross-function logic they all need:
//   • verifyAccountingAdmin()  — Bearer-token → accounting_admin check (mirrors
//                                tax-table-refresh.mjs, which mirrors accounting.has_role).
//   • mintPortalToken()        — generate an opaque token, insert ONLY its SHA-256 hash as a
//                                portal_tokens row, and return { rawToken, tokenId }.
//   • hashPortalToken()        — SHA-256 (hex) of a raw token (the portal function hashes the
//                                URL token the same way before calling portal_invoice_payload).
//   • fetchInvoiceBranding()   — read public.organization_settings.branding for the PDF/email.
//   • renderInvoiceEmail()     — build the {subject, html, text} for one invoice email from a
//                                template + the invoice + the portal link.
//   • portalUrlFor()           — build the public /portal/<token> URL from APP_PUBLIC_URL.

import { randomBytes, createHash } from 'node:crypto';
import { escapeHtml, sanitizeText } from './resendMailer.mjs';

/** Format a dollar amount as USD for email/templates (server-side, no Intl locale surprises). */
export function formatMoney(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toFixed(2)}`;
}

/** SHA-256 (hex) of a raw token. The stored portal_tokens.token_hash is exactly this. */
export function hashPortalToken(rawToken) {
  return createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

/**
 * Resolve the caller from a Bearer token and confirm accounting_admin authority (global
 * approved admin OR the accounting_admin role). Returns the user or null. `pub` is a
 * service-role client (public schema; .schema('accounting') used for the role check).
 * Mirrors tax-table-refresh.mjs verifyAccountingAdmin.
 */
export async function verifyAccountingAdmin(pub, authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const {
    data: { user },
    error: authError,
  } = await pub.auth.getUser(token);
  if (authError || !user) return null;

  const { data: profile } = await pub
    .from('profiles')
    .select('is_admin, is_approved')
    .eq('id', user.id)
    .single();
  if (profile && profile.is_admin && profile.is_approved !== false) return user;

  const { data: roleRow } = await pub
    .schema('accounting')
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'accounting_admin')
    .maybeSingle();
  if (roleRow) return user;

  return null;
}

/**
 * Mint a portal token: generate a high-entropy opaque token, store ONLY its SHA-256 hash
 * as a portal_tokens row, and return { rawToken, tokenId }. The raw token is never stored.
 *
 * @param acct        service-role client already scoped via .schema('accounting')
 * @param customerId  owning customer (required)
 * @param scope       'invoice' | 'customer'
 * @param invoiceId   required for scope 'invoice', null for 'customer'
 * @param expiresAt   ISO string or null
 * @param createdBy   profile id of the admin (null for the scheduled cron)
 */
export async function mintPortalToken(acct, { customerId, scope, invoiceId, expiresAt, createdBy }) {
  // 32 random bytes → base64url: opaque, URL-safe, ~43 chars, ample entropy.
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashPortalToken(rawToken);

  const { data, error } = await acct
    .from('portal_tokens')
    .insert({
      token_hash: tokenHash,
      customer_id: customerId,
      scope,
      invoice_id: scope === 'invoice' ? invoiceId : null,
      expires_at: expiresAt ?? null,
      created_by: createdBy ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { error: error?.message || 'Could not create portal token.' };
  }
  return { rawToken, tokenId: data.id };
}

/** Build the public portal URL for an opaque token from APP_PUBLIC_URL (origin only). */
export function portalUrlFor(rawToken) {
  const base = sanitizeText(process.env.APP_PUBLIC_URL) || 'https://roughcutmfg.com/app';
  // APP_PUBLIC_URL may be the employee-app URL (".../app"); the portal lives at the site
  // ORIGIN under /portal/, so strip any path and use the origin.
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    origin = 'https://roughcutmfg.com';
  }
  return `${origin}/portal/${rawToken}`;
}

/** Read public.organization_settings.branding for the active org (best-effort; never throws). */
export async function fetchInvoiceBranding(pub) {
  const empty = {
    companyName: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    logoDataUrl: '',
  };
  try {
    const { data } = await pub
      .from('organization_settings')
      .select('branding')
      .eq('org_key', 'default')
      .maybeSingle();
    const b = data?.branding;
    if (!b || typeof b !== 'object') return empty;
    const s = (v) => (typeof v === 'string' ? v : '');
    return {
      companyName: s(b.companyName),
      companyAddress: s(b.companyAddress),
      companyPhone: s(b.companyPhone),
      companyEmail: s(b.companyEmail),
      logoDataUrl: s(b.logoDataUrl),
    };
  } catch {
    return empty;
  }
}

/** Substitute the supported {{tokens}} in a dunning template string. */
function applyTemplate(template, vars) {
  return String(template ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

/**
 * Render the {subject, html, text} for one invoice email. `kind` decides the default copy:
 *   • 'manual_send' uses a neutral "here is your invoice" body.
 *   • 'reminder' uses the dunning subjectTemplate/bodyTemplate (with {{tokens}} substituted).
 * A portalUrl is appended as a "View invoice online" link/line in both cases.
 */
export function renderInvoiceEmail({ kind, invoice, customerName, branding, portalUrl, templates }) {
  const vars = {
    invoiceNumber: invoice.invoice_number || 'Draft',
    customerName: customerName || 'there',
    balanceDue: formatMoney(invoice.balance_due),
    total: formatMoney(invoice.total),
    dueDate: invoice.due_date || '',
  };

  const company = sanitizeText(branding?.companyName) || 'Rough Cut Manufacturing';

  let subject;
  let bodyText;
  if (kind === 'reminder' && templates?.subjectTemplate) {
    subject = applyTemplate(templates.subjectTemplate, vars);
    bodyText = applyTemplate(templates.bodyTemplate || '', vars);
  } else if (kind === 'reminder') {
    subject = `Reminder: invoice ${vars.invoiceNumber} — balance due ${vars.balanceDue}`;
    bodyText = `Hi ${vars.customerName},\n\nThis is a reminder that invoice ${vars.invoiceNumber} has a balance due of ${vars.balanceDue}.`;
  } else {
    subject = `Invoice ${vars.invoiceNumber} from ${company}`;
    bodyText = `Hi ${vars.customerName},\n\nPlease find invoice ${vars.invoiceNumber} (balance due ${vars.balanceDue}) below.`;
  }

  const textParts = [
    bodyText,
    '',
    portalUrl ? `View and download your invoice: ${portalUrl}` : '',
    '',
    `- ${company}`,
  ].filter((p) => p !== null && p !== undefined);

  const htmlBody = escapeHtml(bodyText).replace(/\n/g, '<br/>');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.5;">
      <p>${htmlBody}</p>
      ${
        portalUrl
          ? `<p style="margin:18px 0;">
               <a href="${escapeHtml(portalUrl)}"
                  style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:700;">
                 View invoice online
               </a>
             </p>
             <p style="font-size:12px;color:#64748b;">Or copy this link: ${escapeHtml(portalUrl)}</p>`
          : ''
      }
      <p style="margin-top:18px;">- ${escapeHtml(company)}</p>
    </div>`;

  return { subject, html, text: textParts.join('\n') };
}
