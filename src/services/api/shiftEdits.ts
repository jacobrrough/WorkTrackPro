import type { ShiftEdit } from '../../core/types';
import { supabase } from './supabaseClient';

function mapRowToShiftEdit(row: Record<string, unknown>, editedByName?: string): ShiftEdit {
  return {
    id: row.id as string,
    shift: row.shift_id as string,
    editedBy: row.edited_by as string,
    editedByName,
    previousClockIn: row.previous_clock_in as string,
    newClockIn: row.new_clock_in as string,
    previousClockOut: row.previous_clock_out as string | undefined,
    newClockOut: row.new_clock_out as string | undefined,
    reason: row.reason as string | undefined,
    editTimestamp: row.edit_timestamp as string,
  };
}

export const shiftEditService = {
  async getByShift(shiftId: string): Promise<ShiftEdit[]> {
    const { data, error } = await supabase
      .from('shift_edits')
      .select('*')
      .eq('shift_id', shiftId)
      .order('edit_timestamp', { ascending: false });
    if (error) return [];
    const editorIds = [...new Set((data ?? []).map((r) => r.edited_by))];
    const { data: profiles } = editorIds.length
      ? await supabase.from('profiles').select('id, name').in('id', editorIds)
      : { data: [] };
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.name]));
    return (data ?? []).map((row) =>
      mapRowToShiftEdit(
        row as unknown as Record<string, unknown>,
        nameMap.get(row.edited_by) ?? undefined
      )
    );
  },

  async create(data: {
    shift_id: string;
    edited_by: string;
    previous_clock_in: string;
    new_clock_in: string;
    previous_clock_out?: string;
    new_clock_out?: string;
    reason?: string;
  }): Promise<boolean> {
    const row = {
      shift_id: data.shift_id,
      edited_by: data.edited_by,
      previous_clock_in: data.previous_clock_in,
      new_clock_in: data.new_clock_in,
      previous_clock_out: data.previous_clock_out ?? null,
      new_clock_out: data.new_clock_out ?? null,
      reason: data.reason ?? null,
    };
    const { error } = await supabase.from('shift_edits').insert(row);
    return !error;
  },
};
