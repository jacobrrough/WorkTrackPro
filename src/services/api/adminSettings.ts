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
}

type OrganizationSettingsRow = {
  labor_rate: number;
  material_upcharge: number;
  cnc_rate: number;
  printer_3d_rate: number;
  employee_count: number;
  overtime_multiplier: number;
  work_week_schedule: Record<number, unknown> | null;
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
  };
}

export const adminSettingsService = {
  async getOrganizationSettings(): Promise<OrganizationSettingsRecord | null> {
    const { data, error } = await supabase
      .from('organization_settings')
      .select(
        'labor_rate, material_upcharge, cnc_rate, printer_3d_rate, employee_count, overtime_multiplier, work_week_schedule'
      )
      .eq('org_key', ORG_SETTINGS_KEY)
      .maybeSingle();
    if (error || !data) return null;
    return mapRowToRecord(data as OrganizationSettingsRow);
  },

  async upsertOrganizationSettings(
    settings: OrganizationSettingsRecord
  ): Promise<{ data: OrganizationSettingsRecord | null; error?: string }> {
    const {
      data: authData,
      error: authError,
    } = await supabase.auth.getUser();
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
      updated_by: authData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('organization_settings')
      .upsert(payload, { onConflict: 'org_key' })
      .select(
        'labor_rate, material_upcharge, cnc_rate, printer_3d_rate, employee_count, overtime_multiplier, work_week_schedule'
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
