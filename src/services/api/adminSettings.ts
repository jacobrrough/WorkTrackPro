import { supabase } from './supabaseClient';

const ORG_SETTINGS_KEY = 'default';

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
  };
}

export const adminSettingsService = {
  async getOrganizationSettings(): Promise<OrganizationSettingsRecord | null> {
    const { data, error } = await supabase
      .from('organization_settings')
      .select(
        'labor_rate, material_upcharge, cnc_rate, printer_3d_rate, employee_count, overtime_multiplier, work_week_schedule, require_on_site, site_lat, site_lng, site_radius_meters, enforce_on_site_at_login'
      )
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
      updated_by: authData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('organization_settings')
      .upsert(payload, { onConflict: 'org_key' })
      .select(
        'labor_rate, material_upcharge, cnc_rate, printer_3d_rate, employee_count, overtime_multiplier, work_week_schedule, require_on_site, site_lat, site_lng, site_radius_meters, enforce_on_site_at_login'
      )
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
