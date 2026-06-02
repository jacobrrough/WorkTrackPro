/**
 * PDF + CSV export for the A3 financial reports.
 *
 * Every report screen normalizes its data into a single `ReportDocument` shape and
 * hands it to `exportReportPdf` / `exportReportCsv`. That keeps one export path for
 * all five reports and guarantees the G9 legal disclaimer is embedded in BOTH the
 * PDF and the CSV (invariant: tax/report/export surfaces must carry the notice).
 *
 * - PDF: builds a clean, white-background HTML document off-screen and runs it
 *   through html2pdf.js (lazy-imported, exactly like the deliveries packing slip),
 *   so no accounting code is pulled into the core bundle and the dependency is only
 *   loaded when a user actually exports.
 * - CSV: writes the disclaimer as a leading comment row, then a metadata block, then
 *   the section tables, escaping every field. Amounts are written as plain numbers
 *   (no currency symbol) so they import cleanly into a spreadsheet.
 *
 * Amounts arrive already in dollars (reportMath did the integer-cents work); this
 * module only formats and serializes.
 */
import { formatAccounting } from './reportFormat';

/** The exact legal notice required on every report + export (invariant G9). */
export const REPORT_DISCLAIMER =
  'Not certified tax software. Always verify with a CPA/EA. ' +
  'You are responsible for tax accuracy and timely filing.';

/**
 * The C1 sales-tax variant of the notice: the base disclaimer plus the
 * "Representative rates only." caveat required on every sales-tax / tax-calendar
 * surface and export (the seeded CDTFA rates/cadences are representative, not
 * authoritative). A C1 ReportDocument sets `disclaimer` to this so the PDF/CSV
 * carry the exact required wording.
 */
export const SALES_TAX_DISCLAIMER = `${REPORT_DISCLAIMER} Representative rates only.`;

/** One data row within a report section. `amount` is dollars; `isTotal` bolds it. */
export interface ReportRow {
  /** Leading label cell(s). Most reports use one; aging uses several. */
  cells: string[];
  /** Trailing money amount in dollars (omit for a header-only/spacer row). */
  amount?: number;
  /** Render emphasized (subtotals / grand totals). */
  isTotal?: boolean;
}

/** A titled block of rows with its own column headers. */
export interface ReportSectionDoc {
  title?: string;
  /** Column headers for the leading (label) cells; the amount column is implicit. */
  columns: string[];
  rows: ReportRow[];
}

/** A fully-normalized report ready to export to PDF or CSV. */
export interface ReportDocument {
  /** Report name, e.g. "Profit & Loss". */
  title: string;
  /** Period / as-of description, e.g. "2026-01-01 to 2026-03-31". */
  subtitle: string;
  sections: ReportSectionDoc[];
  /** Optional one-line status, e.g. "In balance" / "Out of balance by $1.00". */
  status?: string;
  /**
   * Optional override for the embedded G9 legal notice. Defaults to REPORT_DISCLAIMER;
   * C1 sales-tax documents set SALES_TAX_DISCLAIMER so the export carries the
   * "Representative rates only." caveat.
   */
  disclaimer?: string;
  /** Slug used for the download filename (no extension). */
  filenameBase: string;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Serialize a ReportDocument to CSV text (disclaimer first, then the tables). */
export function reportToCsv(doc: ReportDocument): string {
  const lines: string[] = [];
  // G9 disclaimer rides at the very top of the file.
  lines.push(csvCell(`DISCLAIMER: ${doc.disclaimer ?? REPORT_DISCLAIMER}`));
  lines.push('');
  lines.push([csvCell(doc.title)].join(','));
  lines.push([csvCell(doc.subtitle)].join(','));
  lines.push([csvCell(`Generated ${new Date().toISOString()}`)].join(','));
  if (doc.status) lines.push([csvCell(doc.status)].join(','));
  lines.push('');

  for (const section of doc.sections) {
    if (section.title) {
      lines.push(csvCell(section.title));
    }
    lines.push([...section.columns.map(csvCell), csvCell('Amount')].join(','));
    for (const row of section.rows) {
      const cells = [...row.cells];
      // Pad the label cells out to the column count so the amount lines up.
      while (cells.length < section.columns.length) cells.push('');
      const amount = row.amount == null ? '' : row.amount.toFixed(2);
      lines.push([...cells.map(csvCell), csvCell(amount)].join(','));
    }
    lines.push('');
  }

  return lines.join('\r\n');
}

/** Serialize to CSV and trigger a browser download. */
export function exportReportCsv(doc: ReportDocument): void {
  const csv = reportToCsv(doc);
  // Prepend a UTF-8 BOM so Excel reads accented characters correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.filenameBase}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the printable (white-background) HTML for a report. */
export function reportToHtml(doc: ReportDocument): string {
  const sectionHtml = doc.sections
    .map((section) => {
      const headCols = section.columns
        .map((c) => `<th style="text-align:left;padding:6px 8px;">${escapeHtml(c)}</th>`)
        .join('');
      const rowsHtml = section.rows
        .map((row) => {
          const weight = row.isTotal ? 'font-weight:700;' : '';
          const border = row.isTotal ? 'border-top:1px solid #cbd5e1;' : '';
          const cells = [...row.cells];
          while (cells.length < section.columns.length) cells.push('');
          const labelCells = cells
            .map(
              (c) =>
                `<td style="padding:6px 8px;${weight}${border}">${escapeHtml(c)}</td>`
            )
            .join('');
          const amountCell =
            row.amount == null
              ? `<td style="${border}"></td>`
              : `<td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;${weight}${border}">${escapeHtml(
                  formatAccounting(row.amount)
                )}</td>`;
          return `<tr>${labelCells}${amountCell}</tr>`;
        })
        .join('');
      return `
        ${section.title ? `<h2 style="font-size:14px;margin:18px 0 6px;color:#0f172a;">${escapeHtml(section.title)}</h2>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:12px;color:#0f172a;">
          <thead><tr style="border-bottom:1px solid #94a3b8;color:#475569;">${headCols}<th style="text-align:right;padding:6px 8px;">Amount</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
    })
    .join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:8px;">
      <h1 style="font-size:20px;margin:0 0 2px;">${escapeHtml(doc.title)}</h1>
      <p style="margin:0 0 2px;color:#475569;font-size:12px;">${escapeHtml(doc.subtitle)}</p>
      ${doc.status ? `<p style="margin:0 0 8px;color:#475569;font-size:12px;">${escapeHtml(doc.status)}</p>` : ''}
      ${sectionHtml}
      <p style="margin-top:24px;padding:8px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:11px;border-radius:4px;">
        <strong>Disclaimer:</strong> ${escapeHtml(doc.disclaimer ?? REPORT_DISCLAIMER)}
      </p>
    </div>`;
}

/**
 * Render a report to PDF and download it. Builds the HTML off-screen, runs it
 * through html2pdf.js, then cleans up. Throws if html2pdf is unavailable so the
 * caller can surface the error (the screens catch and show a message).
 */
export async function exportReportPdf(doc: ReportDocument): Promise<void> {
  const host = document.createElement('div');
  // Keep it laid out (so html2canvas can measure) but off-screen.
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '7.5in';
  host.style.background = '#ffffff';
  host.innerHTML = reportToHtml(doc);
  document.body.appendChild(host);

  try {
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf =
      (html2pdfModule as { default?: unknown }).default ?? (html2pdfModule as unknown);
    const opt = {
      margin: 0.5,
      filename: `${doc.filenameBase}.pdf`,
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
