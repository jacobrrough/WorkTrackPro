/**
 * Render an ON-SCREEN node to PDF and download it.
 *
 * ROOT-CAUSE FIX for the blank PDF: the old exportInvoicePdf / exportReportPdf built their HTML into
 * an OFF-SCREEN host (`position:fixed; left:-10000px`) and ran html2canvas on it — html2canvas cannot
 * rasterize a node parked off the left edge, so every page came out blank. This helper instead
 * captures a node that is genuinely on screen (the rendered <SalesDocument /> "paper"), exactly like
 * the working PackingSlipPreview. The html2pdf options are identical to the packing slip's.
 *
 * For "download without showing", render <SalesDocument /> into an on-screen but visually-hidden
 * container (`position:absolute; opacity:0; pointer-events:none; z-index:-1`) — NEVER `left:-10000px`.
 *
 * PORTAL-SAFE: imports nothing from the accounting services/Supabase layer; html2pdf.js is
 * lazy-imported so it only loads on demand.
 */
export async function exportSalesDocumentPdf(
  node: HTMLElement,
  filenameBase: string
): Promise<void> {
  const html2pdfModule = await import('html2pdf.js');
  const html2pdf = (html2pdfModule as { default?: unknown }).default ?? (html2pdfModule as unknown);
  const opt = {
    margin: 0.5,
    filename: `${filenameBase}.pdf`,
    image: { type: 'jpeg' as const, quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (html2pdf as any)().set(opt).from(node).save();
}
