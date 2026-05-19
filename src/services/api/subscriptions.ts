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

// ── Broadcast ────────────────────────────────────────────────────────

export type EntityKey = 'jobs' | 'shifts' | 'inventory' | 'users' | 'parts' | 'boards' | 'deliveries';

const VALID_ENTITIES = new Set<EntityKey>([
  'jobs', 'shifts', 'inventory', 'users', 'parts', 'boards', 'deliveries',
]);

// Module-level ref — set when AppContext subscribes, cleared on unmount.
// Lets broadcastChange fire without threading a channel reference through the tree.
let _appChannel: ReturnType<typeof supabase.channel> | null = null;

const _lastBroadcast = new Map<EntityKey, number>();

export function broadcastChange(entity: EntityKey): void {
  const now = Date.now();
  if (now - (_lastBroadcast.get(entity) ?? 0) < 150) return;
  _lastBroadcast.set(entity, now);
  void _appChannel?.send({ type: 'broadcast', event: 'change', payload: { entity } });
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

// ── Subscriptions ────────────────────────────────────────────────────

export const subscriptions = {
  subscribeToJobs(callback: JobScalarCallback): () => void {
    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
        const record = pickRow(payload);
        if (record) callback(eventAction(payload.eventType), mapJobScalars(record));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          console.error(`[realtime:jobs-changes] ${status}`);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToShifts(callback: ShiftCallback): () => void {
    const channel = supabase
      .channel('shifts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, (payload) => {
        const record = pickRow(payload);
        if (record) callback(eventAction(payload.eventType), mapShiftRow(record));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          console.error(`[realtime:shifts-changes] ${status}`);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToInventory(callback: InventoryCallback): () => void {
    const channel = supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
        const record = pickRow(payload);
        if (record) callback(eventAction(payload.eventType), mapInventoryRow(record));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          console.error(`[realtime:inventory-changes] ${status}`);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToUsers(callback: UserCallback): () => void {
    const channel = supabase
      .channel('users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        const record = pickRow(payload);
        if (record) callback(eventAction(payload.eventType), mapUserRow(record));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          console.error(`[realtime:users-changes] ${status}`);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeToChanges(callback: (entity: EntityKey) => void): () => void {
    const ch = supabase
      .channel('app-changes')
      .on('broadcast', { event: 'change' }, ({ payload }) => {
        const e = payload?.entity;
        if (typeof e === 'string' && VALID_ENTITIES.has(e as EntityKey))
          callback(e as EntityKey);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          console.error(`[realtime:app-changes] ${status}`);
      });
    _appChannel = ch;
    return () => {
      if (_appChannel === ch) _appChannel = null;
      supabase.removeChannel(ch);
    };
  },

  /**
   * Consolidated channel for job-related tables: comments, attachments,
   * job_parts, job_inventory, checklists, deliveries.
   * The callback receives the table name, action, and raw row so the
   * consumer can extract foreign keys (job_id, etc.) and refresh caches.
   */
  subscribeToJobRelated(callback: RelatedTableCallback): () => void {
    const tables = [
      'comments',
      'attachments',
      'job_parts',
      'job_inventory',
      'checklists',
      'deliveries',
    ] as const;
    let channel = supabase.channel('job-related-changes');
    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          // TODO(realtime-delete): DELETE payloads carry only the PK via payload.old —
          // job_id is absent without REPLICA IDENTITY FULL, so deletes are silently
          // dropped by the consumer (job_id guard). Fix requires schema change.
          const record = pickRow(payload);
          if (record) callback(table, eventAction(payload.eventType), record);
        }
      );
    }
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        console.error(`[realtime:job-related-changes] ${status}`);
    });
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
          // TODO(realtime-delete): DELETE payloads carry only the PK via payload.old —
          // board_id is absent without REPLICA IDENTITY FULL, so deletes are silently
          // dropped by the consumer (board_id guard). Fix requires schema change.
          const record = pickRow(payload);
          if (record) callback(table, eventAction(payload.eventType), record);
        }
      );
    }
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        console.error(`[realtime:board-changes] ${status}`);
    });
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
        // DELETE events use payload.new ?? payload.old — safe here because the callback
        // only triggers a full refresh (no id-based filtering on delete).
        const record = (payload.new ?? payload.old) as Record<string, unknown>;
        if (record) callback('parts', eventAction(payload.eventType), record);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          console.error(`[realtime:parts-changes] ${status}`);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  },

  // ── Chat subscriptions ─────────────────────────────

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
