import type { Checklist, ChecklistItem, JobStatus } from '../../core/types';
import { supabase } from './supabaseClient';

function mapRowToChecklist(row: Record<string, unknown>): Checklist {
  return {
    id: row.id as string,
    job: (row.job_id as string) ?? '',
    status: row.status as JobStatus,
    items: (row.items as ChecklistItem[]) ?? [],
    created: row.created_at as string,
    updated: row.updated_at as string,
  };
}

export const checklistService = {
  async getByJob(jobId: string): Promise<Checklist[]> {
    const { data, error } = await supabase.from('checklists').select('*').eq('job_id', jobId);
    if (error) return [];
    return (data ?? []).map((row) => mapRowToChecklist(row as unknown as Record<string, unknown>));
  },

  /** Fetch checklists for many jobs in one or a few requests. Use this instead of getByJob in a loop. */
  async getByJobIds(jobIds: string[]): Promise<Record<string, Checklist[]>> {
    if (jobIds.length === 0) return {};
    const byJob: Record<string, Checklist[]> = {};
    for (const id of jobIds) byJob[id] = [];
    const chunkSize = 80; // avoid PostgREST URL/query limits
    for (let i = 0; i < jobIds.length; i += chunkSize) {
      const chunk = jobIds.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('checklists').select('*').in('job_id', chunk);
      if (error) continue;
      for (const row of data ?? []) {
        const jobId = row.job_id as string;
        if (jobId && byJob[jobId]) {
          byJob[jobId].push(mapRowToChecklist(row as unknown as Record<string, unknown>));
        }
      }
    }
    return byJob;
  },

  async getTemplates(): Promise<Checklist[]> {
    const { data, error } = await supabase
      .from('checklists')
      .select('*')
      .is('job_id', null)
      .order('status');
    if (error) {
      console.error('checklistService.getTemplates failed:', error.message);
      return [];
    }
    return (data ?? []).map((row) => mapRowToChecklist(row as unknown as Record<string, unknown>));
  },

  async getByJobAndStatus(jobId: string, status: JobStatus): Promise<Checklist | null> {
    const { data, error } = await supabase
      .from('checklists')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', status)
      .maybeSingle();
    if (error || !data) return null;
    return mapRowToChecklist(data as unknown as Record<string, unknown>);
  },

  /**
   * Ensure a job has a checklist for a specific status.
   * - Reuses existing checklist when present
   * - Clones template checklist items when available
   * - Falls back to a default single-item checklist
   */
  async ensureJobChecklistForStatus(jobId: string, status: JobStatus): Promise<Checklist | null> {
    const existing = await this.getByJobAndStatus(jobId, status);
    if (existing) return existing;

    const templates = await this.getTemplates();
    const template = templates.find((c) => c.status === status);
    const templateItems = template?.items ?? [];
    const items =
      templateItems.length > 0
        ? templateItems.map((item) => ({
            id: item.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            text: item.text,
            checked: false,
          }))
        : [{ id: `item_${Date.now()}`, text: 'MOVE', checked: false }];

    return this.create({
      job_id: jobId,
      status,
      items,
    });
  },

  async getFullList(filter?: { jobId?: string | null; status?: string }): Promise<Checklist[]> {
    let q = supabase.from('checklists').select('*');
    if (filter?.jobId !== undefined && filter?.jobId !== null) q = q.eq('job_id', filter.jobId);
    if (filter?.jobId === null) q = q.is('job_id', null);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).map((row) => mapRowToChecklist(row as unknown as Record<string, unknown>));
  },

  async create(data: {
    job_id: string | null;
    status: JobStatus;
    items: ChecklistItem[];
  }): Promise<Checklist | null> {
    const { data: created, error } = await supabase
      .from('checklists')
      .insert({ job_id: data.job_id || null, status: data.status, items: data.items })
      .select('*')
      .single();
    if (error) {
      console.error('checklistService.create failed:', error.message);
      return null;
    }
    return mapRowToChecklist(created as unknown as Record<string, unknown>);
  },

  async update(
    id: string,
    data: { status?: JobStatus; items?: ChecklistItem[] }
  ): Promise<Checklist | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status != null) row.status = data.status;
    if (data.items != null) row.items = data.items;
    const { data: updated, error } = await supabase
      .from('checklists')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToChecklist(updated as unknown as Record<string, unknown>);
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await supabase.from('checklists').delete().eq('id', id);
    return !error;
  },
};

export interface ChecklistHistoryRow {
  id: string;
  checklist: string;
  user: string;
  userName?: string;
  userInitials?: string;
  itemIndex: number;
  itemText: string;
  checked: boolean;
  timestamp: string;
}

export const checklistHistoryService = {
  async getByChecklist(checklistId: string): Promise<ChecklistHistoryRow[]> {
    const { data, error } = await supabase
      .from('checklist_history')
      .select('id, checklist_id, user_id, item_index, item_text, checked, created_at')
      .eq('checklist_id', checklistId)
      .order('created_at', { ascending: false });
    if (error) return [];
    const userIds = [...new Set((data ?? []).map((r) => r.user_id))];
    const { data: profiles } = userIds.length
      ? await supabase.from('profiles').select('id, name, initials').in('id', userIds)
      : { data: [] };
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (data ?? []).map((r) => ({
      id: r.id,
      checklist: r.checklist_id,
      user: r.user_id,
      userName: profileMap.get(r.user_id)?.name,
      userInitials: profileMap.get(r.user_id)?.initials,
      itemIndex: r.item_index,
      itemText: r.item_text ?? '',
      checked: r.checked,
      timestamp: r.created_at,
    }));
  },

  /** All checklist history for a job (all statuses), sorted by timestamp descending. */
  async getByJob(jobId: string): Promise<(ChecklistHistoryRow & { status?: JobStatus })[]> {
    const checklists = await checklistService.getByJob(jobId);
    const all: (ChecklistHistoryRow & { status?: JobStatus })[] = [];
    for (const c of checklists) {
      const rows = await this.getByChecklist(c.id);
      for (const r of rows) {
        all.push({ ...r, status: c.status });
      }
    }
    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return all;
  },

  async create(data: {
    checklist_id: string;
    user_id: string;
    item_index: number;
    item_text: string;
    checked: boolean;
  }): Promise<boolean> {
    const { error } = await supabase.from('checklist_history').insert(data);
    return !error;
  },
};
