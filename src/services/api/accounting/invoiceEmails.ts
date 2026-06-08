import type { InvoiceEmail, SendInvoiceEmailInput } from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import type { Row } from './mappers';

/**
 * #6 — invoice email log + the on-demand "Email invoice" send.
 *
 * `listForInvoice` reads accounting.invoice_emails through the authed accounting client
 * (RLS gates it to accounting readers). `send` calls the serverless function
 * /api/send-invoice-email with the signed-in user's bearer token (exactly like
 * src/services/api/aiChat.ts) — the function does the privileged work (mint a portal token,
 * send via Resend, write the log row) under the service role, so no Supabase service key
 * ever reaches the browser.
 *
 * Reads throw (React Query surfaces them); `send` returns a result object whose `error`
 * carries the server message so the modal can show it inline.
 */

const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const nnum = (v: unknown): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);

/** Map an accounting.invoice_emails row to the camelCase domain shape. */
export function mapInvoiceEmailRow(row: Row): InvoiceEmail {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    kind: (row.kind as InvoiceEmail['kind']) ?? 'manual_send',
    reminderOffsetDays: nnum(row.reminder_offset_days),
    toEmail: String(row.to_email ?? ''),
    fromEmail: String(row.from_email ?? ''),
    subject: nstr(row.subject),
    status: (row.status as InvoiceEmail['status']) ?? 'queued',
    providerMessageId: nstr(row.provider_message_id),
    providerLastEvent: nstr(row.provider_last_event),
    error: nstr(row.error),
    portalTokenId: nstr(row.portal_token_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const invoiceEmailsService = {
  /** Every email logged for an invoice, newest first. */
  async listForInvoice(invoiceId: string): Promise<InvoiceEmail[]> {
    const { data, error } = await acct()
      .from('invoice_emails')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInvoiceEmailRow);
  },

  /**
   * Send an invoice email via the serverless function. Mints a portal link, emails it to the
   * customer (or `toEmail` override), and logs an invoice_emails row server-side. Returns a
   * write-style result; on failure `error` carries the server message.
   */
  async send(
    invoiceId: string,
    opts?: SendInvoiceEmailInput
  ): Promise<{ ok: boolean; toEmail?: string; portalUrl?: string; error?: string }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, error: 'Not authenticated.' };
    }

    let response: Response;
    try {
      response = await fetch('/api/send-invoice-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          invoiceId,
          toEmail: opts?.toEmail ?? undefined,
          subject: opts?.subject ?? undefined,
          scope: opts?.scope ?? 'invoice',
          expiresInDays: opts?.expiresInDays ?? undefined,
        }),
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error sending email.' };
    }

    const body = await response.json().catch(() => ({}) as Record<string, unknown>);
    if (!response.ok || body.ok === false) {
      const detail = body.detail ? ` (${body.detail})` : '';
      return {
        ok: false,
        error: (String(body.error ?? `HTTP ${response.status}`) || 'Send failed') + detail,
      };
    }
    return {
      ok: true,
      toEmail: typeof body.toEmail === 'string' ? body.toEmail : undefined,
      portalUrl: typeof body.portalUrl === 'string' ? body.portalUrl : undefined,
    };
  },
};
