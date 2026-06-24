import { useEffect, useMemo, useState } from 'react';
import {
  exportInvoicePdf,
  formatInvoiceMoney,
  type InvoiceDocumentData,
} from '@/features/accounting/invoices/invoiceDocument';

/**
 * #7 — PUBLIC customer portal.
 *
 * Rendered by App.tsx for any /portal/<token> path. It reads the opaque token from the URL,
 * POSTs it to the /api/portal-invoice serverless function, and renders the SAFE payload that
 * function returns (invoice header + lines + customer name + balance + statement).
 *
 * HARD ISOLATION RULE: this file MUST NOT import anything from src/services/api/accounting/*
 * (or @/services/api/accounting). It must never pull the Supabase/accounting client into the
 * public bundle. It talks ONLY to /api/portal-invoice and reuses the dependency-free
 * invoiceDocument builder for the client-side PDF download.
 */

// ── Payload shape (mirrors accounting.portal_invoice_payload's JSON projection) ──
interface PortalLine {
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface PortalInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  terms: string | null;
  status: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  memo: string | null;
  lines: PortalLine[];
}

interface PortalStatementRow {
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  balanceDue: number;
  status: string;
}

interface PortalPayload {
  scope: 'customer' | 'invoice';
  customer: { displayName: string | null; companyName: string | null } | null;
  invoices: PortalInvoice[];
  statement: PortalStatementRow[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};

/** Pull the opaque token out of /portal/<token> (defensive against trailing slashes). */
function tokenFromPath(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // ['portal', '<token>'] — the token is the segment after 'portal'.
  const idx = parts.indexOf('portal');
  if (idx === -1) return '';
  return parts[idx + 1] ?? '';
}

function toDocumentData(inv: PortalInvoice, customerName: string): InvoiceDocumentData {
  return {
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    terms: inv.terms,
    status: inv.status,
    customerName,
    subtotal: inv.subtotal,
    discountTotal: inv.discountTotal,
    taxTotal: inv.taxTotal,
    total: inv.total,
    amountPaid: inv.amountPaid,
    balanceDue: inv.balanceDue,
    memo: inv.memo,
    lines: inv.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
  };
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    sent: 'bg-sky-100 text-sky-700',
    partially_paid: 'bg-amber-100 text-amber-700',
    paid: 'bg-green-100 text-green-700',
    void: 'bg-red-100 text-red-700',
    draft: 'bg-slate-100 text-subtle',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${styles[status] ?? 'bg-slate-100 text-subtle'}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function InvoiceCard({ invoice, customerName }: { invoice: PortalInvoice; customerName: string }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const onDownload = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      await exportInvoicePdf(toDocumentData(invoice, customerName));
    } catch {
      setDownloadError('Could not generate the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Invoice {invoice.invoiceNumber ?? '—'}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-subtle">
            <StatusBadge status={invoice.status} />
            <span>Date {invoice.invoiceDate}</span>
            {invoice.dueDate && <span>Due {invoice.dueDate}</span>}
            {invoice.terms && <span>Terms {invoice.terms}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {downloadError && <p className="mt-2 text-sm text-red-600">{downloadError}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-subtle">
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="py-2 pl-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-slate-800">{l.description || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-subtle">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums text-subtle">
                  {formatInvoiceMoney(l.unitPrice)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums text-slate-800">
                  {formatInvoiceMoney(l.lineTotal)}
                </td>
              </tr>
            ))}
            {invoice.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-muted">
                  No line items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between text-subtle">
            <dt>Subtotal</dt>
            <dd className="tabular-nums text-slate-700">{formatInvoiceMoney(invoice.subtotal)}</dd>
          </div>
          {invoice.discountTotal > 0 && (
            <div className="flex justify-between text-subtle">
              <dt>Discount</dt>
              <dd className="tabular-nums text-slate-700">
                −{formatInvoiceMoney(invoice.discountTotal)}
              </dd>
            </div>
          )}
          <div className="flex justify-between text-subtle">
            <dt>Tax</dt>
            <dd className="tabular-nums text-slate-700">{formatInvoiceMoney(invoice.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold text-slate-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatInvoiceMoney(invoice.total)}</dd>
          </div>
          {invoice.amountPaid > 0 && (
            <div className="flex justify-between text-green-600">
              <dt>Paid</dt>
              <dd className="tabular-nums">−{formatInvoiceMoney(invoice.amountPaid)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-slate-900">
            <dt>Balance due</dt>
            <dd className="tabular-nums">{formatInvoiceMoney(invoice.balanceDue)}</dd>
          </div>
        </dl>
      </div>

      {invoice.memo && <p className="mt-4 text-sm text-subtle">{invoice.memo}</p>}
    </section>
  );
}

function StatementCard({ rows }: { rows: PortalStatementRow[] }) {
  if (rows.length === 0) return null;
  const totalDue = rows.reduce((sum, r) => sum + (Number(r.balanceDue) || 0), 0);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Account statement</h2>
      <p className="mt-1 text-sm text-subtle">Open invoices with a balance due.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-subtle">
              <th className="py-2 pr-3 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="py-2 pl-3 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-slate-800">{r.invoiceNumber ?? '—'}</td>
                <td className="px-3 py-2 text-subtle">{r.invoiceDate}</td>
                <td className="px-3 py-2 text-subtle">{r.dueDate ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatInvoiceMoney(r.total)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums text-slate-900">
                  {formatInvoiceMoney(r.balanceDue)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 font-bold text-slate-900">
              <td className="py-2 pr-3" colSpan={4}>
                Total balance due
              </td>
              <td className="py-2 pl-3 text-right tabular-nums">{formatInvoiceMoney(totalDue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

export default function CustomerPortal() {
  const token = useMemo(() => tokenFromPath(), []);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [payload, setPayload] = useState<PortalPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) {
        setState('error');
        setErrorMessage('This link is missing its access token.');
        return;
      }
      try {
        const response = await fetch('/api/portal-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = await response.json().catch(() => ({}) as Record<string, unknown>);
        if (cancelled) return;
        if (!response.ok || body.ok === false || !body.payload) {
          setState('error');
          setErrorMessage(
            String(
              body.error ??
                (response.status === 404
                  ? 'This link is invalid or has expired.'
                  : 'Unable to load this invoice.')
            )
          );
          return;
        }
        setPayload(body.payload as PortalPayload);
        setState('ok');
      } catch {
        if (cancelled) return;
        setState('error');
        setErrorMessage('Unable to reach the server. Please try again later.');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const customerName =
    payload?.customer?.companyName || payload?.customer?.displayName || 'Customer';

  return (
    <div className="min-h-screen bg-slate-100 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold text-slate-900">
            {state === 'ok' ? customerName : 'Customer Portal'}
          </h1>
          <span className="text-xs text-muted">Secure invoice link</span>
        </header>

        {state === 'loading' && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-subtle shadow-sm">
            Loading your invoice…
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
            <p className="font-semibold">We couldn’t open this link</p>
            <p className="mt-1 text-sm">{errorMessage}</p>
            <p className="mt-3 text-sm text-red-600">
              If you believe this is a mistake, please contact us and we’ll send a new link.
            </p>
          </div>
        )}

        {state === 'ok' && payload && (
          <>
            {payload.invoices.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} customerName={customerName} />
            ))}
            {payload.invoices.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-subtle shadow-sm">
                There are no invoices to display for this link.
              </div>
            )}
            {payload.scope === 'customer' && <StatementCard rows={payload.statement} />}
          </>
        )}

        <footer className="pt-2 text-center text-xs text-muted">
          This is a secure, read-only view of your invoice.
        </footer>
      </div>
    </div>
  );
}
