import type { Shift } from '../../core/types';
import { supabase } from './supabaseClient';

const SHIFTS_SELECT_WITH_LUNCH =
  'id, user_id, job_id, clock_in_time, clock_out_time, lunch_start_time, lunch_end_time, lunch_minutes_used, notes';
const SHIFTS_SELECT_BASE = 'id, user_id, job_id, clock_in_time, clock_out_time, notes';

function isMissingLunchColumnsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true; // undefined_column
  if (error.code === 'PGRST204') return true; // column not in schema
  const msg = error.message ?? '';
  if (String(error.code) === '400' && /column|schema/i.test(msg)) return true;
  return /lunch_start_time|lunch_end_time|lunch_minutes_used|could not find.*column/i.test(msg);
}

function mapRowToShift(
  row: Record<string, unknown>,
  userName?: string,
  userInitials?: string,
  jobName?: string,
  jobCode?: number
): Shift {
  return {
    id: row.id as string,
    user: row.user_id as string,
    userName,
    userInitials,
    job: row.job_id as string,
    jobName,
    jobCode,
    clockInTime: row.clock_in_time as string,
    clockOutTime: row.clock_out_time as string | undefined,
    lunchStartTime: row.lunch_start_time as string | undefined,
    lunchEndTime: row.lunch_end_time as string | undefined,
    lunchMinutesUsed: row.lunch_minutes_used as number | undefined,
    notes: row.notes as string | undefined,
  };
}

export const shiftService = {
  async getAllShifts(): Promise<Shift[]> {
    const withLunch = await supabase
      .from('shifts')
      .select(SHIFTS_SELECT_WITH_LUNCH)
      .order('clock_in_time', { ascending: false });

    let list = withLunch.data ?? [];
    if (withLunch.error) {
      if (!isMissingLunchColumnsError(withLunch.error)) {
        throw withLunch.error;
      }
      // Backward compatibility: DB may lack lunch columns (run 20260221000200 + 20260224000008).
      const fallback = await supabase
        .from('shifts')
        .select(SHIFTS_SELECT_BASE)
        .order('clock_in_time', { ascending: false });
      if (fallback.error) throw fallback.error;
      list = fallback.data ?? [];
    }

    const userIds = [...new Set(list.map((r) => r.user_id))];
    const jobIds = [...new Set(list.map((r) => r.job_id))];
    const [profilesRes, jobsRes] = await Promise.all([
      userIds.length
        ? supabase.from('profiles').select('id, name, initials').in('id', userIds)
        : { data: [] },
      jobIds.length
        ? supabase.from('jobs').select('id, name, job_code').in('id', jobIds)
        : { data: [] },
    ]);
    const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
    const jobMap = new Map((jobsRes.data ?? []).map((j) => [j.id, j]));
    return list.map((row) => {
      const p = profileMap.get(row.user_id);
      const j = jobMap.get(row.job_id);
      return mapRowToShift(
        row as unknown as Record<string, unknown>,
        p?.name,
        p?.initials,
        j?.name,
        j?.job_code
      );
    });
  },

  /**
   * Clock in: returns false only when the user already has an open shift (business rule).
   * Throws on network/DB/RLS errors so callers can retry or offline-queue.
   */
  async clockIn(jobId: string, userId: string): Promise<boolean> {
    const { data: activeShift, error: activeShiftError } = await supabase
      .from('shifts')
      .select('id')
      .eq('user_id', userId)
      .is('clock_out_time', null)
      .limit(1)
      .maybeSingle();

    if (activeShiftError) {
      console.error('Shift active-check failed:', activeShiftError);
      throw activeShiftError;
    }

    // Enforce exactly one active shift per user.
    if (activeShift) {
      return false;
    }

    const { error } = await supabase.from('shifts').insert({
      job_id: jobId,
      user_id: userId,
      clock_in_time: new Date().toISOString(),
    });
    if (error) {
      console.error('Shift clockIn failed:', error);
      throw error;
    }
    return true;
  },

  /** Throws on failure. Idempotent sync can use getShiftOpenState first. */
  async clockOut(shiftId: string): Promise<void> {
    const { error } = await supabase
      .from('shifts')
      .update({ clock_out_time: new Date().toISOString() })
      .eq('id', shiftId);
    if (error) {
      console.error('Shift clockOut failed:', error);
      throw error;
    }
  },

  /** For offline sync: already clocked out or row missing → do not call clockOut again. */
  async getShiftOpenState(shiftId: string): Promise<{ exists: boolean; open: boolean }> {
    const { data, error } = await supabase
      .from('shifts')
      .select('clock_out_time')
      .eq('id', shiftId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { exists: false, open: false };
    return { exists: true, open: data.clock_out_time == null };
  },

  async startLunch(shiftId: string): Promise<boolean> {
    const { error } = await supabase
      .from('shifts')
      .update({
        lunch_start_time: new Date().toISOString(),
        lunch_end_time: null,
      })
      .eq('id', shiftId);
    return !error;
  },

  async endLunch(shiftId: string, lunchMinutesUsed?: number): Promise<boolean> {
    const row: Record<string, unknown> = {
      lunch_start_time: null,
      lunch_end_time: new Date().toISOString(),
    };
    const raw = lunchMinutesUsed;
    const minutes =
      typeof raw === 'number' && Number.isFinite(raw)
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;
    if (Number.isFinite(minutes) && minutes >= 0) {
      row.lunch_minutes_used = Math.max(0, Math.round(minutes));
    }

    const { error } = await supabase.from('shifts').update(row).eq('id', shiftId);
    return !error;
  },

  async updateShiftTimes(
    shiftId: string,
    clockInTime: string,
    clockOutTime?: string
  ): Promise<boolean> {
    const row: Record<string, unknown> = { clock_in_time: clockInTime };
    if (clockOutTime !== undefined) row.clock_out_time = clockOutTime;
    const { error } = await supabase.from('shifts').update(row).eq('id', shiftId);
    return !error;
  },

  async createShiftManual(data: {
    user: string;
    job: string;
    clockInTime: string;
    clockOutTime?: string;
  }): Promise<Shift | null> {
    const row = {
      user_id: data.user,
      job_id: data.job,
      clock_in_time: data.clockInTime,
      clock_out_time: data.clockOutTime ?? null,
    };
    const { data: created, error } = await supabase.from('shifts').insert(row).select('*').single();
    if (error) return null;
    return mapRowToShift(created as unknown as Record<string, unknown>);
  },

  async deleteShift(shiftId: string): Promise<boolean> {
    const { error } = await supabase.from('shifts').delete().eq('id', shiftId);
    return !error;
  },
};
