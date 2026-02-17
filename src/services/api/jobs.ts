import type { Job, Comment, JobStatus } from '../../core/types';
import { supabase } from './supabaseClient';
import { getAttachmentPublicUrl } from './storage';

function mapRowToJob(
  row: Record<string, unknown>,
  attachments: { id: string; filename: string; storage_path: string; created_at: string; is_admin_only: boolean }[],
  commentCount: number
): Job {
  const atts = attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    url: getAttachmentPublicUrl(a.storage_path),
    created: a.created_at,
    isAdminOnly: a.is_admin_only,
  }));
  return {
    id: row.id as string,
    jobCode: row.job_code as number,
    po: row.po as string | undefined,
    name: (row.name as string) ?? '',
    qty: row.qty as string | undefined,
    description: row.description as string | undefined,
    ecd: row.ecd as string | undefined,
    dueDate: row.due_date ? new Date(row.due_date as string).toISOString().slice(0, 10) : undefined,
    active: (row.active as boolean) ?? true,
    status: (row.status as JobStatus) ?? 'pending',
    boardType: row.board_type as Job['boardType'],
    attachments: atts,
    attachmentCount: atts.length,
    comments: [],
    commentCount,
    inventoryItems: [],
    createdBy: row.created_by as string | undefined,
    assignedUsers: (row.assigned_users as string[]) ?? [],
    isRush: (row.is_rush as boolean) ?? false,
    workers: (row.workers as string[]) ?? [],
    binLocation: row.bin_location as string | undefined,
    expand: row.expand as Job['expand'],
  };
}

export interface PaginatedJobsResult {
  items: Job[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export const jobService = {
  async getAllJobs(): Promise<Job[]> {
    const { data: jobsData, error: jobsErr } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });
    if (jobsErr) throw jobsErr;
    const jobIds = (jobsData ?? []).map((j) => j.id);

    const [attachmentsRes, commentsRes, jobInventoryRes] = await Promise.all([
      jobIds.length ? supabase.from('attachments').select('id, job_id, filename, storage_path, created_at, is_admin_only').in('job_id', jobIds) : { data: [] as { id: string; job_id: string; filename: string; storage_path: string; created_at: string; is_admin_only: boolean }[] },
      jobIds.length ? supabase.from('comments').select('job_id').in('job_id', jobIds) : { data: [] as { job_id: string }[] },
      jobIds.length ? supabase.from('job_inventory').select('id, job_id, inventory_id, quantity, unit').in('job_id', jobIds) : { data: [] },
    ]);

    const attachmentsByJob = new Map<string, typeof attachmentsRes.data>();
    for (const a of attachmentsRes.data ?? []) {
      const list = attachmentsByJob.get(a.job_id) ?? [];
      list.push(a);
      attachmentsByJob.set(a.job_id, list);
    }
    const commentCountByJob = new Map<string, number>();
    for (const c of commentsRes.data ?? []) {
      commentCountByJob.set(c.job_id, (commentCountByJob.get(c.job_id) ?? 0) + 1);
    }
    const jobInvByJob = new Map<string, { id: string; inventory_id: string; quantity: number; unit: string }[]>();
    for (const ji of jobInventoryRes.data ?? []) {
      const list = jobInvByJob.get(ji.job_id) ?? [];
      list.push(ji);
      jobInvByJob.set(ji.job_id, list);
    }

    const inventoryIds = [...new Set((jobInventoryRes.data ?? []).map((ji) => ji.inventory_id))];
    const { data: invNames } = inventoryIds.length
      ? await supabase.from('inventory').select('id, name').in('id', inventoryIds)
      : { data: [] };
    const invNameMap = new Map((invNames ?? []).map((i) => [i.id, i.name]));

    return (jobsData ?? []).map((row) => {
      const atts = attachmentsByJob.get(row.id) ?? [];
      const commentCount = commentCountByJob.get(row.id) ?? 0;
      const jiList = jobInvByJob.get(row.id) ?? [];
      const job = mapRowToJob(row as unknown as Record<string, unknown>, atts, commentCount);
      job.inventoryItems = jiList.map((ji) => ({
        id: ji.id,
        inventoryId: ji.inventory_id,
        inventoryName: invNameMap.get(ji.inventory_id) ?? 'Unknown Item',
        quantity: ji.quantity,
        unit: ji.unit ?? 'units',
      }));
      job.expand = {
        job_inventory_via_job: jiList.map((ji) => ({
          id: ji.id,
          job: row.id,
          inventory: ji.inventory_id,
          quantity: ji.quantity,
          unit: ji.unit ?? 'units',
        })),
      };
      return job;
    });
  },

  async getJobsPaginated(page = 1, perPage = 50, filter?: string): Promise<PaginatedJobsResult> {
    let q = supabase.from('jobs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (filter) {
      const f = filter.trim();
      if (f) q = q.or(`name.ilike.%${f}%,po.ilike.%${f}%,description.ilike.%${f}%`);
    }
    const from = (page - 1) * perPage;
    const { data: jobsData, error: jobsErr, count } = await q.range(from, from + perPage - 1);
    if (jobsErr) throw jobsErr;
    const jobIds = (jobsData ?? []).map((j) => j.id);
    if (jobIds.length === 0) {
      return { items: [], page, perPage, totalItems: count ?? 0, totalPages: Math.ceil((count ?? 0) / perPage) };
    }

    const [attachmentsRes, commentsRes, jobInventoryRes] = await Promise.all([
      supabase.from('attachments').select('id, job_id, filename, storage_path, created_at, is_admin_only').in('job_id', jobIds),
      supabase.from('comments').select('job_id').in('job_id', jobIds),
      supabase.from('job_inventory').select('id, job_id, inventory_id, quantity, unit').in('job_id', jobIds),
    ]);
    const attachmentsByJob = new Map<string, (typeof attachmentsRes.data)[number][]>();
    for (const a of attachmentsRes.data ?? []) {
      const list = attachmentsByJob.get(a.job_id) ?? [];
      list.push(a);
      attachmentsByJob.set(a.job_id, list);
    }
    const commentCountByJob = new Map<string, number>();
    for (const c of commentsRes.data ?? []) {
      commentCountByJob.set(c.job_id, (commentCountByJob.get(c.job_id) ?? 0) + 1);
    }
    const jobInvByJob = new Map<string, { id: string; inventory_id: string; quantity: number; unit: string }[]>();
    for (const ji of jobInventoryRes.data ?? []) {
      const list = jobInvByJob.get(ji.job_id) ?? [];
      list.push(ji);
      jobInvByJob.set(ji.job_id, list);
    }
    const inventoryIds = [...new Set((jobInventoryRes.data ?? []).map((ji) => ji.inventory_id))];
    const { data: invNames } = await supabase.from('inventory').select('id, name').in('id', inventoryIds);
    const invNameMap = new Map((invNames ?? []).map((i) => [i.id, i.name]));

    const items: Job[] = (jobsData ?? []).map((row) => {
      const atts = attachmentsByJob.get(row.id) ?? [];
      const commentCount = commentCountByJob.get(row.id) ?? 0;
      const jiList = jobInvByJob.get(row.id) ?? [];
      const job = mapRowToJob(row as unknown as Record<string, unknown>, atts, commentCount);
      job.inventoryItems = jiList.map((ji) => ({
        id: ji.id,
        inventoryId: ji.inventory_id,
        inventoryName: invNameMap.get(ji.inventory_id) ?? 'Unknown Item',
        quantity: ji.quantity,
        unit: ji.unit ?? 'units',
      }));
      job.expand = { job_inventory_via_job: jiList.map((ji) => ({ id: ji.id, job: row.id, inventory: ji.inventory_id, quantity: ji.quantity, unit: ji.unit ?? 'units' })) };
      return job;
    });

    const totalItems = count ?? 0;
    return { items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) };
  },

  async getJobById(id: string): Promise<Job | null> {
    const { data: jobRow, error: jobErr } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (jobErr || !jobRow) return null;

    const [attachmentsRes, commentsRes, jobInventoryRes] = await Promise.all([
      supabase.from('attachments').select('id, filename, storage_path, created_at, is_admin_only').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('comments').select('id, user_id, text, created_at').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('job_inventory').select('id, inventory_id, quantity, unit').eq('job_id', id),
    ]);

    const atts = (attachmentsRes.data ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      url: getAttachmentPublicUrl(a.storage_path),
      created: a.created_at,
      isAdminOnly: a.is_admin_only ?? false,
    }));

    const userIds = [...new Set((commentsRes.data ?? []).map((c) => c.user_id))];
    const { data: profiles } = userIds.length ? await supabase.from('profiles').select('id, name, initials').in('id', userIds) : { data: [] };
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const comments: Comment[] = (commentsRes.data ?? []).map((c) => {
      const p = profileMap.get(c.user_id);
      return {
        id: c.id,
        userId: c.user_id,
        userName: p?.name ?? undefined,
        userInitials: p?.initials ?? undefined,
        text: c.text,
        timestamp: c.created_at,
      };
    });

    const invIds = (jobInventoryRes.data ?? []).map((ji) => ji.inventory_id);
    const { data: invRows } = invIds.length ? await supabase.from('inventory').select('id, name').in('id', invIds) : { data: [] };
    const invMap = new Map((invRows ?? []).map((i) => [i.id, i]));

    const job = mapRowToJob(jobRow as unknown as Record<string, unknown>, attachmentsRes.data ?? [], comments.length);
    job.attachments = atts;
    job.comments = comments;
    job.inventoryItems = (jobInventoryRes.data ?? []).map((ji) => ({
      id: ji.id,
      inventoryId: ji.inventory_id,
      inventoryName: invMap.get(ji.inventory_id)?.name ?? 'Unknown Item',
      quantity: ji.quantity,
      unit: ji.unit ?? 'units',
    }));
    return job;
  },

  async getJobByCode(code: number): Promise<Job | null> {
    const { data: jobRow, error } = await supabase.from('jobs').select('*').eq('job_code', code).single();
    if (error || !jobRow) return null;
    const ji = await supabase.from('job_inventory').select('id, inventory_id, quantity, unit').eq('job_id', jobRow.id);
    const invIds = (ji.data ?? []).map((x) => x.inventory_id);
    const { data: invNames } = invIds.length ? await supabase.from('inventory').select('id, name').in('id', invIds) : { data: [] };
    const invMap = new Map((invNames ?? []).map((i) => [i.id, i.name]));
    const job = mapRowToJob(jobRow as unknown as Record<string, unknown>, [], 0);
    job.attachments = [];
    job.attachmentCount = 0;
    job.comments = [];
    job.commentCount = 0;
    job.inventoryItems = (ji.data ?? []).map((x) => ({
      id: x.id,
      inventoryId: x.inventory_id,
      inventoryName: invMap.get(x.inventory_id) ?? 'Unknown Item',
      quantity: x.quantity,
      unit: x.unit ?? 'units',
    }));
    return job;
  },

  async createJob(data: Partial<Job>): Promise<Job | null> {
    const row = {
      job_code: data.jobCode ?? 0,
      po: data.po ?? null,
      name: data.name ?? '',
      qty: data.qty ?? null,
      description: data.description ?? null,
      ecd: data.ecd ?? null,
      due_date: data.dueDate ?? null,
      active: data.active ?? true,
      status: data.status ?? 'pending',
      board_type: data.boardType ?? 'shopFloor',
      created_by: data.createdBy ?? null,
      assigned_users: data.assignedUsers ?? [],
      is_rush: data.isRush ?? false,
      workers: data.workers ?? [],
      bin_location: data.binLocation ?? null,
    };
    const { data: created, error } = await supabase.from('jobs').insert(row).select('*').single();
    if (error) return null;
    return mapRowToJob(created as unknown as Record<string, unknown>, [], 0);
  },

  async updateJob(jobId: string, data: Partial<Job>): Promise<Job | null> {
    const row: Record<string, unknown> = {};
    if (data.jobCode != null) row.job_code = data.jobCode;
    if (data.po != null) row.po = data.po;
    if (data.name != null) row.name = data.name;
    if (data.qty != null) row.qty = data.qty;
    if (data.description != null) row.description = data.description;
    if (data.ecd != null) row.ecd = data.ecd;
    if (data.dueDate != null) row.due_date = data.dueDate;
    if (data.active != null) row.active = data.active;
    if (data.status != null) row.status = data.status;
    if (data.boardType != null) row.board_type = data.boardType;
    if (data.createdBy != null) row.created_by = data.createdBy;
    if (data.assignedUsers != null) row.assigned_users = data.assignedUsers;
    if (data.isRush != null) row.is_rush = data.isRush;
    if (data.workers != null) row.workers = data.workers;
    if (data.binLocation != null) row.bin_location = data.binLocation;
    row.updated_at = new Date().toISOString();
    const { data: updated, error } = await supabase.from('jobs').update(row).eq('id', jobId).select('*').single();
    if (error) return null;
    return mapRowToJob(updated as unknown as Record<string, unknown>, [], 0);
  },

  async updateJobStatus(jobId: string, status: JobStatus): Promise<void> {
    await supabase.from('jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', jobId);
  },

  async deleteJob(jobId: string): Promise<boolean> {
    const { error } = await supabase.from('jobs').delete().eq('id', jobId);
    return !error;
  },

  async addComment(jobId: string, text: string, userId: string): Promise<Comment | null> {
    const { data, error } = await supabase.from('comments').insert({ job_id: jobId, user_id: userId, text }).select('id, user_id, text, created_at').single();
    if (error) return null;
    return {
      id: data.id,
      userId: data.user_id,
      text: data.text,
      timestamp: data.created_at,
    };
  },

  async updateComment(commentId: string, text: string): Promise<Comment | null> {
    const { data, error } = await supabase.from('comments').update({ text }).eq('id', commentId).select('id, user_id, text, created_at').single();
    if (error) return null;
    return { id: data.id, userId: data.user_id, text: data.text, timestamp: data.created_at };
  },

  async deleteComment(commentId: string): Promise<boolean> {
    const { error } = await supabase.from('comments').delete().eq('id', commentId);
    return !error;
  },

  async addJobInventory(jobId: string, inventoryId: string, quantity: number, unit: string): Promise<void> {
    await supabase.from('job_inventory').insert({ job_id: jobId, inventory_id: inventoryId, quantity, unit });
  },

  async removeJobInventory(_jobId: string, jobInventoryId: string): Promise<void> {
    await supabase.from('job_inventory').delete().eq('id', jobInventoryId);
  },

  async addAttachment(jobId: string, file: File, isAdminOnly = false): Promise<boolean> {
    const { uploadAttachment } = await import('./storage');
    const id = await uploadAttachment(jobId, file, isAdminOnly);
    return id != null;
  },

  async deleteAttachment(attachmentId: string): Promise<boolean> {
    const { deleteAttachmentRecord } = await import('./storage');
    return deleteAttachmentRecord(attachmentId);
  },
};
