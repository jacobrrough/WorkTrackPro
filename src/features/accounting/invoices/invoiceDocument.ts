/**
 * HTML → PDF builder for a SINGLE invoice (#6/#7).
 *
 * Cloned from reports/reportExport.ts (same off-screen-HTML → html2pdf.js lazy-import
 * pattern) but specialized to an invoice document with optional company branding.
 *
 * It is used in THREE places, so it deliberately depends on NOTHING from the accounting
 * services/Supabase layer — only on a plain, structural data shape (`InvoiceDocumentData`):
 *   1. the invoice detail-view "Download" button (passes the mapped Invoice + branding),
 *   2. the emailed invoice attachment / link target,
 *   3. the PUBLIC customer portal (src/public/portal/CustomerPortal.tsx), which renders
 *      a downloaded payload and must NOT pull the accounting client into the public bundle.
 *
 * Because the portal imports this file, keep it free of any `@/services/api/accounting`
 * import and of any accounting React-Query/hook import. Money is formatted locally.
 */

/** Company branding shown in the invoice header (subset of organization_settings.branding). */
export interface InvoiceBranding {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  /** Base64 data URL (or absolute URL) of the logo, or '' when none. */
  logoDataUrl: string;
}

export const EMPTY_INVOICE_BRANDING: InvoiceBranding = {
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  logoDataUrl: '',
};

/** One printable invoice line. Amounts are in dollars. */
export interface InvoiceDocumentLine {
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** The minimal, transport-agnostic invoice shape this builder renders. */
export interface InvoiceDocumentData {
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  terms: string | null;
  status: string;
  customerName: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  memo: string | null;
  lines: InvoiceDocumentLine[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Local currency formatter (no accounting-module import, so the portal stays clean). */
export function formatInvoiceMoney(amount: number, currency = 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(safe);
}

/** Slug used for the download filename (no extension). */
export function invoiceFilenameBase(doc: InvoiceDocumentData): string {
  const raw = doc.invoiceNumber ? `invoice-${doc.invoiceNumber}` : 'invoice';
  return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/** Build the printable (white-background) HTML for one invoice. */
export function invoiceToHtml(doc: InvoiceDocumentData, branding?: InvoiceBranding): string {
  const b = branding ?? EMPTY_INVOICE_BRANDING;

  const logoHtml = b.logoDataUrl
    ? `<img src="${escapeHtml(b.logoDataUrl)}" alt="" style="max-height:64px;max-width:220px;object-fit:contain;" />`
    : '';

  const companyLines = [b.companyName, b.companyAddress, b.companyPhone, b.companyEmail]
    .filter((v) => v && v.trim().length > 0)
    .map((v) => `<div>${escapeHtml(v)}</div>`)
    .join('');

  const metaRows = [
    doc.invoiceDate ? ['Date', doc.invoiceDate] : null,
    doc.dueDate ? ['Due', doc.dueDate] : null,
    doc.terms ? ['Terms', doc.terms] : null,
  ]
    .filter((r): r is [string, string] => r != null)
    .map(
      ([label, value]) =>
        `<div><span style="color:#64748b;">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`
    )
    .join('');

  const linesHtml = doc.lines
    .map((l) => {
      return `<tr>
        <td style="padding:6px 8px;border-top:1px solid #e2e8f0;">${escapeHtml(l.description ?? '—')}</td>
        <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;border-top:1px solid #e2e8f0;">${escapeHtml(String(l.quantity))}</td>
        <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;border-top:1px solid #e2e8f0;">${escapeHtml(formatInvoiceMoney(l.unitPrice))}</td>
        <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;border-top:1px solid #e2e8f0;">${escapeHtml(formatInvoiceMoney(l.lineTotal))}</td>
      </tr>`;
    })
    .join('');

  const emptyLinesHtml =
    doc.lines.length === 0
      ? `<tr><td colspan="4" style="padding:6px 8px;border-top:1px solid #e2e8f0;color:#94a3b8;">No line items.</td></tr>`
      : '';

  const totalRow = (label: string, value: string, bold = false): string =>
    `<tr>
      <td style="padding:3px 8px;color:#475569;${bold ? 'font-weight:700;color:#0f172a;' : ''}">${escapeHtml(label)}</td>
      <td style="padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;${bold ? 'font-weight:700;color:#0f172a;' : ''}">${escapeHtml(value)}</td>
    </tr>`;

  const discountRow =
    doc.discountTotal > 0 ? totalRow('Discount', `−${formatInvoiceMoney(doc.discountTotal)}`) : '';
  const paidRow =
    doc.amountPaid > 0 ? totalRow('Paid', `−${formatInvoiceMoney(doc.amountPaid)}`) : '';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
        <div>
          ${logoHtml}
          <div style="margin-top:6px;font-size:12px;color:#475569;">${companyLines}</div>
        </div>
        <div style="text-align:right;">
          <h1 style="font-size:22px;margin:0;">INVOICE</h1>
          <div style="font-size:14px;color:#475569;margin-top:2px;">${escapeHtml(doc.invoiceNumber ?? 'Draft')}</div>
          <div style="font-size:12px;color:#475569;margin-top:6px;">${metaRows}</div>
        </div>
      </div>

      <div style="margin-top:18px;font-size:12px;">
        <div style="color:#64748b;">Bill to</div>
        <div style="font-weight:700;">${escapeHtml(doc.customerName || '—')}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12px;color:#0f172a;margin-top:14px;">
        <thead>
          <tr style="border-bottom:1px solid #94a3b8;color:#475569;text-align:left;">
            <th style="padding:6px 8px;">Description</th>
            <th style="padding:6px 8px;text-align:right;">Qty</th>
            <th style="padding:6px 8px;text-align:right;">Unit price</th>
            <th style="padding:6px 8px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${linesHtml}${emptyLinesHtml}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-top:12px;">
        <table style="font-size:12px;min-width:240px;border-collapse:collapse;">
          ${totalRow('Subtotal', formatInvoiceMoney(doc.subtotal))}
          ${discountRow}
          ${totalRow('Tax', formatInvoiceMoney(doc.taxTotal))}
          ${totalRow('Total', formatInvoiceMoney(doc.total), true)}
          ${paidRow}
          ${totalRow('Balance due', formatInvoiceMoney(doc.balanceDue), true)}
        </table>
      </div>

      ${doc.memo ? `<p style="margin-top:18px;font-size:12px;color:#475569;">${escapeHtml(doc.memo)}</p>` : ''}
    </div>`;
}

/**
 * Render an invoice to PDF and download it. Builds the HTML off-screen, runs it through
 * html2pdf.js (lazy-imported so the dependency only loads on demand), then cleans up.
 * Throws if html2pdf is unavailable so the caller can surface the error.
 */
export async function exportInvoicePdf(
  doc: InvoiceDocumentData,
  branding?: InvoiceBranding
): Promise<void> {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '7.5in';
  host.style.background = '#ffffff';
  host.innerHTML = invoiceToHtml(doc, branding);
  document.body.appendChild(host);

  try {
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf =
      (html2pdfModule as { default?: unknown }).default ?? (html2pdfModule as unknown);
    const opt = {
      margin: 0.5,
      filename: `${invoiceFilenameBase(doc)}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (html2pdf as any)().set(opt).from(host).save();
  } finally {
    document.body.removeChild(host);
  }
}
