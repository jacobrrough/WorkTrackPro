import type { Job, Shift, InventoryItem } from '../../core/types';
import { supabase } from './supabaseClient';

/**
 * Scalar-only subset of Job — contains only columns present in the `jobs` Postgres
 * table.  Relational data (attachments, comments, inventoryItems, parts) is intentionally
 * omitted so that realtime updates can be *merged* into the cached Job without wiping
 * data that came from joined tables.
 */
export type JobScalars = Partial<Job> & { id: string };

type JobCallback = (action: string, record: JobScalars) => void;
type ShiftCallback = (action: string, record: Shift) => void;
type InventoryCallback = (action: string, record: InventoryItem) => void;

/**
 * Realtime subscriptions using Supabase Realtime.
 * Maps Postgres change events to (action, record) callbacks.
 *
 * Job payloads are mapped to JobScalars (no relational data) so the consumer
 * can safely merge them into existing cached objects.
 */
function mapJobScalars(row: Record<string, unknown>): JobScalars {
  return {
    id: row.id as string,
    jobCode: row.job_code as number,
    po: row.po as string | undefined,
    name: (row.name as string) ?? '',
    qty: row.qty as string | undefined,
    description: row.description as string | undefined,
    ecd: row.ecd as string | undefined,
    dueDate: row.due_date as string | undefined,
    plannedCompletionDate: (row.planned_completion_date as string | null | undefined) ?? null,
    laborHours: row.labor_hours as number | undefined,
    active: (row.active as boolean) ?? true,
    status: row.status as Job['status'],
    boardType: row.board_type as Job['boardType'],
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
    cncCompletedAt: (row.cnc_completed_at as string | null | undefined) ?? null,
    cncCompletedBy: (row.cnc_completed_by as string | null | undefined) ?? null,
    printer3DCompletedAt: (row.printer3d_completed_at as string | null | undefined) ?? null,
    printer3DCompletedBy: (row.printer3d_completed_by as string | null | undefined) ?? null,
    allocationSource: row.allocation_source as 'variant' | 'total' | undefined,
    allocationSourceUpdatedAt: row.allocation_source_updated_at as string | undefined,
    revision: row.revision as string | undefined,
    partId: row.part_id as string | undefined,
    partRev: row.part_rev as string | undefined,
    progressEstimatePercent:
      row.progress_estimate_percent != null
        ? Math.max(0, Math.min(100, Number(row.progress_estimate_percent)))
        : undefined,
    // NOTE: attachments, comments, inventoryItems, and parts are intentionally
    // omitted — they come from related tables and are not in the realtime payload.
  };
}

function mapShiftRow(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    user: row.user_id as string,
    job: row.job_id as string,
    clockInTime: row.clock_in_time as string,
    clockOutTime: row.clock_out_time as string | undefined,
    lunchStartTime: row.lunch_start_time as string | undefined,
    lunchEndTime: row.lunch_end_time as string | undefined,
    lunchMinutesUsed: row.lunch_minutes_used as number | undefined,
    notes: row.notes as string | undefined,
  };
}

function mapInventoryRow(row: Record<string, unknown>): InventoryItem {
  return {
    id: row.id as string,
    name: (row.name as string) ?? '',
    description: row.description as string | undefined,
    category: (row.category as InventoryItem['category']) ?? 'miscSupplies',
    inStock: (row.in_stock as number) ?? 0,
    available: (row.available as number) ?? 0,
    disposed: (row.disposed as number) ?? 0,
    onOrder: (row.on_order as number) ?? 0,
    reorderPoint: row.reorder_point as number | undefined,
    price: row.price as number | undefined,
    unit: (row.unit as string) ?? 'units',
    hasImage: (row.has_image as boolean) ?? false,
    barcode: row.barcode as string | undefined,
    binLocation: row.bin_location as string | undefined,
    vendor: row.vendor as string | undefined,
  };
}

export const subscriptions = {
  subscribeToJobs(callback: JobCallback): () => void {
    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
        const action =
          payload.eventType === 'INSERT'
            ? 'create'
            : payload.eventType === 'UPDATE'
              ? 'update'
              : 'delete';
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(action, mapJobScalars(record));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToShifts(callback: ShiftCallback): () => void {
    const channel = supabase
      .channel('shifts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, (payload) => {
        const action =
          payload.eventType === 'INSERT'
            ? 'create'
            : payload.eventType === 'UPDATE'
              ? 'update'
              : 'delete';
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(action, mapShiftRow(record));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToInventory(callback: InventoryCallback): () => void {
    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
        const action =
          payload.eventType === 'INSERT'
            ? 'create'
            : payload.eventType === 'UPDATE'
              ? 'update'
              : 'delete';
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(action, mapInventoryRow(record));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  unsubscribeAll(): void {
    supabase.removeAllChannels();
  },
};
