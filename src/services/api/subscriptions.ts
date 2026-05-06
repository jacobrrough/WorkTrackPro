import type { Job, Shift, InventoryItem } from '../../core/types';
import { supabase } from './supabaseClient';

/*
 * Realtime publication prerequisite — run this in the Supabase SQL editor
 * to enable change events on related tables (skips any that don't exist yet):
 *
 *   DO $$
 *   DECLARE t text;
 *   BEGIN
 *     FOR t IN SELECT unnest(ARRAY[
 *       'comments','attachments','job_parts','job_inventory',
 *       'checklists','deliveries',
 *       'boards','board_columns','board_cards',
 *       'parts'
 *     ]) LOOP
 *       IF EXISTS (SELECT 1 FROM pg_class
 *                  WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
 *         EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
 *       END IF;
 *     END LOOP;
 *   END $$;
 *
 * Without this, the new channels below connect silently but deliver zero events.
 */

// ── Scalar-only mappers (preserve relation arrays in cache) ──────────

type JobScalars = Omit<
  Job,
  'attachments' | 'attachmentCount' | 'comments' | 'commentCount' | 'inventoryItems' | 'parts' | 'checklists' | 'expand'
>;

function mapJobScalars(row: Record<string, unknown>): JobScalars & { id: string } {
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
    laborBreakdownByVariant: row.labor_breakdown_by_variant as Job['laborBreakdownByVariant'],
    machineBreakdownByVariant: row.machine_breakdown_by_variant as Job['machineBreakdownByVariant'],
    cncCompletedAt: row.cnc_completed_at as string | null | undefined,
    cncCompletedBy: row.cnc_completed_by as string | null | undefined,
    printer3DCompletedAt: row.printer_3d_completed_at as string | null | undefined,
    printer3DCompletedBy: row.printer_3d_completed_by as string | null | undefined,
    allocationSource: row.allocation_source as 'variant' | 'total' | undefined,
    allocationSourceUpdatedAt: row.allocation_source_updated_at as string | undefined,
    revision: row.revision as string | undefined,
    partId: row.part_id as string | undefined,
    partRev: row.part_rev as string | undefined,
    progressEstimatePercent: row.progress_estimate_percent as number | null | undefined,
    laborHours: row.labor_hours as number | undefined,
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

// ── Helper to extract event action ───────────────────────────────────

type RealtimeAction = 'create' | 'update' | 'delete';

function eventAction(eventType: string): RealtimeAction {
  if (eventType === 'INSERT') return 'create';
  if (eventType === 'UPDATE') return 'update';
  return 'delete';
}

// ── Types ────────────────────────────────────────────────────────────

type JobScalarCallback = (action: RealtimeAction, record: JobScalars & { id: string }) => void;
type ShiftCallback = (action: string, record: Shift) => void;
type InventoryCallback = (action: string, record: InventoryItem) => void;
type RelatedTableCallback = (table: string, action: RealtimeAction, record: Record<string, unknown>) => void;

// ── Subscriptions ────────────────────────────────────────────────────

export const subscriptions = {
  subscribeToJobs(callback: JobScalarCallback): () => void {
    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(eventAction(payload.eventType), mapJobScalars(record));
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
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(eventAction(payload.eventType), mapShiftRow(record));
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
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback(eventAction(payload.eventType), mapInventoryRow(record));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Consolidated channel for job-related tables: comments, attachments,
   * job_parts, job_inventory, checklists, deliveries.
   * The callback receives the table name, action, and raw row so the
   * consumer can extract foreign keys (job_id, etc.) and refresh caches.
   */
  subscribeToJobRelated(callback: RelatedTableCallback): () => void {
    const tables = ['comments', 'attachments', 'job_parts', 'job_inventory', 'checklists', 'deliveries'] as const;
    let channel = supabase.channel('job-related-changes');
    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          const record = (payload.new ?? payload.old) as Record<string, unknown>;
          if (record) callback(table, eventAction(payload.eventType), record);
        }
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Consolidated channel for board-related tables: boards, board_columns, board_cards.
   */
  subscribeToBoardRelated(callback: RelatedTableCallback): () => void {
    const tables = ['boards', 'board_columns', 'board_cards'] as const;
    let channel = supabase.channel('board-changes');
    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          const record = (payload.new ?? payload.old) as Record<string, unknown>;
          if (record) callback(table, eventAction(payload.eventType), record);
        }
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Channel for parts table changes.
   */
  subscribeToParts(callback: RelatedTableCallback): () => void {
    const channel = supabase
      .channel('parts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' }, (payload) => {
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback('parts', eventAction(payload.eventType), record);
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
