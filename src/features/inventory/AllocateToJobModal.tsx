import React, { useMemo, useState } from 'react';
import type { InventoryItem, Job } from '@/core/types';
import { formatJobCode } from '@/lib/formatJob';
import { isAllocationActiveStatus } from '@/lib/inventoryCalculations';

interface AllocateToJobModalProps {
  item: InventoryItem;
  jobs: Job[];
  maxAvailable: number;
  onClose: () => void;
  onAllocate: (jobId: string, quantity: number, notes?: string) => Promise<boolean>;
}

export default function AllocateToJobModal({
  item,
  jobs,
  maxAvailable,
  onClose,
  onAllocate,
}: AllocateToJobModalProps) {
  const [jobId, setJobId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const activeJobs = useMemo(
    () => jobs.filter((job) => isAllocationActiveStatus(job.status)),
    [jobs]
  );

  const qtyNumber = Math.max(1, Number.parseFloat(quantity) || 1);
  const quantityError =
    qtyNumber > maxAvailable ? `Only ${maxAvailable} available for allocation.` : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId || qtyNumber <= 0 || qtyNumber > maxAvailable) return;
    setSaving(true);
    try {
      const ok = await onAllocate(jobId, qtyNumber, notes.trim() || undefined);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/80 p-3 sm:items-center">
      <div className="w-full max-w-lg rounded-sm border border-white/10 bg-card-dark p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Allocate To Job</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close allocation dialog"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-slate-300">
          <span className="font-bold text-white">{item.name}</span> • Available now: {maxAvailable}{' '}
          {item.unit}
        </p>

        <form className="space-y-3" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-300" htmlFor="allocate-job">
              Job
            </label>
            <select
              id="allocate-job"
              className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              required
            >
              <option value="">Select active job</option>
              {activeJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {formatJobCode(job.jobCode)} • {job.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="mb-2 block text-sm font-bold text-slate-300"
              htmlFor="allocate-quantity"
            >
              Quantity
            </label>
            <input
              id="allocate-quantity"
              type="number"
              min="1"
              step="1"
              className="min-h-[44px] w-full rounded-sm border border-white/10 bg-white/5 px-3 text-white"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
            {quantityError && <p className="mt-1 text-xs text-red-400">{quantityError}</p>}
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-300" htmlFor="allocate-notes">
              Notes
            </label>
            <textarea
              id="allocate-notes"
              rows={2}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional allocation note"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-sm border border-white/10 px-4 text-sm font-bold text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !!quantityError || !jobId}
              className="min-h-[44px] rounded-sm bg-primary px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? 'Allocating...' : 'Allocate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
