// Replay handlers for the generalized offline queue. Each handler owns how its action
// is re-applied AND reconciled against current server state on reconnect — never a blind
// replay (see the hazards in syncOfflineClockQueue.ts). A handler returns:
//   'done'     — applied (or already present); clear from the queue.
//   'conflict' — superseded / no-op against current state; clear from the queue.
// or THROWS to signal a transient failure so the sync loop bumps the attempt and retries.

import type { QueuedAction } from '@/lib/offlineActionQueue';
import { isConsumedStatus } from '@/lib/inventoryCalculations';
import { supabase } from '@/services/api/supabaseClient';
import { jobService } from '@/services/api/jobs';
import { inventoryService } from '@/services/api/inventory';
import { inventoryHistoryService } from '@/services/api/inventoryHistory';
import { boardService } from '@/services/api/boards';
import { deliveryService } from '@/services/api/deliveries';

export type ReplayResult = 'done' | 'conflict';

/** Lightweight existence check used to make create-replays idempotent. */
async function rowExists(table: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw error; // network/DB error → let the loop retry
  return data !== null;
}

export async function replayAction(action: QueuedAction): Promise<ReplayResult> {
  switch (action.type) {
    // ── Jobs ──────────────────────────────────────────────────────────────────
    case 'job_create': {
      // Idempotent via client-supplied PK: if the row already exists (lost ACK or a
      // prior replay), the create is satisfied.
      if (await rowExists('jobs', action.entityId)) return 'conflict';
      const job = await jobService.createJob({ ...action.data, id: action.entityId });
      if (!job) throw new Error('job_create returned null');
      return 'done';
    }
    case 'job_update': {
      // Last-write-wins. A missing row (deleted meanwhile) is a benign no-op.
      if (!(await rowExists('jobs', action.entityId))) return 'conflict';
      const job = await jobService.updateJob(action.entityId, action.data);
      if (!job) throw new Error('job_update returned null');
      return 'done';
    }
    case 'job_delete': {
      if (!(await rowExists('jobs', action.entityId))) return 'conflict'; // already gone
      const ok = await jobService.deleteJob(action.entityId);
      if (!ok) throw new Error('job_delete failed');
      return 'done';
    }
    case 'job_status': {
      // Phantom-restore guard (mirrors useClockMutations): re-read live status and only
      // transition from the exact status we expected. A stale queued change replayed
      // after the job already moved on becomes a 0-row no-op, so the inventory-reconcile
      // trigger never double-deducts or phantom-restores stock.
      const liveStatus = await jobService.getJobStatus(action.entityId);
      if (liveStatus === null) return 'conflict'; // row gone
      if (liveStatus === action.status) return 'conflict'; // already at target
      if (isConsumedStatus(liveStatus)) return 'conflict'; // finished/paid — do not move it
      // CAS on the status the worker actually saw when they made the change (fromStatus),
      // not on the just-read liveStatus. If another session moved the job since, the live
      // status no longer matches fromStatus → 0 rows → we treat it as superseded rather
      // than forcing the target transition from an unexpected state.
      const moved = await jobService.updateJobStatusConditional(
        action.entityId,
        action.status,
        action.fromStatus
      );
      // 0 rows = status changed under us between offline capture and replay → superseded.
      return moved ? 'done' : 'conflict';
    }
    case 'comment_add': {
      if (await rowExists('comments', action.entityId)) return 'conflict';
      const comment = await jobService.addComment(
        action.jobId,
        action.text,
        action.userId,
        action.entityId
      );
      if (!comment) throw new Error('comment_add returned null');
      return 'done';
    }

    // ── Inventory ─────────────────────────────────────────────────────────────
    case 'inventory_create': {
      if (await rowExists('inventory', action.entityId)) return 'conflict';
      const item = await inventoryService.createInventory({ ...action.data, id: action.entityId });
      if (!item) throw new Error('inventory_create returned null');
      return 'done';
    }
    case 'inventory_update': {
      if (!(await rowExists('inventory', action.entityId))) return 'conflict';
      const item = await inventoryService.updateInventory(action.entityId, action.data);
      if (!item) throw new Error('inventory_update returned null');
      return 'done';
    }
    case 'inventory_delta': {
      // Give up (don't retry forever) if the item was deleted between enqueue and replay:
      // the RPC's UPDATE would match 0 rows and return nothing, which we'd otherwise treat
      // as a transient failure and retry to the cap.
      if (!(await rowExists('inventory', action.entityId))) return 'conflict';
      // Idempotent via the dedup ledger keyed on clientActionId (shared with the
      // original online write). `applied: false` means the delta already landed.
      const res = await inventoryService.adjustStockIdempotent(
        action.entityId,
        action.inStockDelta,
        action.onOrderDelta,
        action.clientActionId
      );
      if (!res) throw new Error('adjust_inventory_stock_idem failed');
      if (res.applied) {
        const prevInStock = res.inStock - action.inStockDelta; // authoritative previous
        await inventoryHistoryService.createHistory({
          inventory: action.entityId,
          user: action.userId,
          action: action.history.action,
          reason: action.history.reason,
          previousInStock: prevInStock,
          newInStock: res.inStock,
          changeAmount: action.inStockDelta,
        });
      }
      return 'done';
    }

    // ── Deliveries ────────────────────────────────────────────────────────────
    case 'delivery_create': {
      if (await rowExists('deliveries', action.entityId)) return 'conflict';
      const delivery = await deliveryService.create({
        id: action.entityId,
        jobId: action.jobId,
        deliveredAt: action.data.deliveredAt,
        carrier: action.data.carrier,
        trackingNumber: action.data.trackingNumber,
        recipientName: action.data.recipientName,
        notes: action.data.notes,
        lineItems: action.data.lineItems as never,
        createdBy: action.userId,
      });
      if (!delivery) throw new Error('delivery_create returned null');
      return 'done';
    }
    case 'delivery_update': {
      if (!(await rowExists('deliveries', action.entityId))) return 'conflict';
      const delivery = await deliveryService.update(action.entityId, action.data as never);
      if (!delivery) throw new Error('delivery_update returned null');
      return 'done';
    }
    case 'delivery_delete': {
      if (!(await rowExists('deliveries', action.entityId))) return 'conflict';
      const ok = await deliveryService.delete(action.entityId);
      if (!ok) throw new Error('delivery_delete failed');
      return 'done';
    }

    // ── Board cards (absolute-target, naturally idempotent) ─────────────────────
    case 'card_move': {
      if (!(await rowExists('board_cards', action.entityId))) return 'conflict';
      const card = await boardService.moveCard(action.entityId, {
        columnId: action.columnId,
        sortOrder: action.sortOrder,
      });
      if (!card) throw new Error('card_move returned null');
      return 'done';
    }
    case 'card_reorder': {
      const ok = await boardService.reorderCards(action.boardId, action.columnId, action.cardIds);
      if (!ok) throw new Error('card_reorder failed');
      return 'done';
    }
    case 'card_update': {
      if (!(await rowExists('board_cards', action.entityId))) return 'conflict';
      const card = await boardService.updateCard(action.entityId, action.data as never);
      if (!card) throw new Error('card_update returned null');
      return 'done';
    }
  }
}
