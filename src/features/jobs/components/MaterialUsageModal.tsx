import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '@/core/types';
import { useToast } from '@/Toast';
import { logExtraMaterialUsage, type ExtraMaterialUsage } from '@/services/api/unitProgress';

export interface MaterialUsageModalProps {
  job: Job;
  /** Called after extras are logged (or there was nothing to confirm) — caller then moves to QC. */
  onComplete: () => void;
}

/** A BOM line whose inventory id is known (extras can only be applied to identifiable lines). */
interface BomLine {
  inventoryId: string;
  name: string;
  unit: string;
  estimate: number;
}

/**
 * In Progress -> Quality Control handoff gate. For each BOM material it shows the estimate and an
 * optional "used more?" field — ONE-DIRECTIONAL: you can only record using MORE than the estimate
 * (the BOM is intentionally over-padded, so the system already reads low; we never restore). Any
 * extras deduct from stock via `log_extra_material_usage`, then the status advances to QC.
 */
export function MaterialUsageModal({ job, onComplete }: MaterialUsageModalProps) {
  const lines = useMemo<BomLine[]>(() => {
    return (job.inventoryItems ?? [])
      .map((ji) => {
        const inventoryId =
          ji.inventoryId ?? (typeof ji.inventory === 'string' ? ji.inventory : '');
        return {
          inventoryId,
          name: ji.inventoryName || 'Material',
          unit: ji.unit?.trim() || 'units',
          estimate: Number(ji.quantity) || 0,
        };
      })
      .filter((l) => l.inventoryId);
  }, [job.inventoryItems]);

  const { showToast } = useToast();

  // Resolve the gate exactly once. Also drain it on unmount: the awaiting status-change promise (and
  // the single-slot re-entrancy guard in AppContext) would otherwise be stranded forever if this
  // modal ever unmounts without a normal completion — jamming every future QC prompt.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const completedRef = useRef(false);
  const complete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  };
  useEffect(() => () => complete(), []);

  // No identifiable BOM materials — nothing to confirm, let the move proceed. Frozen to the FIRST
  // render: a realtime job_inventory change must not auto-resolve the gate out from under the user
  // mid-prompt. Only an initially-empty BOM skips the popup.
  const initiallyEmptyRef = useRef(lines.length === 0);
  const nothingToConfirm = initiallyEmptyRef.current;
  useEffect(() => {
    if (nothingToConfirm) complete();
  }, [nothingToConfirm]);

  // Raw text per line so the field can be blank (= used the estimate) without showing a stray 0.
  const [extraText, setExtraText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Whole units only: in_stock is an integer ledger and the RPC ROUNDs to int, so a fractional
  // entry would silently deduct a different amount than typed. Round here so the UI and the
  // deduction always agree (0.4 -> 0 = "no extra"; 2.6 -> 3).
  const parseExtra = (raw: string | undefined): number => {
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : 0; // only MORE; blank / <= 0 contributes nothing
  };

  const anyExtra = lines.some((l) => parseExtra(extraText[l.inventoryId]) > 0);
  const partLabel = job.partNumber || `Job #${job.jobCode}`;

  const submit = async () => {
    setSaving(true);
    const extras: ExtraMaterialUsage[] = lines
      .map((l) => ({ inventoryId: l.inventoryId, extra: parseExtra(extraText[l.inventoryId]) }))
      .filter((e) => e.extra > 0);
    let ok = false;
    try {
      ok = await logExtraMaterialUsage(job.id, extras); // true (incl. the no-extras no-op) on success
    } catch {
      ok = false;
    }
    // Only advance to QC if the deduction actually landed. Swallowing a failure here would let the
    // job move with stock un-deducted — the exact hidden drift this gate exists to prevent.
    if (!ok) {
      setSaving(false);
      showToast('Could not record the extra usage — please try again.', 'error');
      return;
    }
    complete();
  };

  if (nothingToConfirm) return null;

  return (
    <div className="fixed inset-0 z-picker flex items-end justify-center bg-black/60 sm:items-center">
      <div className="w-full max-w-md rounded-t-lg border border-line bg-background-dark p-4 sm:rounded-lg">
        <h2 className="text-lg font-bold text-white">Used more than estimated?</h2>
        <p className="mb-3 text-xs text-muted">
          {partLabel} — if anything got scrapped or you used more than the estimate, add the extra
          here so stock stays accurate. Leave blank if it matched. You can only add — never less.
        </p>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {lines.map((l) => (
            <div
              key={l.inventoryId}
              className="flex items-center justify-between gap-2 rounded-lg bg-overlay/5 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-bold text-white">{l.name}</span>
                <span className="text-[11px] text-muted">
                  est. {l.estimate} {l.unit}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-sm font-bold text-muted">+</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  aria-label={`Extra ${l.unit} of ${l.name} used beyond the estimate of ${l.estimate}`}
                  value={extraText[l.inventoryId] ?? ''}
                  onChange={(e) => setExtraText((p) => ({ ...p, [l.inventoryId]: e.target.value }))}
                  className="h-10 w-20 rounded-lg border border-line bg-overlay/5 px-2 text-center text-base font-bold tabular-nums text-white"
                />
                <span className="whitespace-nowrap text-xs font-medium text-muted">{l.unit}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className={
              anyExtra
                ? 'flex-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50'
                : 'flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50'
            }
          >
            {saving
              ? 'Saving…'
              : anyExtra
                ? 'Deduct extra & move to QC'
                : 'Matched estimate — move to QC'}
          </button>
        </div>
      </div>
    </div>
  );
}
