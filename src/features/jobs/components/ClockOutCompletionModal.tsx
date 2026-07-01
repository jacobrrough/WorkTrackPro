import { useEffect, useMemo, useState } from 'react';
import type { Job, Part, InventoryItem } from '@/core/types';
import {
  buildDistributedBom,
  unitCountsByVariant,
  cncableVariantKeys,
  NO_VARIANT_KEY,
} from '@/lib/cncDeduction';
import { logUnitProgress, type VariantProgressEdit } from '@/services/api/unitProgress';

export interface ClockOutCompletionModalProps {
  job: Job;
  part: Part | null;
  inventory: InventoryItem[];
  cncAbleCategories: ReadonlySet<string>;
  /** Called after progress is logged (or skipped) — caller then completes the clock punch. */
  onComplete: () => void;
}

const labelFor = (key: string): string => (key === NO_VARIANT_KEY ? 'Units' : `-${key}`);

type Step = 'cnc' | 'units' | 'confirmCnc';

/** Inline +/- row for entering how many NEW units were finished this session (0..max). */
function DeltaRow({
  label,
  value,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
      <div className="min-w-0">
        <span className="font-mono text-sm font-bold text-white">{label}</span>
        <span className="ml-2 text-[11px] text-muted">
          {max} left{unit ? ` · ${unit}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
          className="flex size-10 items-center justify-center rounded-lg border border-line text-white disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-lg">remove</span>
        </button>
        <span className="min-w-[2rem] text-center text-base font-bold tabular-nums text-white">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex size-10 items-center justify-center rounded-lg border border-primary/40 bg-primary/15 text-primary disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-lg">add</span>
        </button>
      </div>
    </div>
  );
}

export function ClockOutCompletionModal({
  job,
  part,
  inventory,
  cncAbleCategories,
  onComplete,
}: ClockOutCompletionModalProps) {
  const { cncKeys, allKeys, remCnc, remUnit } = useMemo(() => {
    const inventoryById = new Map(inventory.map((i) => [i.id, i]));
    const bom = buildDistributedBom({ job, part, inventoryById, cncAbleCategories });
    const counts = unitCountsByVariant(job);
    const cncKeys = cncableVariantKeys(bom);
    const allKeys = Object.keys(counts);
    const remCnc: Record<string, number> = {};
    const remUnit: Record<string, number> = {};
    for (const k of allKeys) {
      remCnc[k] = Math.max(0, (counts[k] ?? 0) - (Number(job.cncDoneByVariant?.[k]) || 0));
      remUnit[k] = Math.max(0, (counts[k] ?? 0) - (Number(job.unitsDoneByVariant?.[k]) || 0));
    }
    return { cncKeys, allKeys, remCnc, remUnit };
  }, [job, part, inventory, cncAbleCategories]);

  const hasCnc = cncKeys.some((k) => remCnc[k] > 0);
  const nothingToLog =
    allKeys.every((k) => (remUnit[k] ?? 0) === 0) && cncKeys.every((k) => (remCnc[k] ?? 0) === 0);
  const [step, setStep] = useState<Step>(hasCnc ? 'cnc' : 'units');

  // Nothing left to finish on this job — don't show an empty popup; let the punch proceed.
  useEffect(() => {
    if (nothingToLog) onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nothingToLog]);
  const [cncDelta, setCncDelta] = useState<Record<string, number>>({});
  const [unitDelta, setUnitDelta] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Variants where unit-done would outrun CNC-done -> need the "is CNC also done?" question.
  // Only CNC-hour variants have a CNC milestone, so non-CNC variants never prompt (mirrors
  // JobDetail.handleUnitAdjust, which gates the same confirm on cncAbleKeys).
  const catchUp = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of cncKeys) {
      const projCnc = (Number(job.cncDoneByVariant?.[k]) || 0) + (cncDelta[k] ?? 0);
      const projUnit = (Number(job.unitsDoneByVariant?.[k]) || 0) + (unitDelta[k] ?? 0);
      const gap = projUnit - projCnc;
      if (gap > 0) out[k] = gap;
    }
    return out;
  }, [cncKeys, cncDelta, unitDelta, job.cncDoneByVariant, job.unitsDoneByVariant]);

  const submit = async (alsoCnc: boolean) => {
    setSaving(true);
    try {
      const edits: VariantProgressEdit[] = allKeys
        .map((k) => {
          const extraCnc = alsoCnc ? (catchUp[k] ?? 0) : 0;
          return {
            variantKey: k,
            cncDelta: (cncDelta[k] ?? 0) + extraCnc,
            unitDelta: unitDelta[k] ?? 0,
          };
        })
        .filter((e) => e.cncDelta !== 0 || e.unitDelta !== 0);
      if (edits.length > 0) {
        await logUnitProgress({ job, part, inventory, cncAbleCategories, edits });
      }
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  const onUnitsDone = () => {
    if (Object.keys(catchUp).length > 0) setStep('confirmCnc');
    else void submit(false);
  };

  const partLabel = job.partNumber || `Job #${job.jobCode}`;

  if (nothingToLog) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 sm:items-center">
      <div className="w-full max-w-md rounded-t-lg border border-line bg-background-dark p-4 sm:rounded-lg">
        {step === 'cnc' && (
          <>
            <h2 className="text-lg font-bold text-white">Any CNC finished?</h2>
            <p className="mb-3 text-xs text-muted">
              {partLabel} — how many of each variant did you finish CNC on?
            </p>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {cncKeys
                .filter((k) => remCnc[k] > 0)
                .map((k) => (
                  <DeltaRow
                    key={k}
                    label={labelFor(k)}
                    value={cncDelta[k] ?? 0}
                    max={remCnc[k]}
                    onChange={(v) => setCncDelta((p) => ({ ...p, [k]: v }))}
                  />
                ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setStep('units')}
                className="flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-bold text-white"
              >
                {Object.values(cncDelta).some((v) => v > 0) ? 'Next' : 'None — next'}
              </button>
            </div>
          </>
        )}

        {step === 'units' && (
          <>
            <h2 className="text-lg font-bold text-white">Any units fully done?</h2>
            <p className="mb-3 text-xs text-muted">
              {partLabel} — how many units are completely finished?
            </p>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {allKeys
                .filter((k) => remUnit[k] > 0)
                .map((k) => (
                  <DeltaRow
                    key={k}
                    label={labelFor(k)}
                    value={unitDelta[k] ?? 0}
                    max={remUnit[k]}
                    onChange={(v) => setUnitDelta((p) => ({ ...p, [k]: v }))}
                  />
                ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit(false)}
                className="flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Nothing finished
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onUnitsDone}
                className="flex-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Done'}
              </button>
            </div>
          </>
        )}

        {step === 'confirmCnc' && (
          <>
            <h2 className="text-lg font-bold text-white">Is CNC also done?</h2>
            <p className="mb-3 text-sm text-muted">
              You marked units fully done on {partLabel} whose CNC wasn&apos;t logged yet. Is the
              CNC also finished for those units?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit(false)}
                className="flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                No
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit(true)}
                className="flex-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Yes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
