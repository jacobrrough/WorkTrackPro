import type {
  Job,
  Shift,
  InventoryItem,
  User,
  Message,
  MessageReceipt,
  ConversationMember,
  ConversationMemberRole,
  MessageType,
} from '../../core/types';
import { supabase } from './supabaseClient';

// Realtime publication for all subscribed tables is managed by
// migration 20260514000001_enable_realtime_core_tables.sql — no manual SQL required.

// ── Scalar-only mappers (preserve relation arrays in cache) ──────────

export type JobScalars = Omit<
  Job,
  | 'attachments'
  | 'attachmentCount'
  | 'comments'
  | 'commentCount'
  | 'inventoryItems'
  | 'parts'
  | 'checklists'
  | 'expand'
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

function mapUserRow(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: (row.email as string) ?? '',
    name: row.name as string | undefined,
    initials: row.initials as string | undefined,
    isAdmin: (row.is_admin as boolean) ?? false,
    isApproved: (row.is_approved as boolean) ?? false,
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

// ── Helpers ──────────────────────────────────────────────────────────

type RealtimeAction = 'create' | 'update' | 'delete';

function eventAction(eventType: string): RealtimeAction {
  if (eventType === 'INSERT') return 'create';
  if (eventType === 'UPDATE') return 'update';
  return 'delete';
}

// For DELETE events payload.new is {} (truthy) so ?? never falls back.
// Use payload.old which carries at least the PK under default REPLICA IDENTITY.
// With default REPLICA IDENTITY, DELETE payloads only carry the PK in old —
// other fields are absent. Callers must not read non-id fields on delete.
function pickRow(payload: {
  eventType: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  return payload.eventType === 'DELETE' ? payload.old : payload.new;
}

// ── Types ────────────────────────────────────────────────────────────

type JobScalarCallback = (action: RealtimeAction, record: JobScalars & { id: string }) => void;
type ShiftCallback = (action: string, record: Shift) => void;
type InventoryCallback = (action: string, record: InventoryItem) => void;
type UserCallback = (action: RealtimeAction, record: User) => void;
type RelatedTableCallback = (
  table: string,
  action: RealtimeAction,
  record: Record<string, unknown>
) => void;

// ── Consolidated core subscription ──────────────────────────────────
// All 14 tables on a single Supabase Realtime channel to avoid connection
// pressure that caused TIMED_OUT errors with 7+ separate channels.

export interface CoreRealtimeCallbacks {
  onJob: JobScalarCallback;
  onShift: ShiftCallback;
  onInventory: InventoryCallback;
  onUser: UserCallback;
  onJobRelated: RelatedTableCallback;
  onBoardRelated: RelatedTableCallback;
  onParts: RelatedTableCallback;
}

const JOB_RELATED_TABLES = [
  'comments',
  'attachments',
  'job_parts',
  'job_inventory',
  'checklists',
  'deliveries',
] as const;

const BOARD_TABLES = ['boards', 'board_columns', 'board_cards'] as const;

function buildCoreChannel(callbacks: CoreRealtimeCallbacks) {
  let channel = supabase.channel('realtime-core');

  // ── Core entity tables ──────────────────────────────────────────
  channel = channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
      const record = pickRow(payload);
      if (record) callbacks.onJob(eventAction(payload.eventType), mapJobScalars(record));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, (payload) => {
      const record = pickRow(payload);
      if (record) callbacks.onShift(eventAction(payload.eventType), mapShiftRow(record));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
      const record = pickRow(payload);
      if (record) callbacks.onInventory(eventAction(payload.eventType), mapInventoryRow(record));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
      const record = pickRow(payload);
      if (record) callbacks.onUser(eventAction(payload.eventType), mapUserRow(record));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' }, (payload) => {
      const record = (payload.new ?? payload.old) as Record<string, unknown>;
      if (record) callbacks.onParts('parts', eventAction(payload.eventType), record);
    });

  // ── Job-related tables ──────────────────────────────────────────
  for (const table of JOB_RELATED_TABLES) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const record = pickRow(payload);
      if (record) callbacks.onJobRelated(table, eventAction(payload.eventType), record);
    });
  }

  // ── Board-related tables ────────────────────────────────────────
  for (const table of BOARD_TABLES) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const record = pickRow(payload);
      if (record) callbacks.onBoardRelated(table, eventAction(payload.eventType), record);
    });
  }

  return channel;
}

// ── Subscriptions ────────────────────────────────────────────────────

export const subscriptions = {
  /**
   * Single consolidated channel for all core application tables.
   * Auto-reconnects on TIMED_OUT / CHANNEL_ERROR with exponential backoff.
   */
  subscribeToCoreChanges(callbacks: CoreRealtimeCallbacks): () => void {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    function connect() {
      if (disposed) return;
      channel = buildCoreChannel(callbacks);
      channel.subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          attempt = 0; // reset backoff on success
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[realtime:core] ${status} — reconnecting (attempt ${attempt + 1})`);
          teardown();
          const delay = Math.min(1000 * 2 ** attempt, 30_000);
          attempt++;
          reconnectTimer = setTimeout(connect, delay);
        }
      });
    }

    function teardown() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    }

    connect();

    return () => {
      disposed = true;
      teardown();
    };
  },

  // ── Chat subscriptions (per-conversation, opened/closed dynamically) ─

  subscribeToChatMessages(
    conversationId: string,
    callback: (action: string, record: Message) => void
  ): () => void {
    const channel = supabase
      .channel(`chat-messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const action =
            payload.eventType === 'INSERT'
              ? 'create'
              : payload.eventType === 'UPDATE'
                ? 'update'
                : 'delete';
          const record = (payload.new ?? payload.old) as Record<string, unknown>;
          if (record) {
            const msg: Message = {
              id: record.id as string,
              conversationId: record.conversation_id as string,
              senderId: record.sender_id as string,
              encryptedContent: record.encrypted_content as string,
              contentIv: record.content_iv as string,
              messageType: ((record.message_type as string) ?? 'text') as MessageType,
              createdAt: record.created_at as string,
              updatedAt: record.updated_at as string,
              deletedAt: (record.deleted_at as string) ?? undefined,
            };
            callback(action, msg);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToChatReceipts(
    conversationId: string,
    callback: (action: string, record: MessageReceipt) => void
  ): () => void {
    const channel = supabase
      .channel(`chat-receipts:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts' },
        (payload) => {
          const record = (payload.new ?? payload.old) as Record<string, unknown>;
          if (record) {
            const receipt: MessageReceipt = {
              id: record.id as string,
              messageId: record.message_id as string,
              userId: record.user_id as string,
              deliveredAt: (record.delivered_at as string) ?? undefined,
              readAt: (record.read_at as string) ?? undefined,
            };
            const action = payload.eventType === 'INSERT' ? 'create' : 'update';
            callback(action, receipt);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToChatMembers(
    conversationId: string,
    callback: (action: string, record: ConversationMember) => void
  ): () => void {
    const channel = supabase
      .channel(`chat-members:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const action =
            payload.eventType === 'INSERT'
              ? 'create'
              : payload.eventType === 'UPDATE'
                ? 'update'
                : 'delete';
          const record = (payload.new ?? payload.old) as Record<string, unknown>;
          if (record) {
            const member: ConversationMember = {
              id: record.id as string,
              conversationId: record.conversation_id as string,
              userId: record.user_id as string,
              encryptedConversationKey: (record.encrypted_conversation_key as string) ?? undefined,
              keyIv: (record.key_iv as string) ?? undefined,
              role: ((record.role as string) ?? 'member') as ConversationMemberRole,
              joinedAt: record.joined_at as string,
              leftAt: (record.left_at as string) ?? undefined,
            };
            callback(action, member);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToConversationUpdates(callback: (conversationId: string) => void): () => void {
    const channel = supabase
      .channel('chat-conversation-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => {
          const record = payload.new as Record<string, unknown>;
          if (record?.id) callback(record.id as string);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToSystemNotifications(
    userId: string,
    callback: (action: string, record: Record<string, unknown>) => void
  ): () => void {
    const channel = supabase
      .channel(`system-notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'system_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const record = payload.new as Record<string, unknown>;
          if (record) callback('create', record);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  },

  unsubscribeAll(): void {
    supabase.removeAllChannels();
  },
};
