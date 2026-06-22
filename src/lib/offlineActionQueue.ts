// Generalized offline write queue. Mirrors the clock-punch queue (offlineQueue.ts)
// but models every Tier-1 mutation as a typed "action" with a per-type replay handler
// (see offlineActionHandlers.ts). Persisted to localStorage under its own key so it is
// fully independent of the clock queue; both are drained by the same triggers in
// AppContext and surfaced by the same indicator/banner UI.

import type { Job, JobStatus, InventoryItem, InventoryHistoryAction } from '@/core/types';

/** localStorage key for the queue. Exported so the cross-tab `storage` listener can match it. */
export const ACTION_QUEUE_KEY = 'wtp_offline_action_queue';
const QUEUE_KEY = ACTION_QUEUE_KEY;

/**
 * Same-tab change notification. The browser's native `storage` event only fires in OTHER
 * tabs, so this custom event lets the current tab's UI (indicator/badges) react to its own
 * enqueues/clears without threading a callback through every mutation hook.
 */
export const ACTION_QUEUE_EVENT = 'wtp-offline-action-changed';

/** Stop retrying after this many failed attempts per action (leaves item queued for visibility). */
export const MAX_ACTION_SYNC_ATTEMPTS = 25;

// ── Action payloads (discriminated union over `type`) ────────────────────────────
// `entityId` is the id of the row the action targets (used for the per-entity "pending"
// badge). For creates it is the client-generated PK UUID, which the originating service
// also persists so the optimistic cache entry and the eventual server row share an id.

interface BaseAction {
  /** Unique id for this queue entry (not the target row). */
  id: string;
  /** The targeted row's id, for the pending-badge derivation. */
  entityId: string;
  userId: string;
  createdAt: string;
  attemptCount?: number;
  lastAttemptAt?: string;
}

export interface JobCreateAction extends BaseAction {
  type: 'job_create';
  data: Partial<Job>;
}
export interface JobUpdateAction extends BaseAction {
  type: 'job_update';
  data: Partial<Job>;
}
export interface JobDeleteAction extends BaseAction {
  type: 'job_delete';
}
export interface JobStatusAction extends BaseAction {
  type: 'job_status';
  status: JobStatus;
  /** Status the client believed the job was in when the change was made (for CAS). */
  fromStatus: JobStatus;
}
export interface CommentAddAction extends BaseAction {
  type: 'comment_add';
  jobId: string;
  text: string;
}

export interface InventoryCreateAction extends BaseAction {
  type: 'inventory_create';
  data: Partial<InventoryItem>;
}
export interface InventoryUpdateAction extends BaseAction {
  type: 'inventory_update';
  data: Partial<InventoryItem>;
}
export interface InventoryDeltaAction extends BaseAction {
  type: 'inventory_delta';
  inStockDelta: number;
  onOrderDelta: number;
  /** Stable id passed to the idempotent RPC; shared with the original online write. */
  clientActionId: string;
  history: {
    action: InventoryHistoryAction;
    reason: string;
  };
}

export interface DeliveryCreateAction extends BaseAction {
  type: 'delivery_create';
  jobId: string;
  data: {
    deliveredAt: string;
    carrier?: string;
    trackingNumber?: string;
    recipientName?: string;
    notes?: string;
    lineItems: unknown[];
  };
}
export interface DeliveryUpdateAction extends BaseAction {
  type: 'delivery_update';
  jobId: string;
  data: Record<string, unknown>;
}
export interface DeliveryDeleteAction extends BaseAction {
  type: 'delivery_delete';
  jobId: string;
}

export interface CardMoveAction extends BaseAction {
  type: 'card_move';
  boardId: string;
  columnId: string;
  sortOrder: number;
}
export interface CardReorderAction extends BaseAction {
  type: 'card_reorder';
  boardId: string;
  columnId: string;
  cardIds: string[];
}
export interface CardUpdateAction extends BaseAction {
  type: 'card_update';
  boardId: string;
  data: Record<string, unknown>;
}

export type QueuedAction =
  | JobCreateAction
  | JobUpdateAction
  | JobDeleteAction
  | JobStatusAction
  | CommentAddAction
  | InventoryCreateAction
  | InventoryUpdateAction
  | InventoryDeltaAction
  | DeliveryCreateAction
  | DeliveryUpdateAction
  | DeliveryDeleteAction
  | CardMoveAction
  | CardReorderAction
  | CardUpdateAction;

// Distributive Omit so each union member keeps its own type-specific fields (a plain
// Omit<QueuedAction, K> collapses to only the shared properties).
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** Shape accepted by enqueueAction — a full action minus the queue-managed bookkeeping. */
export type EnqueueActionInput = DistributiveOmit<QueuedAction, 'id' | 'attemptCount'>;

// ── Dedupe-on-enqueue ────────────────────────────────────────────────────────────
// Collapses repeated absolute-target writes to the same entity (e.g. dragging a card
// twice, editing a field twice) so the queue holds only the latest intent. Delta and
// create/delete actions are NEVER deduped — each represents a distinct effect.
function dedupeKey(action: QueuedAction): string | null {
  switch (action.type) {
    case 'job_update':
      return `job_update:${action.entityId}`;
    case 'job_status':
      return `job_status:${action.entityId}`;
    case 'inventory_update':
      return `inventory_update:${action.entityId}`;
    case 'card_move':
      return `card_move:${action.entityId}`;
    case 'card_update':
      return `card_update:${action.entityId}`;
    case 'card_reorder':
      return `card_reorder:${action.boardId}:${action.columnId}`;
    case 'delivery_update':
      return `delivery_update:${action.entityId}`;
    default:
      return null;
  }
}

function persistQueue(queue: QueuedAction[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    // Quota exceeded / storage disabled. Don't crash the mutation that triggered this —
    // the in-memory optimistic update still shows; the action simply isn't durable.
    console.error('Failed to persist offline action queue:', err);
    return;
  }
  // Notify this tab (the native `storage` event only reaches other tabs).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACTION_QUEUE_EVENT));
  }
}

export function getActionQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

/**
 * Enqueue an action. Generates the queue-entry id and resets attempt bookkeeping.
 * When the action's dedupeKey matches an existing queued action, that entry is
 * REPLACED in place (keeping its FIFO position) so the latest intent wins without
 * growing the queue.
 */
export function enqueueAction(action: EnqueueActionInput): QueuedAction {
  const queue = getActionQueue();
  const full = { ...action, id: crypto.randomUUID(), attemptCount: 0 } as QueuedAction;
  const key = dedupeKey(full);
  if (key) {
    const idx = queue.findIndex((q) => dedupeKey(q) === key);
    if (idx !== -1) {
      // Preserve the original entry id/position; swap in the fresh payload + reset attempts.
      full.id = queue[idx].id;
      queue[idx] = full;
      persistQueue(queue);
      return full;
    }
  }
  queue.push(full);
  persistQueue(queue);
  return full;
}

export function clearActionFromQueue(id: string): void {
  persistQueue(getActionQueue().filter((a) => a.id !== id));
}

export function bumpActionAttempt(id: string): void {
  const queue = getActionQueue();
  const idx = queue.findIndex((a) => a.id === id);
  if (idx === -1) return;
  queue[idx] = {
    ...queue[idx],
    attemptCount: (queue[idx].attemptCount ?? 0) + 1,
    lastAttemptAt: new Date().toISOString(),
  };
  persistQueue(queue);
}

export function getPendingActionCount(): number {
  return getActionQueue().length;
}

export function hasActionAtMaxAttempts(): boolean {
  return getActionQueue().some((a) => (a.attemptCount ?? 0) >= MAX_ACTION_SYNC_ATTEMPTS);
}

/** Set of entity ids with at least one queued action — drives the per-row "pending" badge. */
export function getPendingEntityIds(): Set<string> {
  return new Set(getActionQueue().map((a) => a.entityId));
}

// Known narrow limitation (documented, not guarded): if an entity is CREATED offline and
// then edited *online* during the ~1s window after reconnect but before the create replays,
// the online edit hits a not-yet-existing row and is dropped. Edits made while still offline
// are queued and replay in FIFO order after the create, so they are safe. A full fix would
// route any edit to an entity with a pending queued action back through the queue.
