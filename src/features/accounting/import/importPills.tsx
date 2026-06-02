/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Status chips for the FLAG-DARK import/migration
 *     screens. Pure presentation; no money posts here. Kept components-only (the pure
 *     formatters/labels live in importFormat.ts) so fast-refresh stays happy.
 */
import {
  IMPORT_BATCH_STATUS_LABELS,
  type ImportBatchStatus,
  type ImportStagingStatus,
} from '../types';

// ── Batch status pill ────────────────────────────────────────────────────────────

const BATCH_STATUS_STYLES: Record<ImportBatchStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  mapping: 'bg-sky-500/15 text-sky-400',
  ready: 'bg-amber-500/15 text-amber-300',
  committed: 'bg-green-500/15 text-green-400',
  failed: 'bg-red-500/15 text-red-400',
  discarded: 'bg-white/5 text-slate-500',
};

/** Status chip for an import batch's lifecycle. */
export function BatchStatusPill({ status }: { status: ImportBatchStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${BATCH_STATUS_STYLES[status]}`}
    >
      {IMPORT_BATCH_STATUS_LABELS[status]}
    </span>
  );
}

// ── Staging row status pill ────────────────────────────────────────────────────────

const STAGING_STATUS_STYLES: Record<ImportStagingStatus, string> = {
  pending: 'bg-white/10 text-slate-300',
  mapped: 'bg-sky-500/15 text-sky-400',
  skipped: 'bg-white/5 text-slate-500',
  committed: 'bg-green-500/15 text-green-400',
  error: 'bg-red-500/15 text-red-400',
};

const STAGING_STATUS_LABELS: Record<ImportStagingStatus, string> = {
  pending: 'Pending',
  mapped: 'Mapped',
  skipped: 'Skipped',
  committed: 'Committed',
  error: 'Error',
};

/** Status chip for a single staged source row. */
export function StagingStatusPill({ status }: { status: ImportStagingStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STAGING_STATUS_STYLES[status]}`}
    >
      {STAGING_STATUS_LABELS[status]}
    </span>
  );
}
