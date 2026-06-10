/**
 * QBO sync — COMPLETENESS pass + the gated RECONCILE step.
 *
 * Completeness: the eight QBO transaction types we don't model as documents each
 * post one faithful balanced JE (source_type='qbo', deterministic source_id =
 * UUIDv5 of "qbo:<Type>:<Id>") through the same balance-guarded
 * journalService.createAndPost path. Idempotent: a source_id that already exists
 * is skipped, so re-runs/top-ups never double-post.
 *
 * Reconcile (GATED — runs only after explicit user approval in the run UI): once
 * documents + completeness have re-posted the entire ledger from the API, the
 * legacy CSV GL import (source_type='import') is retired in one transaction via
 * accounting.void_legacy_import_entries. Without this step the books double-count;
 * the run UI surfaces that state until approved.
 */
import { journalService } from '../../../../services/api/accounting/journal';
import { acct } from '../../../../services/api/accounting/accountingClient';
import type { QboJson } from '../../../../services/api/accounting/qboSync';
import { uuidv5 } from '../../import/deterministicId';
import { resolversFor } from './syncDocPhases';
import type { MappedTxnJe } from './qboTxnMappers';
import {
  mapQboCreditMemo,
  mapQboDeposit,
  mapQboJournalEntry,
  mapQboPurchase,
  mapQboRefundReceipt,
  mapQboSalesReceipt,
  mapQboTransfer,
  mapQboVendorCredit,
} from './qboTxnMappers';
import {
  zeroCounts,
  type PageOutcome,
  type SyncContext,
  type SyncLogLine,
  type SyncPhase,
} from './syncShared';

/** Deterministic journal source_id for one QBO transaction. */
export function qboJeSourceKey(entity: string, qboId: string): string {
  return `qbo:${entity}:${qboId}`;
}

type TxnMapper = (json: QboJson, ctx: SyncContext) => MappedTxnJe;

/** Generic completeness phase: map each record to a JE and post it idempotently. */
function txnPhase(
  key: string,
  label: string,
  entity: NonNullable<SyncPhase['entity']>,
  mapFn: TxnMapper
): SyncPhase {
  return {
    key,
    label,
    entity,
    pageSize: 500,
    includeInactive: false,
    async process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome> {
      const counts = zeroCounts();
      const logs: SyncLogLine[] = [];

      for (const json of records) {
        const mapped = mapFn(json, ctx);
        if (mapped.problem) {
          counts.failed += 1;
          logs.push({
            entity,
            qboId: mapped.qboId || null,
            action: 'error',
            status: 'error',
            message: `${mapped.memo}: ${mapped.problem}`,
          });
          continue;
        }

        const sourceId = await uuidv5(qboJeSourceKey(entity, mapped.qboId));
        if (ctx.docs.qboJeSourceIds.has(sourceId)) {
          counts.skipped += 1;
          continue;
        }

        const posted = await journalService.createAndPost({
          entryDate: mapped.txnDate,
          memo: mapped.memo,
          sourceType: 'qbo',
          sourceId,
          lines: mapped.lines,
        });
        if (!posted.entryId) {
          counts.failed += 1;
          logs.push({
            entity,
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `${mapped.memo}: ${posted.error ?? 'post failed'}`,
          });
          continue;
        }

        ctx.docs.qboJeSourceIds.add(sourceId);
        counts.created += 1;
        logs.push({
          entity,
          qboId: mapped.qboId,
          action: 'post',
          message: mapped.memo,
          recordId: posted.entryId,
        });
      }

      return { counts, logs };
    },
  };
}

export const COMPLETENESS_PHASES: SyncPhase[] = [
  txnPhase('journalEntries', 'Journal entries', 'JournalEntry', (j, ctx) =>
    mapQboJournalEntry(j, resolversFor(ctx))
  ),
  txnPhase('deposits', 'Deposits', 'Deposit', (j, ctx) =>
    mapQboDeposit(j, resolversFor(ctx), ctx.defaults)
  ),
  txnPhase('transfers', 'Transfers', 'Transfer', (j, ctx) => mapQboTransfer(j, resolversFor(ctx))),
  txnPhase('creditMemos', 'Credit memos', 'CreditMemo', (j, ctx) =>
    mapQboCreditMemo(j, resolversFor(ctx), ctx.defaults)
  ),
  txnPhase('salesReceipts', 'Sales receipts', 'SalesReceipt', (j, ctx) =>
    mapQboSalesReceipt(j, resolversFor(ctx), ctx.defaults)
  ),
  txnPhase('refundReceipts', 'Refund receipts', 'RefundReceipt', (j, ctx) =>
    mapQboRefundReceipt(j, resolversFor(ctx), ctx.defaults)
  ),
  txnPhase('vendorCredits', 'Vendor credits', 'VendorCredit', (j, ctx) =>
    mapQboVendorCredit(j, resolversFor(ctx), ctx.defaults)
  ),
  txnPhase('purchases', 'Checks & card charges', 'Purchase', (j, ctx) =>
    mapQboPurchase(j, resolversFor(ctx), ctx.defaults)
  ),
];

// ── Gated reconcile (retire the legacy CSV GL) ───────────────────────────────

/** Posted legacy-import entries remaining (the gate card shows this dry-run count). */
export async function countLegacyImportEntries(): Promise<number> {
  const { count, error } = await acct()
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('source_type', 'import')
    .eq('status', 'posted');
  if (error) throw error;
  return count ?? 0;
}

export const reconcilePhase: SyncPhase = {
  key: 'reconcile',
  label: 'Retire legacy GL import',
  entity: null,
  local: true,
  gated: true,
  pageSize: 1,
  includeInactive: false,
  async process(_records: QboJson[], _ctx: SyncContext): Promise<PageOutcome> {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const { data, error } = await acct().rpc('void_legacy_import_entries', {
      p_reason: 'Superseded by QuickBooks document import',
    });
    if (error) {
      counts.failed += 1;
      logs.push({
        entity: 'Reconcile',
        action: 'error',
        status: 'error',
        message: error.message,
      });
      // Throwing marks the run failed (a half-reconciled ledger must not look done).
      throw new Error(error.message);
    }
    const voided = Number(data ?? 0);
    counts.updated = voided;
    logs.push({
      entity: 'Reconcile',
      action: 'void',
      message: `Voided ${voided} legacy import journal entries`,
    });
    return { counts, logs };
  },
};
