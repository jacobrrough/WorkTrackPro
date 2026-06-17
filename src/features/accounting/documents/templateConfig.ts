/**
 * Resolve a fully-defaulted TemplateConfig from organization branding.
 *
 * PORTAL-SAFE: imports only ./salesDocumentTypes. Takes a loosely-typed `BrandingLike` (the subset
 * of organization_settings.branding we read) so it stays decoupled from the adminSettings service
 * and usable anywhere. The `documentTemplate` sub-object is optional and may be absent (older orgs);
 * every key is defaulted here so <SalesDocument /> always receives a complete config — no migration
 * is needed for the template feature.
 */
import {
  DEFAULT_SECTION_ORDER,
  type SalesDocSection,
  type TemplateConfig,
} from './salesDocumentTypes';

/** The persisted documentTemplate sub-object (all keys optional; resilient defaults applied below).
 *  sectionOrder is stored loosely as string[] (it lives in jsonb and the core adminSettings layer
 *  cannot import the accounting SalesDocSection union); resolveTemplateConfig validates it down to
 *  real SalesDocSection values. */
export interface DocumentTemplateSettings {
  accentColor?: string;
  footerText?: string;
  showLogo?: boolean;
  columns?: { qty?: boolean; unitPrice?: boolean; taxable?: boolean };
  sectionOrder?: string[];
  showMemo?: boolean;
  showNotes?: boolean;
}

/** Subset of organization_settings.branding this resolver reads. */
export interface BrandingLike {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  logoDataUrl?: string;
  documentTemplate?: DocumentTemplateSettings | null;
}

/** Default header accent (matches the app's primary purple). */
export const DEFAULT_ACCENT_COLOR = '#7c3aed';

/** Fully-defaulted documentTemplate used when branding carries none. */
export const DEFAULT_DOCUMENT_TEMPLATE: Required<Omit<DocumentTemplateSettings, 'columns'>> & {
  columns: { qty: boolean; unitPrice: boolean; taxable: boolean };
} = {
  accentColor: DEFAULT_ACCENT_COLOR,
  footerText: '',
  showLogo: true,
  columns: { qty: true, unitPrice: true, taxable: true },
  sectionOrder: DEFAULT_SECTION_ORDER,
  showMemo: true,
  showNotes: true,
};

/** Build a complete TemplateConfig (component + portal always get a total config). */
export function resolveTemplateConfig(branding: BrandingLike | null | undefined): TemplateConfig {
  const b = branding ?? {};
  const dt = b.documentTemplate ?? {};
  const cols = dt.columns ?? {};
  // Validate the loosely-stored section order down to real sections; drop anything unknown.
  const requestedOrder = Array.isArray(dt.sectionOrder)
    ? dt.sectionOrder.filter((s): s is SalesDocSection =>
        (DEFAULT_SECTION_ORDER as string[]).includes(s)
      )
    : [];
  return {
    accentColor:
      typeof dt.accentColor === 'string' && dt.accentColor.trim()
        ? dt.accentColor
        : DEFAULT_ACCENT_COLOR,
    footerText: typeof dt.footerText === 'string' ? dt.footerText : '',
    showLogo: dt.showLogo !== false,
    logoDataUrl: typeof b.logoDataUrl === 'string' ? b.logoDataUrl : '',
    companyName: b.companyName ?? '',
    companyAddress: b.companyAddress ?? '',
    companyPhone: b.companyPhone ?? '',
    companyEmail: b.companyEmail ?? '',
    columns: {
      qty: cols.qty !== false,
      unitPrice: cols.unitPrice !== false,
      taxable: cols.taxable !== false,
    },
    sectionOrder: requestedOrder.length > 0 ? requestedOrder : DEFAULT_SECTION_ORDER,
    showMemo: dt.showMemo !== false,
    showNotes: dt.showNotes !== false,
  };
}
