import type { Job, JobStatus, Comment } from '../../core/types';
import { supabase } from './supabaseClient';
import { uploadAttachment, deleteAttachmentRecord } from './storage';

type JobInventoryRow = {
  id: string;
  job_id: string;
  inventory_id: string;
  quantity: number;
  unit: string;
};

type CommentRow = {
  id: string;
  job_id: string;
  user_id: string;
  text: string;
  created_at: string;
};

type AttachmentRow = {
  id: string;
  job_id: string;
  filename: string;
  storage_path: string;
  is_admin_only: boolean;
};

function mapJobRow(row: Record<string, unknown>, expand?: {
  job_inventory?: JobInventoryRow[];
  comments?: (CommentRow & { user_name?: string; user_initials?: string })[];
  attachments?: AttachmentRow[];
}): Job {
  const job: Job = {
    id: row.id as string,
    jobCode: row.job_code as number,
    po: row.po as string | undefined,
    name: (row.name as string) ?? '',
    qty: row.qty as string | undefined,
    description: row.description as string | undefined,
    ecd: row.ecd as string | undefined,
    dueDate: row.due_date as string | undefined,
    laborHours: row.labor_hours as number | undefined,
    active: (row.active as boolean) ?? true,
    status: (row.status as string) as Job['status'],
    boardType: (row.board_type as string) as Job['boardType'],
    attachments: [],
    attachmentCount: 0,
    comments: [],
    commentCount: 0,
    inventoryItems: [],
    createdBy: row.created_by as string | undefined,
    assignedUsers: (row.assigned_users as string[]) ?? [],
    isRush: (row.is_rush as boolean) ?? false,
    workers: (row.workers as string[]) ?? [],
    binLocation: row.bin_location as string | undefined,
    partNumber: row.part_number as string | undefined,
    variantSuffix: row.variant_suffix as string | undefined,
    estNumber: row.est_number as string | undefined,
    invNumber: row.inv_number as string | undefined,
    rfqNumber: row.rfq_number as string | undefined,
    dashQuantities: row.dash_quantities as Record<string, number> | undefined,
    revision: row.revision as string | undefined,
    partId: row.part_id as string | undefined,
  };
  if (expand?.attachments?.length) {
    job.attachments = expand.attachments.map((a) => ({
      id: a.id,
      jobId: a.job_id,
      filename: a.filename,
      storagePath: a.storage_path,
      isAdminOnly: a.is_admin_only,
    }));
    job.attachmentCount = expand.attachments.length;
  }
  if (expand?.comments?.length) {
    job.comments = expand.comments.map((c) => ({
      id: c.id,
      jobId: c.job_id,
      user: c.user_id,
      userName: (c as CommentRow & { user_name?: string }).user_name,
      userInitials: (c as CommentRow & { user_initials?: string }).user_initials,
      text: c.text,
      createdAt: c.created_at,
    }));
    job.commentCount = expand.comments.length;
  }
  if (expand?.job_inventory?.length) {
    job.expand = {
      ...(job.expand || {}),
      job_inventory: expand.job_inventory.map((ji) => ({
        id: ji.id,
        job: ji.job_id,
        inventory: ji.inventory_id,
        quantity: ji.quantity,
        unit: ji.unit,
      })),
    };
    job.inventoryItems = expand.job_inventory.map((ji) => ({
      id: ji.id,
      jobId: ji.job_id,
      inventoryId: ji.inventory_id,
      quantity: ji.quantity,
      unit: ji.unit,
    }));
  }
  return job;
}

async function fetchJobExpand(jobId: string): Promise<{
  job_inventory: JobInventoryRow[];
  comments: (CommentRow & { user_name?: string; user_initials?: string })[];
  attachments: AttachmentRow[];
}> {
  const [jiRes, comRes, attRes] = await Promise.all([
    supabase.from('job_inventory').select('id, job_id, inventory_id, quantity, unit').eq('job_id', jobId),
    supabase
      .from('comments')
      .select('id, job_id, user_id, text, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
    supabase.from('attachments').select('id, job_id, filename, storage_path, is_admin_only').eq('job_id', jobId),
  ]);

  const job_inventory = (jiRes.data ?? []) as JobInventoryRow[];
  const commentsRaw = (comRes.data ?? []) as CommentRow[];
  const attachments = (attRes.data ?? []) as AttachmentRow[];

  const userIds = [...new Set(commentsRaw.map((c) => c.user_id))];
  const profiles =
    userIds.length > 0
      ? await supabase.from('profiles').select('id, name, initials').in('id', userIds)
      : { data: [] };
  const profileMap = new Map((profiles.data ?? []).map((p: { id: string; name?: string; initials?: string }) => [p.id, p]));
  const comments = commentsRaw.map((c) => {
    const p = profileMap.get(c.user_id) as { name?: string; initials?: string } | undefined;
    return { ...c, user_name: p?.name, user_initials: p?.initials };
  });

  return { job_inventory, comments, attachments };
}

export const jobService = {
  async getAllJobs(): Promise<Job[]> {
    const { data: rows, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const list = (rows ?? []) as Record<string, unknown>[];
    const jobs: Job[] = [];
    for (const row of list) {
      const expand = await fetchJobExpand(row.id as string);
      jobs.push(mapJobRow(row, expand));
    }
    return jobs;
  },

  async getJobById(jobId: string): Promise<Job | null> {
    const { data: row, error } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (error || !row) return null;
    const expand = await fetchJobExpand(jobId);
    return mapJobRow(row as Record<string, unknown>, expand);
  },

  async getJobByCode(jobCode: number): Promise<Job | null> {
    const { data: row, error } = await supabase.from('jobs').select('*').eq('job_code', jobCode).single();
    if (error || !row) return null;
    const expand = await fetchJobExpand(row.id as string);
    return mapJobRow(row as Record<string, unknown>, expand);
  },

  async createJob(data: Partial<Job>): Promise<Job | null> {
    const nextCode = await this.getNextJobCode();
    if (nextCode == null) return null;
    const row = {
      job_code: nextCode,
      po: data.po ?? null,
      name: data.name ?? '',
      qty: data.qty ?? null,
      description: data.description ?? null,
      ecd: data.ecd ?? null,
      due_date: data.dueDate ?? null,
      labor_hours: data.laborHours ?? null,
      active: data.active ?? true,
      status: data.status ?? 'pending',
      board_type: data.boardType ?? 'shopFloor',
      created_by: data.createdBy ?? null,
      assigned_users: data.assignedUsers ?? [],
      is_rush: data.isRush ?? false,
      workers: data.workers ?? [],
      bin_location: data.binLocation ?? null,
      part_number: data.partNumber ?? null,
      variant_suffix: data.variantSuffix ?? null,
      est_number: data.estNumber ?? null,
      inv_number: data.invNumber ?? null,
      rfq_number: data.rfqNumber ?? null,
      dash_quantities: data.dashQuantities ?? null,
      revision: data.revision ?? null,
      part_id: data.partId ?? null,
    };
    const { data: created, error } = await supabase.from('jobs').insert(row).select('*').single();
    if (error) return null;
    return mapJobRow(created as Record<string, unknown>, { job_inventory: [], comments: [], attachments: [] });
  },

  async getNextJobCode(): Promise<number | null> {
    const { data, error } = await supabase
      .from('jobs')
      .select('job_code')
      .order('job_code', { ascending: false })
      .limit(1)
      .single();
    if (error) return 1;
    const max = (data?.job_code as number) ?? 0;
    return max + 1;
  },

  async updateJob(jobId: string, data: Partial<Job>): Promise<Job | null> {
    const row: Record<string, unknown> = {};
    if (data.po !== undefined) row.po = data.po ?? null;
    if (data.name !== undefined) row.name = data.name ?? '';
    if (data.qty !== undefined) row.qty = data.qty ?? null;
    if (data.description !== undefined) row.description = data.description ?? null;
    if (data.ecd !== undefined) row.ecd = data.ecd && String(data.ecd).trim() ? data.ecd : null;
    if (data.dueDate !== undefined) row.due_date = data.dueDate && String(data.dueDate).trim() ? data.dueDate : null;
    if (data.laborHours !== undefined) {
      const num = typeof data.laborHours === 'number' ? data.laborHours : parseFloat(String(data.laborHours));
      row.labor_hours = Number.isFinite(num) ? num : null;
    }
    if (data.active !== undefined) row.active = data.active;
    if (data.status !== undefined) row.status = data.status;
    if (data.boardType !== undefined) row.board_type = data.boardType;
    if (data.assignedUsers !== undefined) row.assigned_users = data.assignedUsers;
    if (data.isRush !== undefined) row.is_rush = data.isRush;
    if (data.workers !== undefined) row.workers = data.workers;
    if (data.binLocation !== undefined) row.bin_location = data.binLocation;
    if (data.partNumber !== undefined) row.part_number = data.partNumber;
    if (data.variantSuffix !== undefined) row.variant_suffix = data.variantSuffix;
    if (data.estNumber !== undefined) row.est_number = data.estNumber;
    if (data.invNumber !== undefined) row.inv_number = data.invNumber;
    if (data.rfqNumber !== undefined) row.rfq_number = data.rfqNumber;
    if (data.dashQuantities !== undefined) row.dash_quantities = data.dashQuantities;
    if (data.revision !== undefined) row.revision = data.revision;
    if (data.partId !== undefined) row.part_id = data.partId;
    row.updated_at = new Date().toISOString();
    const { data: updated, error } = await supabase.from('jobs').update(row).eq('id', jobId).select('*').single();
    if (error) return null;
    const expand = await fetchJobExpand(jobId);
    return mapJobRow(updated as Record<string, unknown>, expand);
  },

  async updateJobStatus(jobId: string, status: JobStatus): Promise<boolean> {
    const { error } = await supabase.from('jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', jobId);
    return !error;
  },

  async addComment(jobId: string, text: string, userId: string): Promise<Comment | null> {
    const { data: row, error } = await supabase
      .from('comments')
      .insert({ job_id: jobId, user_id: userId, text })
      .select('id, job_id, user_id, text, created_at')
      .single();
    if (error) return null;
    const profiles = await supabase.from('profiles').select('id, name, initials').eq('id', userId).single();
    const p = profiles.data as { name?: string; initials?: string } | null;
    return {
      id: row.id,
      jobId: row.job_id,
      user: row.user_id,
      userName: p?.name,
      userInitials: p?.initials,
      text: row.text,
      createdAt: row.created_at,
    };
  },

  async updateComment(commentId: string, text: string): Promise<boolean> {
    const { error } = await supabase.from('comments').update({ text }).eq('id', commentId);
    return !error;
  },

  async deleteComment(commentId: string): Promise<boolean> {
    const { error } = await supabase.from('comments').delete().eq('id', commentId);
    return !error;
  },

  async addJobInventory(jobId: string, inventoryId: string, quantity: number, unit: string): Promise<boolean> {
    const { error } = await supabase.from('job_inventory').insert({
      job_id: jobId,
      inventory_id: inventoryId,
      quantity,
      unit: unit || 'units',
    });
    return !error;
  },

  async updateJobInventory(jobInventoryId: string, quantity: number, unit: string): Promise<boolean> {
    const { error } = await supabase
      .from('job_inventory')
      .update({ quantity, unit: unit || 'units' })
      .eq('id', jobInventoryId);
    return !error;
  },

  async removeJobInventory(_jobId: string, jobInventoryId: string): Promise<boolean> {
    const { error } = await supabase.from('job_inventory').delete().eq('id', jobInventoryId);
    return !error;
  },

  async addAttachment(jobId: string, file: File, isAdminOnly: boolean): Promise<boolean> {
    const id = await uploadAttachment(jobId, file, isAdminOnly);
    return id != null;
  },

  async deleteAttachment(attachmentId: string): Promise<boolean> {
    return deleteAttachmentRecord(attachmentId);
  },
};
