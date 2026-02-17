import type { Job, Shift, InventoryItem } from '../../core/types';
import { supabase } from './supabaseClient';

type JobCallback = (action: string, record: Job) => void;
type ShiftCallback = (action: string, record: Shift) => void;
type InventoryCallback = (action: string, record: InventoryItem) => void;

/**
 * Realtime subscriptions using Supabase Realtime.
 * Maps Postgres change events to (action, record) callbacks.
 */
function mapJobRow(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    jobCode: row.job_code as number,
    po: row.po as string | undefined,
    name: (row.name as string) ?? '',
    qty: row.qty as string | undefined,
    description: row.description as string | undefined,
    ecd: row.ecd as string | undefined,
    dueDate: row.due_date as string | undefined,
    active: (row.active as boolean) ?? true,
    status: row.status as Job['status'],
    boardType: row.board_type as Job['boardType'],
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
  };
}

function mapShiftRow(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    user: row.user_id as string,
    job: row.job_id as string,
    clockInTime: row.clock_in_time as string,
    clockOutTime: row.clock_out_time as string | undefined,
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
        const action = payload.eventType === 'INSERT' ? 'create' : payload.eventType === 'UPDATE' ? 'update' : 'delete';
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(action, mapJobRow(record));
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
        const action = payload.eventType === 'INSERT' ? 'create' : payload.eventType === 'UPDATE' ? 'update' : 'delete';
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
        const action = payload.eventType === 'INSERT' ? 'create' : payload.eventType === 'UPDATE' ? 'update' : 'delete';
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
