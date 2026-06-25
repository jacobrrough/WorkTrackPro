/**
 * Plain, transport-agnostic shapes for the shared <SalesDocument /> renderer.
 *
 * PORTAL-SAFE: this module imports NOTHING (no `@/services/api/accounting/*`, no accounting hooks,
 * no `@supabase`, not even the domain `../types`). The public customer portal reuses
 * <SalesDocument /> for its invoice download, so the component and these types must stay free of the
 * accounting client. Domain → SalesDocumentData mapping lives in `salesDocumentMappers.ts` (which
 * MAY import `../types`); the portal builds SalesDocumentData from its own payload.
 */

export type SalesDocumentKind = 'invoice' | 'estimate';

/** One printable/editable line. Amounts are in dollars. */
export interface SalesDocLine {
  /** Stable React/dnd key — the DB line id for a persisted line, or a temp id for a new one. */
  key: string;
  /** The DB line id when persisted (null for a not-yet-saved line). */
  id: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  taxable: boolean;
  taxCodeId: string | null;
  /** Link to the real public.parts row this line bills (null = free-text/service line). Editor-only;
   *  the read-only document never shows a picker, only the resulting description/amounts. */
  partId: string | null;
}

/** Ordered document sections that form the body. */
export type SalesDocSection =
  | 'header'
  | 'billTo'
  | 'lineItems'
  | 'totals'
  | 'memo'
  | 'notes'
  | 'footer';

export const DEFAULT_SECTION_ORDER: SalesDocSection[] = [
  'header',
  'billTo',
  'lineItems',
  'totals',
  'memo',
  'notes',
  'footer',
];

/** Per-document layout overrides, persisted in invoices.layout / estimates.layout (jsonb).
 *  null/missing → fall back to the template's (org-default) section order. */
export interface PerDocLayout {
  sectionOrder?: SalesDocSection[];
}

/** Which optional line columns the template shows. */
export interface TemplateColumns {
  qty: boolean;
  unitPrice: boolean;
  taxable: boolean;
}

/**
 * Fully-resolved branding/template config (never partial — resolveTemplateConfig fills every key
 * from organization_settings.branding.documentTemplate + the company branding fields).
 */
export interface TemplateConfig {
  /** Header accent / rule color (hex, e.g. "#7c3aed"). */
  accentColor: string;
  footerText: string;
  showLogo: boolean;
  /** Base64 data URL (or absolute URL) of the logo, or '' when none. */
  logoDataUrl: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  columns: TemplateColumns;
  /** Org-default section order; a per-document layout.sectionOrder overrides this. */
  sectionOrder: SalesDocSection[];
  showMemo: boolean;
  showNotes: boolean;
}

/** The minimal shape <SalesDocument /> renders. Built by the mappers (accounting side) or by the
 *  portal from its own payload. Money fields are dollars. */
export interface SalesDocumentData {
  kind: SalesDocumentKind;
  /** Document number (invoiceNumber / estimateNumber); null while a draft has no number yet. */
  number: string | null;
  /** Primary date: invoiceDate / estimateDate (ISO yyyy-mm-dd). */
  date: string;
  /** Secondary date: due date (invoice) or expiry date (estimate); null when none. */
  secondaryDate: string | null;
  terms: string | null;
  /** Display label for the status (e.g. "Partially paid") — passed in so the component needs no
   *  label-map import. */
  statusLabel: string;
  /** Raw status string (e.g. "partially_paid") for tone selection. */
  status: string;
  customerName: string;
  /** Optional header fields (estimate P.O. Number / Sales Rep). Undefined/null → not rendered. */
  poNumber?: string | null;
  salesRep?: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  /** Invoice-only payment fields; null for an estimate (no payments block is shown). */
  amountPaid: number | null;
  balanceDue: number | null;
  memo: string | null;
  notes: string | null;
  lines: SalesDocLine[];
  /** Per-document section-order override (null → template/org default). */
  layout: PerDocLayout | null;
}

/** Resolve the effective section order: a per-document override wins over the template default. */
export function resolveSectionOrder(
  layout: PerDocLayout | null | undefined,
  template: Pick<TemplateConfig, 'sectionOrder'>
): SalesDocSection[] {
  const order = layout?.sectionOrder;
  if (Array.isArray(order) && order.length > 0) return order;
  if (Array.isArray(template.sectionOrder) && template.sectionOrder.length > 0) {
    return template.sectionOrder;
  }
  return DEFAULT_SECTION_ORDER;
}

/** Local currency formatter — no accounting-module import, so the component stays portal-safe. */
export function formatDocumentMoney(amount: number, currency = 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(safe);
}

/** Download-filename slug (no extension), e.g. "invoice-1042" / "estimate-77". */
export function salesDocumentFilenameBase(doc: Pick<SalesDocumentData, 'kind' | 'number'>): string {
  const raw = doc.number ? `${doc.kind}-${doc.number}` : doc.kind;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}
