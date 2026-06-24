/**
 * Shared, PORTAL-SAFE "paper" renderer for an invoice or estimate.
 *
 * Mirrors the visual layout of invoices/invoiceDocument.ts (invoiceToHtml) but as a React node so
 * the parent can capture the on-screen root for PDF export (forwardRef → root <div>) and so the same
 * markup serves both read-only preview and the (Phase F) inline editor.
 *
 * PORTAL-SAFE: imports ONLY from 'react' and './salesDocumentTypes'. No accounting client, no hooks,
 * no @supabase, no domain ../types — the public customer portal reuses this component.
 *
 * Always renders a WHITE paper surface (slate-900 on white, fixed paper width) regardless of the
 * app's dark theme, so it looks right both on screen and when rasterized to PDF.
 */

import React from 'react';
import type {
  SalesDocLine,
  SalesDocSection,
  SalesDocumentData,
  TemplateConfig,
} from './salesDocumentTypes';
import { formatDocumentMoney, resolveSectionOrder } from './salesDocumentTypes';

interface Props {
  data: SalesDocumentData;
  template: TemplateConfig;
  /** 'read' renders the finished document; 'edit' renders the same skeleton (Phase F wires inputs). */
  mode?: 'read' | 'edit';
}

/** Company contact lines, in order, dropping the blanks. */
function companyLines(template: TemplateConfig): string[] {
  return [
    template.companyName,
    template.companyAddress,
    template.companyPhone,
    template.companyEmail,
  ].filter((v) => v != null && v.trim().length > 0);
}

/** Header: logo + company block on the left, title/number/meta on the right, accent rule below. */
function HeaderSection({ data, template }: { data: SalesDocumentData; template: TemplateConfig }) {
  const title = data.kind === 'invoice' ? 'INVOICE' : 'ESTIMATE';
  const secondaryLabel = data.kind === 'invoice' ? 'Due' : 'Expires';
  const lines = companyLines(template);

  const metaRows: [string, string][] = [];
  if (data.date) metaRows.push(['Date', data.date]);
  if (data.secondaryDate) metaRows.push([secondaryLabel, data.secondaryDate]);
  if (data.terms) metaRows.push(['Terms', data.terms]);

  return (
    <header>
      <div className="flex items-start justify-between gap-4">
        <div>
          {template.showLogo && template.logoDataUrl ? (
            <img
              src={template.logoDataUrl}
              alt=""
              style={{ maxHeight: 64, maxWidth: 220, objectFit: 'contain' }}
            />
          ) : null}
          {lines.length > 0 && (
            <div className="mt-1.5 text-xs text-subtle">
              {lines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
        <div className="text-right">
          <h1
            className="text-[22px] font-bold leading-tight"
            style={{ color: template.accentColor }}
          >
            {title}
          </h1>
          <div className="mt-0.5 text-sm text-subtle">{data.number ?? 'Draft'}</div>
          {data.statusLabel && (
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-subtle">
              {data.statusLabel}
            </div>
          )}
          {metaRows.length > 0 && (
            <div className="mt-1.5 text-xs text-subtle">
              {metaRows.map(([label, value]) => (
                <div key={label}>
                  <span className="text-subtle">{label}:</span> {value}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 border-t-2" style={{ borderColor: template.accentColor }} />
    </header>
  );
}

/** Bill-to block. */
function BillToSection({ data }: { data: SalesDocumentData }) {
  return (
    <div className="mt-[18px] text-xs">
      <div className="text-subtle">Bill to</div>
      <div className="font-bold">{data.customerName || '—'}</div>
    </div>
  );
}

/** One body row of the line-items table. */
function LineRow({ line, columns }: { line: SalesDocLine; columns: TemplateConfig['columns'] }) {
  const cell = 'px-2 py-1.5 border-t border-slate-200 align-top';
  const num = `${cell} text-right tabular-nums`;
  return (
    <tr>
      <td className={cell}>{line.description ?? '—'}</td>
      {columns.qty && <td className={num}>{line.quantity}</td>}
      {columns.unitPrice && <td className={num}>{formatDocumentMoney(line.unitPrice)}</td>}
      {columns.taxable && <td className={`${cell} text-center`}>{line.taxable ? 'Yes' : 'No'}</td>}
      <td className={num}>{formatDocumentMoney(line.lineTotal)}</td>
    </tr>
  );
}

/** Line-items table — optional Qty/Unit price/Taxable columns gated by the template. */
function LineItemsSection({
  data,
  template,
}: {
  data: SalesDocumentData;
  template: TemplateConfig;
}) {
  const { columns } = template;
  // Description + (optional) Qty/Unit price/Taxable + Amount.
  const colCount =
    2 + (columns.qty ? 1 : 0) + (columns.unitPrice ? 1 : 0) + (columns.taxable ? 1 : 0);
  const th = 'px-2 py-1.5 font-medium';
  const thNum = `${th} text-right`;

  return (
    <table className="mt-3.5 w-full border-collapse text-xs text-slate-900">
      <thead>
        <tr className="border-b border-slate-400 text-left text-subtle">
          <th className={th}>Description</th>
          {columns.qty && <th className={thNum}>Qty</th>}
          {columns.unitPrice && <th className={thNum}>Unit price</th>}
          {columns.taxable && <th className={`${th} text-center`}>Taxable</th>}
          <th className={thNum}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {data.lines.length === 0 ? (
          <tr>
            <td className="border-t border-slate-200 px-2 py-1.5 text-muted" colSpan={colCount}>
              No line items.
            </td>
          </tr>
        ) : (
          data.lines.map((line) => <LineRow key={line.key} line={line} columns={columns} />)
        )}
      </tbody>
    </table>
  );
}

/** One row of the right-aligned totals block. */
function TotalRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  const base = 'px-2 py-0.5';
  const labelCls = bold ? `${base} font-bold text-slate-900` : `${base} text-subtle`;
  const valueCls = bold
    ? `${base} text-right tabular-nums font-bold text-slate-900`
    : `${base} text-right tabular-nums`;
  return (
    <tr>
      <td className={labelCls}>{label}</td>
      <td className={valueCls}>{value}</td>
    </tr>
  );
}

/** Totals: Subtotal, Discount (if >0), Tax, Total; invoices also show Paid (if >0) and Balance due. */
function TotalsSection({ data }: { data: SalesDocumentData }) {
  const isInvoice = data.kind === 'invoice';
  const amountPaid = data.amountPaid ?? 0;
  return (
    <div className="mt-3 flex justify-end">
      <table className="min-w-[240px] border-collapse text-xs">
        <tbody>
          <TotalRow label="Subtotal" value={formatDocumentMoney(data.subtotal)} />
          {data.discountTotal > 0 && (
            <TotalRow label="Discount" value={`−${formatDocumentMoney(data.discountTotal)}`} />
          )}
          <TotalRow label="Tax" value={formatDocumentMoney(data.taxTotal)} />
          <TotalRow label="Total" value={formatDocumentMoney(data.total)} bold />
          {isInvoice && amountPaid > 0 && (
            <TotalRow label="Paid" value={`−${formatDocumentMoney(amountPaid)}`} />
          )}
          {isInvoice && (
            <TotalRow label="Balance due" value={formatDocumentMoney(data.balanceDue ?? 0)} bold />
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Free-text memo block (gated by template.showMemo + a non-empty memo). */
function MemoSection({ data }: { data: SalesDocumentData }) {
  return <p className="mt-[18px] whitespace-pre-line text-xs text-subtle">{data.memo}</p>;
}

/** Internal/notes block (gated by template.showNotes + non-empty notes). */
function NotesSection({ data }: { data: SalesDocumentData }) {
  return (
    <div className="mt-3 text-xs">
      <div className="text-subtle">Notes</div>
      <p className="whitespace-pre-line text-subtle">{data.notes}</p>
    </div>
  );
}

/** Footer text with an accent top rule. */
function FooterSection({ template }: { template: TemplateConfig }) {
  return (
    <footer className="mt-6">
      <div className="border-t" style={{ borderColor: template.accentColor }} />
      <p className="mt-2 whitespace-pre-line text-center text-[11px] text-subtle">
        {template.footerText}
      </p>
    </footer>
  );
}

/** Render one section by key, honoring the template's show* toggles and empty-content guards. */
function renderSection(
  section: SalesDocSection,
  data: SalesDocumentData,
  template: TemplateConfig
): React.ReactNode {
  switch (section) {
    case 'header':
      return <HeaderSection key="header" data={data} template={template} />;
    case 'billTo':
      return <BillToSection key="billTo" data={data} />;
    case 'lineItems':
      return <LineItemsSection key="lineItems" data={data} template={template} />;
    case 'totals':
      return <TotalsSection key="totals" data={data} />;
    case 'memo':
      return template.showMemo && data.memo ? <MemoSection key="memo" data={data} /> : null;
    case 'notes':
      return template.showNotes && data.notes ? <NotesSection key="notes" data={data} /> : null;
    case 'footer':
      return template.footerText ? <FooterSection key="footer" template={template} /> : null;
    default:
      return null;
  }
}

/**
 * The "paper" document. The forwarded ref lands on the white root <div> so a parent can hand it to
 * html2pdf.js / react-to-print. `mode` is accepted now (same DOM either way); Phase F adds editing.
 */
const SalesDocument = React.forwardRef<HTMLDivElement, Props>(function SalesDocument(
  { data, template, mode = 'read' },
  ref
) {
  const order = resolveSectionOrder(data.layout, template);
  return (
    <div
      ref={ref}
      data-mode={mode}
      className="mx-auto w-full max-w-[7.5in] bg-white p-8 font-sans text-slate-900"
    >
      {order.map((section) => renderSection(section, data, template))}
    </div>
  );
});

export default SalesDocument;
