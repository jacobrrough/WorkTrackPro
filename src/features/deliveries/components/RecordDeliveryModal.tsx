import React, { useState, useMemo } from 'react';
import type { Delivery, DeliveryLineItem, Job } from '@/core/types';

interface RecordDeliveryModalProps {
  job: Job;
  existing?: Delivery;
  alreadyDeliveredByKey: Record<string, number>;
  onClose: () => void;
  onSave: (data: {
    deliveredAt: string;
    carrier?: string;
    trackingNumber?: string;
    recipientName?: string;
    notes?: string;
    lineItems: DeliveryLineItem[];
  }) => Promise<unknown>;
}

interface EditableLine extends DeliveryLineItem {
  ordered?: number;
  remaining?: number;
}

function buildInitialLines(
  job: Job,
  alreadyDelivered: Record<string, number>,
  existing?: Delivery
): EditableLine[] {
  if (existing) {
    return existing.lineItems.map((li) => ({ ...li }));
  }

  const lines: EditableLine[] = [];

  if (job.parts && job.parts.length > 0) {
    for (const part of job.parts) {
      const dq = part.dashQuantities ?? {};
      const variants = Object.keys(dq).sort();
      if (variants.length === 0) {
        const key = `${part.partNumber}|`;
        lines.push({
          partNumber: part.partNumber,
          description: part.partNumber,
          quantity: 0,
          unit: 'units',
          ordered: 0,
          remaining: 0 - (alreadyDelivered[key] ?? 0),
        });
      } else {
        for (const v of variants) {
          const ordered = Number(dq[v]) || 0;
          const key = `${part.partNumber}|${v}`;
          const delivered = alreadyDelivered[key] ?? 0;
          const remaining = Math.max(0, ordered - delivered);
          lines.push({
            partNumber: part.partNumber,
            variantSuffix: v,
            description: `${part.partNumber}-${v}`,
            quantity: remaining,
            unit: 'units',
            ordered,
            remaining,
          });
        }
      }
    }
  } else if (job.partNumber) {
    const dq = job.dashQuantities ?? {};
    const variants = Object.keys(dq).sort();
    if (variants.length > 0) {
      for (const v of variants) {
        const ordered = Number(dq[v]) || 0;
        const key = `${job.partNumber}|${v}`;
        const delivered = alreadyDelivered[key] ?? 0;
        const remaining = Math.max(0, ordered - delivered);
        lines.push({
          partNumber: job.partNumber,
          variantSuffix: v,
          description: `${job.partNumber}-${v}`,
          quantity: remaining,
          unit: 'units',
          ordered,
          remaining,
        });
      }
    } else {
      const ordered = Number(job.qty) || 0;
      const key = `${job.partNumber}|`;
      const delivered = alreadyDelivered[key] ?? 0;
      const remaining = Math.max(0, ordered - delivered);
      lines.push({
        partNumber: job.partNumber,
        description: job.partNumber,
        quantity: remaining,
        unit: 'units',
        ordered,
        remaining,
      });
    }
  } else {
    const ordered = Number(job.qty) || 0;
    const key = `|`;
    const delivered = alreadyDelivered[key] ?? 0;
    const remaining = Math.max(0, ordered - delivered);
    lines.push({
      description: job.name || 'Item',
      quantity: remaining,
      unit: 'units',
      ordered,
      remaining,
    });
  }

  return lines;
}

const RecordDeliveryModal: React.FC<RecordDeliveryModalProps> = ({
  job,
  existing,
  alreadyDeliveredByKey,
  onClose,
  onSave,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [deliveredAt, setDeliveredAt] = useState(existing?.deliveredAt ?? today);
  const [carrier, setCarrier] = useState(existing?.carrier ?? '');
  const [trackingNumber, setTrackingNumber] = useState(existing?.trackingNumber ?? '');
  const [recipientName, setRecipientName] = useState(existing?.recipientName ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<EditableLine[]>(() =>
    buildInitialLines(job, alreadyDeliveredByKey, existing)
  );
  const [saving, setSaving] = useState(false);

  const totalQty = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
    [lines]
  );

  const updateLine = (idx: number, patch: Partial<EditableLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addCustomLine = () => {
    setLines((prev) => [
      ...prev,
      { description: '', quantity: 1, unit: 'units' } satisfies EditableLine,
    ]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalQty === 0) return;
    setSaving(true);
    const lineItems: DeliveryLineItem[] = lines
      .filter((l) => l.quantity > 0 && l.description.trim())
      .map((l) => ({
        description: l.description,
        partNumber: l.partNumber,
        variantSuffix: l.variantSuffix,
        quantity: Number(l.quantity),
        unit: l.unit || 'units',
      }));
    await onSave({
      deliveredAt,
      carrier: carrier.trim() || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      recipientName: recipientName.trim() || undefined,
      notes: notes.trim() || undefined,
      lineItems,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl flex-col rounded-lg border border-white/10 bg-surface-dark"
        style={{ maxHeight: '90vh' }}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            {existing ? `Edit Delivery #${existing.deliveryNumber}` : 'Record Delivery'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Delivery date</label>
              <input
                type="date"
                value={deliveredAt}
                onChange={(e) => setDeliveredAt(e.target.value)}
                required
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Recipient</label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Who received it"
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Carrier</label>
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="UPS, FedEx, customer pickup..."
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Tracking #</label>
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Optional"
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-white">Items shipped</label>
            <button
              type="button"
              onClick={addCustomLine}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Add custom item
            </button>
          </div>
          <div className="mb-4 space-y-2">
            {lines.length === 0 ? (
              <p className="rounded border border-dashed border-white/10 py-4 text-center text-sm text-slate-500">
                No items. Click "Add custom item" to add one.
              </p>
            ) : (
              lines.map((line, idx) => (
                <div key={idx} className="rounded border border-white/10 bg-white/5 p-2">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-slate-300">
                      {line.partNumber
                        ? `${line.partNumber}${line.variantSuffix ? `-${line.variantSuffix}` : ''}`
                        : 'Custom'}
                    </span>
                    {line.ordered != null && (
                      <span className="text-[10px] text-slate-500">
                        Ordered {line.ordered} · {line.remaining} remaining
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      placeholder="Description"
                      className="col-span-6 rounded border border-white/10 bg-transparent px-2 py-1 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })}
                      className="col-span-3 rounded border border-white/10 bg-transparent px-2 py-1 text-right text-sm text-white focus:border-primary focus:outline-none"
                    />
                    <input
                      value={line.unit ?? ''}
                      onChange={(e) => updateLine(idx, { unit: e.target.value })}
                      placeholder="units"
                      className="col-span-2 rounded border border-white/10 bg-transparent px-2 py-1 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="col-span-1 flex items-center justify-center text-slate-500 hover:text-red-400"
                      aria-label="Remove line"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary focus:outline-none"
              placeholder="Special instructions, packaging notes, etc."
            />
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-6 py-3">
          <p className="text-sm text-slate-400">
            Total: <span className="font-semibold text-white">{totalQty}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={totalQty === 0 || saving}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : existing ? 'Save changes' : 'Record delivery'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
};

export default RecordDeliveryModal;
