import type { ProjectHourEntry, ProjectHourStatus, ProjectHours } from '../../core/types';
import { supabase } from './supabaseClient';

function mapProjectRow(row: Record<string, unknown>): ProjectHours {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    status: (row.status as ProjectHourStatus) ?? 'active',
    archivedAt: (row.archived_at as string) ?? undefined,
    createdBy: (row.created_by as string) ?? undefined,
    createdAt: (row.created_at as string) ?? undefined,
    updatedAt: (row.updated_at as string) ?? undefined,
  };
}

function mapEntryRow(row: Record<string, unknown>): ProjectHourEntry {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    entryDate: row.entry_date as string,
    hours: Number(row.hours),
    rate: Number(row.rate),
    note: (row.note as string) ?? undefined,
    createdBy: (row.created_by as string) ?? undefined,
    createdAt: (row.created_at as string) ?? undefined,
  };
}

export const projectHoursService = {
  // ── Projects ────────────────────────────────────────────
  async listProjects(includeArchived = false): Promise<ProjectHours[]> {
    let query = supabase.from('project_hours').select('*');
    if (!includeArchived) query = query.is('archived_at', null);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      // Throw (not return []) so React Query enters isError and the view can show a
      // retry instead of a misleading "No projects yet" empty state.
      console.error('projectHoursService.listProjects failed:', error.message);
      throw new Error(error.message);
    }
    return (data ?? []).map((r) => mapProjectRow(r as Record<string, unknown>));
  },

  async createProject(data: { name: string; description?: string }): Promise<ProjectHours | null> {
    // created_by is set DB-side via `default auth.uid()` — do not trust a client value.
    const { data: row, error } = await supabase
      .from('project_hours')
      .insert({ name: data.name, description: data.description ?? null })
      .select()
      .single();
    if (error || !row) {
      console.error('projectHoursService.createProject failed:', error?.message);
      return null;
    }
    return mapProjectRow(row as Record<string, unknown>);
  },

  async updateProject(
    id: string,
    data: Partial<{ name: string; description: string | null; status: ProjectHourStatus }>
  ): Promise<ProjectHours | null> {
    // updated_at is owned by the DB trigger — do not stamp it client-side.
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.status !== undefined) updates.status = data.status;

    const { data: row, error } = await supabase
      .from('project_hours')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error || !row) {
      console.error('projectHoursService.updateProject failed:', error?.message);
      return null;
    }
    return mapProjectRow(row as Record<string, unknown>);
  },

  async archiveProject(id: string): Promise<boolean> {
    return setArchived(id, new Date().toISOString());
  },

  async unarchiveProject(id: string): Promise<boolean> {
    return setArchived(id, null);
  },

  async deleteProject(id: string): Promise<boolean> {
    // Hard delete; entries cascade via the FK. .select() detects an RLS-denied no-op.
    const { data, error } = await supabase.from('project_hours').delete().eq('id', id).select('id');
    if (error || !data || data.length === 0) {
      console.error(
        'projectHoursService.deleteProject failed:',
        error?.message ?? 'no row affected'
      );
      return false;
    }
    return true;
  },

  // ── Entries ─────────────────────────────────────────────
  async listEntries(): Promise<ProjectHourEntry[]> {
    const { data, error } = await supabase
      .from('project_hour_entries')
      .select('*')
      .order('entry_date', { ascending: false });
    if (error) {
      // Throw so React Query surfaces isError (see listProjects rationale).
      console.error('projectHoursService.listEntries failed:', error.message);
      throw new Error(error.message);
    }
    return (data ?? []).map((r) => mapEntryRow(r as Record<string, unknown>));
  },

  async addEntry(data: {
    projectId: string;
    entryDate: string;
    hours: number;
    note?: string;
  }): Promise<ProjectHourEntry | null> {
    // rate snapshots via the column default; created_by via `default auth.uid()`.
    const { data: row, error } = await supabase
      .from('project_hour_entries')
      .insert({
        project_id: data.projectId,
        entry_date: data.entryDate,
        hours: data.hours,
        note: data.note ?? null,
      })
      .select()
      .single();
    if (error || !row) {
      if (error?.code === '23503') {
        console.error('projectHoursService.addEntry failed: project no longer exists');
      } else {
        console.error('projectHoursService.addEntry failed:', error?.message);
      }
      return null;
    }
    return mapEntryRow(row as Record<string, unknown>);
  },

  async updateEntry(
    id: string,
    data: Partial<{ entryDate: string; hours: number; note: string | null }>
  ): Promise<ProjectHourEntry | null> {
    // rate is the original snapshot and is intentionally not editable here.
    const updates: Record<string, unknown> = {};
    if (data.entryDate !== undefined) updates.entry_date = data.entryDate;
    if (data.hours !== undefined) updates.hours = data.hours;
    if (data.note !== undefined) updates.note = data.note;

    const { data: row, error } = await supabase
      .from('project_hour_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error || !row) {
      console.error('projectHoursService.updateEntry failed:', error?.message);
      return null;
    }
    return mapEntryRow(row as Record<string, unknown>);
  },

  async deleteEntry(id: string): Promise<boolean> {
    // .select() so an RLS-denied delete (reported as success with 0 rows) is detected.
    const { data, error } = await supabase
      .from('project_hour_entries')
      .delete()
      .eq('id', id)
      .select('id');
    if (error || !data || data.length === 0) {
      console.error('projectHoursService.deleteEntry failed:', error?.message ?? 'no row affected');
      return false;
    }
    return true;
  },
};

async function setArchived(id: string, archivedAt: string | null): Promise<boolean> {
  const { data, error } = await supabase
    .from('project_hours')
    .update({ archived_at: archivedAt })
    .eq('id', id)
    .select('id');
  if (error || !data || data.length === 0) {
    console.error('projectHoursService.setArchived failed:', error?.message ?? 'no row affected');
    return false;
  }
  return true;
}
