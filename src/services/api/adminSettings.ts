import { supabase } from './supabaseClient';

const ORG_SETTINGS_KEY = 'default';

/**
 * Self-contained shape of the optional document-template blob persisted on the
 * branding record (stored as jsonb). The accounting document editor writes it
 * and `resolveTemplateConfig` (under src/features/accounting/documents) reads it
 * defensively, applying defaults at read time.
 *
 * NOTE: This is intentionally duplicated here rather than imported from
 * src/features/accounting/* — adminSettings.ts is core and must stay free of any
 * accounting-feature imports (even type-only). `sectionOrder` items are typed as
 * a plain string[] to avoid pulling in the accounting `SalesDocSection` type.
 */
export interface BrandingDocumentTemplate {
  accentColor?: string;
  footerText?: string;
  showLogo?: boolean;
  columns?: {
    qty?: boolean;
    unitPrice?: boolean;
    taxable?: boolean;
  };
  /** Ordered list of sales-doc section keys (typed loosely to avoid feature coupling). */
  sectionOrder?: string[];
  showMemo?: boolean;
  showNotes?: boolean;
}

export interface BrandingRecord {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  /** Base64 data URL of the uploaded logo, or '' when none. */
  logoDataUrl: string;
  /**
   * Optional document-template overrides. Left undefined when unset;
   * `resolveTemplateConfig` supplies the full set of defaults at read time.
   */
  documentTemplate?: BrandingDocumentTemplate | null;
}

export const EMPTY_BRANDING: BrandingRecord = {
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  logoDataUrl: '',
};

export interface OrganizationSettingsRecord {
  laborRate: number;
  materialUpcharge: number;
  cncRate: number;
  printer3DRate: number;
  employeeCount: number;
  overtimeMultiplier: number;
  workWeekSchedule: Record<number, unknown>;
  requireOnSite: boolean;
  siteLat: number | null;
  siteLng: number | null;
  siteRadiusMeters: number | null;
  enforceOnSiteAtLogin: boolean;
  branding: BrandingRecord;
}

function mapDocumentTemplate(raw: unknown): BrandingDocumentTemplate | undefined {
  // Pass the blob through opaquely: the editor owns the schema and
  // resolveTemplateConfig validates/defaults every field at read time.
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as BrandingDocumentTemplate;
}

function mapBranding(raw: unknown): BrandingRecord {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BRANDING };
  const b = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    companyName: str(b.companyName),
    companyAddress: str(b.companyAddress),
    companyPhone: str(b.companyPhone),
    companyEmail: str(b.companyEmail),
    logoDataUrl: str(b.logoDataUrl),
    documentTemplate: mapDocumentTemplate(b.documentTemplate),
  };
}

type OrganizationSettingsRow = {
  labor_rate: number;
  material_upcharge: number;
  cnc_rate: number;
  printer_3d_rate: number;
  employee_count: number;
  overtime_multiplier: number;
  work_week_schedule: Record<number, unknown> | null;
  require_on_site?: boolean;
  site_lat?: number | null;
  site_lng?: number | null;
  site_radius_meters?: number | null;
  enforce_on_site_at_login?: boolean;
  branding?: Record<string, unknown> | null;
};

function mapRowToRecord(row: OrganizationSettingsRow): OrganizationSettingsRecord {
  return {
    laborRate: Number(row.labor_rate),
    materialUpcharge: Number(row.material_upcharge),
    cncRate: Number(row.cnc_rate),
    printer3DRate: Number(row.printer_3d_rate),
    employeeCount: Number(row.employee_count),
    overtimeMultiplier: Number(row.overtime_multiplier),
    workWeekSchedule: row.work_week_schedule ?? {},
    requireOnSite: Boolean(row.require_on_site),
    siteLat:
      row.site_lat != null && Number.isFinite(Number(row.site_lat)) ? Number(row.site_lat) : null,
    siteLng:
      row.site_lng != null && Number.isFinite(Number(row.site_lng)) ? Number(row.site_lng) : null,
    siteRadiusMeters:
      row.site_radius_meters != null && Number.isFinite(Number(row.site_radius_meters))
        ? Number(row.site_radius_meters)
        : null,
    enforceOnSiteAtLogin: Boolean(row.enforce_on_site_at_login),
    branding: mapBranding(row.branding),
  };
}

export const adminSettingsService = {
  async getOrganizationSettings(): Promise<OrganizationSettingsRecord | null> {
    // select('*') keeps reads resilient if the `branding` column has not been
    // migrated yet on a given environment (missing column -> undefined, not an error).
    const { data, error } = await supabase
      .from('organization_settings')
      .select('*')
      .eq('org_key', ORG_SETTINGS_KEY)
      .maybeSingle();
    if (error || !data) return null;
    return mapRowToRecord(data as OrganizationSettingsRow);
  },

  async upsertOrganizationSettings(
    settings: OrganizationSettingsRecord
  ): Promise<{ data: OrganizationSettingsRecord | null; error?: string }> {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      return { data: null, error: authError.message || 'Unable to validate current user' };
    }

    const payload = {
      org_key: ORG_SETTINGS_KEY,
      labor_rate: settings.laborRate,
      material_upcharge: settings.materialUpcharge,
      cnc_rate: settings.cncRate,
      printer_3d_rate: settings.printer3DRate,
      employee_count: settings.employeeCount,
      overtime_multiplier: settings.overtimeMultiplier,
      work_week_schedule: settings.workWeekSchedule,
      require_on_site: settings.requireOnSite,
      site_lat: settings.siteLat ?? null,
      site_lng: settings.siteLng ?? null,
      site_radius_meters: settings.siteRadiusMeters ?? null,
      enforce_on_site_at_login: settings.enforceOnSiteAtLogin,
      branding: settings.branding ?? EMPTY_BRANDING,
      updated_by: authData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('organization_settings')
      .upsert(payload, { onConflict: 'org_key' })
      .select('*')
      .single();

    if (error) {
      return {
        data: null,
        error: error.message || 'Unable to save organization settings',
      };
    }
    return { data: mapRowToRecord(data as OrganizationSettingsRow) };
  },
};
