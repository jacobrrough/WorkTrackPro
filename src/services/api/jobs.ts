import type { Job, JobStatus, Comment } from '../../core/types';
import { supabase } from './supabaseClient';
import { uploadAttachment, deleteAttachmentRecord, getAttachmentPublicUrl } from './storage';
import { runMutationWithSchemaFallback } from './schemaCompat';

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

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
  job_id: string | null;
  inventory_id: string | null;
  filename: string;
  storage_path: string;
  is_admin_only: boolean;
  created_at?: string;
};

type PartLookupRow = {
  id: string;
  part_number: string;
};

function mapJobRow(
  row: Record<string, unknown>,
  expand?: {
    job_inventory?: JobInventoryRow[];
    comments?: (CommentRow & { user_name?: string; user_initials?: string })[];
    attachments?: AttachmentRow[];
  }
): Job {
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
    status: row.status as string as Job['status'],
    boardType: row.board_type as string as Job['boardType'],
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
    owrNumber: row.owr_number as string | undefined,
    dashQuantities: row.dash_quantities as Record<string, number> | undefined,
    laborBreakdownByVariant: row.labor_breakdown_by_variant as
      | Record<string, { qty: number; hoursPerUnit: number; totalHours: number }>
      | undefined,
    machineBreakdownByVariant: row.machine_breakdown_by_variant as
      | Record<
          string,
          {
            qty: number;
            cncHoursPerUnit: number;
            cncHoursTotal: number;
            printer3DHoursPerUnit: number;
            printer3DHoursTotal: number;
          }
        >
      | undefined,
    allocationSource: row.allocation_source as 'variant' | 'total' | undefined,
    allocationSourceUpdatedAt: row.allocation_source_updated_at as string | undefined,
    revision: row.revision as string | undefined,
    partId: row.part_id as string | undefined,
  };
  if (expand?.attachments?.length) {
    job.attachments = expand.attachments
      .filter((a) => a.job_id) // Only include job attachments
      .map((a) => ({
        id: a.id,
        jobId: a.job_id!,
        filename: a.filename,
        storagePath: a.storage_path,
        isAdminOnly: a.is_admin_only,
        url: getAttachmentPublicUrl(a.storage_path),
        created: a.created_at,
      }));
    job.attachmentCount = job.attachments.length;
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

function isPartsTableUnavailable(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01';
}

function isMissingTableError(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01';
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function resolvePartForJob(params: {
  partNumber: string;
  fallbackName?: string;
  fallbackDescription?: string;
  fallbackLaborHours?: number;
}): Promise<{ partNumber: string; partId: string | null }> {
  const normalizedPartNumber = params.partNumber.trim();
  if (!normalizedPartNumber) return { partNumber: '', partId: null };

  const { data: existingPartData, error: lookupError } = await supabase
    .from('parts')
    .select('id, part_number')
    .eq('part_number', normalizedPartNumber)
    .maybeSingle();
  const existingPart = (existingPartData ?? null) as PartLookupRow | null;
  if (existingPart) {
    return {
      partNumber: existingPart.part_number,
      partId: existingPart.id,
    };
  }

  if (lookupError && isPartsTableUnavailable(lookupError)) {
    // Parts repository may not be migrated yet. Keep text value on job card.
    return { partNumber: normalizedPartNumber, partId: null };
  }

  const createRow: Record<string, unknown> = {
    part_number: normalizedPartNumber,
    name: params.fallbackName?.trim() || normalizedPartNumber,
    description: params.fallbackDescription?.trim() || null,
  };
  const laborHours = toFiniteNumber(params.fallbackLaborHours);
  if (laborHours != null) createRow.labor_hours = laborHours;

  const { data: createdPartData, error: createError } = await supabase
    .from('parts')
    .insert(createRow)
    .select('id, part_number')
    .single();
  const createdPart = (createdPartData ?? null) as PartLookupRow | null;
  if (createdPart) {
    return {
      partNumber: createdPart.part_number,
      partId: createdPart.id,
    };
  }

  if ((createError as SupabaseErrorLike | null)?.code === '23505') {
    // Race condition: another request created the same part number first.
    const { data: conflictPartData } = await supabase
      .from('parts')
      .select('id, part_number')
      .eq('part_number', normalizedPartNumber)
      .maybeSingle();
    const conflictPart = (conflictPartData ?? null) as PartLookupRow | null;
    if (conflictPart) {
      return {
        partNumber: conflictPart.part_number,
        partId: conflictPart.id,
      };
    }
  }

  if (!isPartsTableUnavailable(createError)) {
    console.warn('resolvePartForJob failed to create part:', createError?.message);
  }
  return { partNumber: normalizedPartNumber, partId: null };
}

async function fetchJobExpand(jobId: string): Promise<{
  job_inventory: JobInventoryRow[];
  comments: (CommentRow & { user_name?: string; user_initials?: string })[];
  attachments: AttachmentRow[];
}> {
  const [jiRes, comRes, attRes] = await Promise.all([
    supabase
      .from('job_inventory')
      .select('id, job_id, inventory_id, quantity, unit')
      .eq('job_id', jobId),
    supabase
      .from('comments')
      .select('id, job_id, user_id, text, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
    supabase.from('attachments').select('*').eq('job_id', jobId),
  ]);

  const job_inventory = (jiRes.data ?? []) as JobInventoryRow[];
  const commentsRaw = (comRes.data ?? []) as CommentRow[];
  const attachments = (attRes.data ?? []) as AttachmentRow[];

  const userIds = [...new Set(commentsRaw.map((c) => c.user_id))];
  const profiles =
    userIds.length > 0
      ? await supabase.from('profiles').select('id, name, initials').in('id', userIds)
      : { data: [] };
  const profileMap = new Map(
    (profiles.data ?? []).map((p: { id: string; name?: string; initials?: string }) => [p.id, p])
  );
  const comments = commentsRaw.map((c) => {
    const p = profileMap.get(c.user_id) as { name?: string; initials?: string } | undefined;
    return { ...c, user_name: p?.name, user_initials: p?.initials };
  });

  return { job_inventory, comments, attachments };
}

async function fetchJobsExpandBatch(jobIds: string[]): Promise<
  Map<
    string,
    {
      job_inventory: JobInventoryRow[];
      comments: (CommentRow & { user_name?: string; user_initials?: string })[];
      attachments: AttachmentRow[];
    }
  >
> {
  const expandByJobId = new Map<
    string,
    {
      job_inventory: JobInventoryRow[];
      comments: (CommentRow & { user_name?: string; user_initials?: string })[];
      attachments: AttachmentRow[];
    }
  >();

  if (jobIds.length === 0) return expandByJobId;

  for (const jobId of jobIds) {
    expandByJobId.set(jobId, {
      job_inventory: [],
      comments: [],
      attachments: [],
    });
  }

  const [jiRes, comRes, attRes] = await Promise.all([
    supabase
      .from('job_inventory')
      .select('id, job_id, inventory_id, quantity, unit')
      .in('job_id', jobIds),
    supabase
      .from('comments')
      .select('id, job_id, user_id, text, created_at')
      .in('job_id', jobIds)
      .order('created_at', { ascending: true }),
    supabase.from('attachments').select('*').in('job_id', jobIds),
  ]);

  const jobInventory = (jiRes.data ?? []) as JobInventoryRow[];
  const commentsRaw = (comRes.data ?? []) as CommentRow[];
  const attachments = (attRes.data ?? []) as AttachmentRow[];

  const userIds = [...new Set(commentsRaw.map((c) => c.user_id))];
  const profiles =
    userIds.length > 0
      ? await supabase.from('profiles').select('id, name, initials').in('id', userIds)
      : { data: [] };
  const profileMap = new Map(
    (profiles.data ?? []).map((p: { id: string; name?: string; initials?: string }) => [p.id, p])
  );

  const comments = commentsRaw.map((c) => {
    const p = profileMap.get(c.user_id) as { name?: string; initials?: string } | undefined;
    return { ...c, user_name: p?.name, user_initials: p?.initials };
  });

  for (const ji of jobInventory) {
    const target = expandByJobId.get(ji.job_id);
    if (target) target.job_inventory.push(ji);
  }

  for (const comment of comments) {
    const target = expandByJobId.get(comment.job_id);
    if (target) target.comments.push(comment);
  }

  for (const attachment of attachments) {
    if (!attachment.job_id) continue;
    const target = expandByJobId.get(attachment.job_id);
    if (target) target.attachments.push(attachment);
  }

  return expandByJobId;
}

export const jobService = {
  async getAllJobs(): Promise<Job[]> {
    const { data: rows, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const list = (rows ?? []) as Record<string, unknown>[];
    if (list.length === 0) return [];

    const jobIds = list
      .map((row) => row.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const expandByJobId = await fetchJobsExpandBatch(jobIds);
    return list.map((row) => {
      const jobId = row.id as string;
      return mapJobRow(row, expandByJobId.get(jobId));
    });
  },

  async getJobById(jobId: string): Promise<Job | null> {
    const { data: row, error } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (error || !row) return null;
    const expand = await fetchJobExpand(jobId);
    return mapJobRow(row as Record<string, unknown>, expand);
  },

  async getJobByCode(jobCode: number): Promise<Job | null> {
    const { data: row, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('job_code', jobCode)
      .single();
    if (error || !row) return null;
    const expand = await fetchJobExpand(row.id as string);
    return mapJobRow(row as Record<string, unknown>, expand);
  },

  async createJob(data: Partial<Job>): Promise<Job | null> {
    const nextCode = await this.getNextJobCode();
    if (nextCode == null) return null;

    const resolvedLaborHours = toFiniteNumber(data.laborHours);
    const rawPartNumber = data.partNumber?.trim();
    const resolvedPart =
      !data.partId && rawPartNumber
        ? await resolvePartForJob({
            partNumber: rawPartNumber,
            fallbackDescription: data.description,
            fallbackLaborHours: resolvedLaborHours,
          })
        : null;

    const row = {
      job_code: nextCode,
      po: data.po ?? null,
      name: data.name ?? '',
      qty: data.qty ?? null,
      description: data.description ?? null,
      ecd: data.ecd ?? null,
      due_date: data.dueDate ?? null,
      labor_hours: resolvedLaborHours ?? null,
      active: data.active ?? true,
      status: data.status ?? 'toBeQuoted',
      board_type: data.boardType ?? 'shopFloor',
      created_by: data.createdBy ?? null,
      assigned_users: data.assignedUsers ?? [],
      is_rush: data.isRush ?? false,
      workers: data.workers ?? [],
      bin_location: data.binLocation ?? null,
      part_number: rawPartNumber ? (resolvedPart?.partNumber ?? rawPartNumber) : null,
      variant_suffix: data.variantSuffix ?? null,
      est_number: data.estNumber ?? null,
      inv_number: data.invNumber ?? null,
      rfq_number: data.rfqNumber ?? null,
      owr_number: data.owrNumber ?? null,
      dash_quantities: data.dashQuantities ?? null,
      labor_breakdown_by_variant: data.laborBreakdownByVariant ?? null,
      machine_breakdown_by_variant: data.machineBreakdownByVariant ?? null,
      allocation_source: data.allocationSource ?? null,
      allocation_source_updated_at: data.allocationSource ? new Date().toISOString() : null,
      revision: data.revision ?? null,
      part_id: data.partId ?? resolvedPart?.partId ?? null,
    };
    const { data: created, error } = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: row,
      mutate: async (payload) => {
        const { data: rowData, error: rowError } = await supabase
          .from('jobs')
          .insert(payload)
          .select('*')
          .single();
        return {
          data: (rowData as Record<string, unknown> | null) ?? null,
          error: (rowError as SupabaseErrorLike | null) ?? null,
        };
      },
    });
    if (error) throw new Error(error.message);
    return mapJobRow(created as Record<string, unknown>, {
      job_inventory: [],
      comments: [],
      attachments: [],
    });
  },

  async getNextJobCode(): Promise<number | null> {
    const { data, error } = await supabase
      .from('jobs')
      .select('job_code')
      .order('job_code', { ascending: false })
      .limit(1)
      .maybeSingle();
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
    if (data.dueDate !== undefined)
      row.due_date = data.dueDate && String(data.dueDate).trim() ? data.dueDate : null;
    if (data.laborHours !== undefined) {
      const num =
        typeof data.laborHours === 'number' ? data.laborHours : parseFloat(String(data.laborHours));
      row.labor_hours = Number.isFinite(num) ? num : null;
    }
    if (data.active !== undefined) row.active = data.active;
    if (data.status !== undefined) row.status = data.status;
    if (data.boardType !== undefined) row.board_type = data.boardType;
    if (data.assignedUsers !== undefined) row.assigned_users = data.assignedUsers;
    if (data.isRush !== undefined) row.is_rush = data.isRush;
    if (data.workers !== undefined) row.workers = data.workers;
    if (data.binLocation !== undefined) row.bin_location = data.binLocation;
    if (data.partNumber !== undefined) {
      const partNum = data.partNumber?.trim() || null;
      if (partNum) {
        const resolvedPart = await resolvePartForJob({
          partNumber: partNum,
          fallbackDescription: data.description,
          fallbackLaborHours: toFiniteNumber(data.laborHours),
        });
        row.part_number = resolvedPart.partNumber;
        row.part_id = resolvedPart.partId;
      } else {
        row.part_number = null;
        row.part_id = null;
      }
    }
    if (data.variantSuffix !== undefined) row.variant_suffix = data.variantSuffix;
    if (data.estNumber !== undefined) row.est_number = data.estNumber;
    if (data.invNumber !== undefined) row.inv_number = data.invNumber;
    if (data.rfqNumber !== undefined) row.rfq_number = data.rfqNumber;
    if (data.owrNumber !== undefined) row.owr_number = data.owrNumber;
    if (data.dashQuantities !== undefined) row.dash_quantities = data.dashQuantities;
    if (data.laborBreakdownByVariant !== undefined)
      row.labor_breakdown_by_variant = data.laborBreakdownByVariant;
    if (data.machineBreakdownByVariant !== undefined)
      row.machine_breakdown_by_variant = data.machineBreakdownByVariant;
    if (data.allocationSource !== undefined) {
      row.allocation_source = data.allocationSource;
      row.allocation_source_updated_at = new Date().toISOString();
    }
    if (data.revision !== undefined) row.revision = data.revision;
    if (data.partId !== undefined) row.part_id = data.partId;
    row.updated_at = new Date().toISOString();
    const { data: updated, error } = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: row,
      mutate: async (payload) => {
        const { data: rowData, error: rowError } = await supabase
          .from('jobs')
          .update(payload)
          .eq('id', jobId)
          .select('*')
          .single();
        return {
          data: (rowData as Record<string, unknown> | null) ?? null,
          error: (rowError as SupabaseErrorLike | null) ?? null,
        };
      },
    });
    if (error) {
      console.error('updateJob failed:', error?.message ?? error, error?.code, {
        jobId,
        payloadKeys: Object.keys(row),
      });
      return null;
    }
    const expand = await fetchJobExpand(jobId);
    return mapJobRow(updated as Record<string, unknown>, expand);
  },

  async updateJobStatus(jobId: string, status: JobStatus): Promise<boolean> {
    const payload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'delivered') {
      payload.bin_location = null;
    }
    const { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
    if (error) {
      console.error('updateJobStatus failed:', error.message, error.code, { jobId, status });
      return false;
    }
    return true;
  },

  async deleteJob(jobId: string): Promise<boolean> {
    try {
      // Delete attachment rows linked to this job first.
      // (Storage cleanup remains handled by explicit attachment deletion flows.)
      {
        const { error } = await supabase.from('attachments').delete().eq('job_id', jobId);
        if (error && !isMissingTableError(error)) {
          console.error('deleteJob attachments cleanup failed:', error.message, error.code, {
            jobId,
          });
          return false;
        }
      }

      // Delete comments linked to this job.
      {
        const { error } = await supabase.from('comments').delete().eq('job_id', jobId);
        if (error && !isMissingTableError(error)) {
          console.error('deleteJob comments cleanup failed:', error.message, error.code, { jobId });
          return false;
        }
      }

      // Delete checklist history and checklists linked to this job.
      {
        const { data: checklistRows, error: checklistFetchError } = await supabase
          .from('checklists')
          .select('id')
          .eq('job_id', jobId);
        if (checklistFetchError && !isMissingTableError(checklistFetchError)) {
          console.error(
            'deleteJob checklist fetch failed:',
            checklistFetchError.message,
            checklistFetchError.code,
            { jobId }
          );
          return false;
        }
        const checklistIds = (checklistRows ?? [])
          .map((row) => row.id as string)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        if (checklistIds.length > 0) {
          const { error: historyDeleteError } = await supabase
            .from('checklist_history')
            .delete()
            .in('checklist_id', checklistIds);
          if (historyDeleteError && !isMissingTableError(historyDeleteError)) {
            console.error(
              'deleteJob checklist history cleanup failed:',
              historyDeleteError.message,
              historyDeleteError.code,
              { jobId }
            );
            return false;
          }
        }

        const { error: checklistDeleteError } = await supabase
          .from('checklists')
          .delete()
          .eq('job_id', jobId);
        if (checklistDeleteError && !isMissingTableError(checklistDeleteError)) {
          console.error(
            'deleteJob checklists cleanup failed:',
            checklistDeleteError.message,
            checklistDeleteError.code,
            { jobId }
          );
          return false;
        }
      }

      // Delete time-tracking rows linked to this job.
      {
        const { data: shiftRows, error: shiftsFetchError } = await supabase
          .from('shifts')
          .select('id')
          .eq('job_id', jobId);
        if (shiftsFetchError && !isMissingTableError(shiftsFetchError)) {
          console.error(
            'deleteJob shifts fetch failed:',
            shiftsFetchError.message,
            shiftsFetchError.code,
            {
              jobId,
            }
          );
          return false;
        }
        const shiftIds = (shiftRows ?? [])
          .map((row) => row.id as string)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        if (shiftIds.length > 0) {
          const { error: shiftEditsDeleteError } = await supabase
            .from('shift_edits')
            .delete()
            .in('shift_id', shiftIds);
          if (shiftEditsDeleteError && !isMissingTableError(shiftEditsDeleteError)) {
            console.error(
              'deleteJob shift edits cleanup failed:',
              shiftEditsDeleteError.message,
              shiftEditsDeleteError.code,
              { jobId }
            );
            return false;
          }
        }

        const { error: shiftsDeleteError } = await supabase
          .from('shifts')
          .delete()
          .eq('job_id', jobId);
        if (shiftsDeleteError && !isMissingTableError(shiftsDeleteError)) {
          console.error(
            'deleteJob shifts cleanup failed:',
            shiftsDeleteError.message,
            shiftsDeleteError.code,
            {
              jobId,
            }
          );
          return false;
        }
      }

      // Delete material allocations tied to this job.
      {
        const { error } = await supabase.from('job_inventory').delete().eq('job_id', jobId);
        if (error && !isMissingTableError(error)) {
          console.error('deleteJob job_inventory cleanup failed:', error.message, error.code, {
            jobId,
          });
          return false;
        }
      }

      // Delete inventory history entries that reference this job.
      {
        const { error } = await supabase
          .from('inventory_history')
          .delete()
          .eq('related_job_id', jobId);
        if (error && !isMissingTableError(error)) {
          console.error('deleteJob inventory_history cleanup failed:', error.message, error.code, {
            jobId,
          });
          return false;
        }
      }

      const { error } = await supabase.from('jobs').delete().eq('id', jobId);
      if (error) {
        console.error('deleteJob jobs delete failed:', error.message, error.code, { jobId });
        return false;
      }
      return true;
    } catch (error) {
      console.error('deleteJob unexpected error:', error);
      return false;
    }
  },

  async addComment(jobId: string, text: string, userId: string): Promise<Comment | null> {
    const { data: row, error } = await supabase
      .from('comments')
      .insert({ job_id: jobId, user_id: userId, text })
      .select('id, job_id, user_id, text, created_at')
      .single();
    if (error) return null;
    const profiles = await supabase
      .from('profiles')
      .select('id, name, initials')
      .eq('id', userId)
      .maybeSingle();
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

  async addJobInventory(
    jobId: string,
    inventoryId: string,
    quantity: number,
    unit: string
  ): Promise<boolean> {
    const { error } = await supabase.from('job_inventory').insert({
      job_id: jobId,
      inventory_id: inventoryId,
      quantity,
      unit: unit || 'units',
    });
    return !error;
  },

  async updateJobInventory(
    jobInventoryId: string,
    quantity: number,
    unit: string
  ): Promise<boolean> {
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
    const result = await uploadAttachment(jobId, undefined, undefined, file, isAdminOnly);
    const id = result.id;
    return id != null;
  },

  async deleteAttachment(attachmentId: string): Promise<boolean> {
    return deleteAttachmentRecord(attachmentId);
  },

  async updateAttachmentAdminOnly(attachmentId: string, isAdminOnly: boolean): Promise<boolean> {
    const { data, error } = await supabase
      .from('attachments')
      .update({ is_admin_only: isAdminOnly })
      .eq('id', attachmentId)
      .select('id, is_admin_only')
      .maybeSingle();
    if (error) return false;
    // RLS-denied or missing row can return no error + no row updated.
    if (!data) return false;
    return data.is_admin_only === isAdminOnly;
  },
};
