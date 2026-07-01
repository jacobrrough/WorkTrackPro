import React, { useMemo, useState } from 'react';
import type { Delivery, Job, User } from '@/core/types';
import { useToast } from '@/Toast';
import { useJobDeliveries } from '@/hooks/useDeliveryQueries';
import { useDeliveryMutations } from '@/hooks/useDeliveryMutations';
import RecordDeliveryModal from './components/RecordDeliveryModal';
import PackingSlipPreview from './components/PackingSlipPreview';
import DeliveryCard from './components/DeliveryCard';

interface DeliveriesSectionProps {
  job: Job;
  currentUser: User | null;
  /** Part name keyed by part number, so new packing slips default to the part name. */
  partNamesByNumber?: Record<string, string>;
}

function lineKey(partNumber?: string, variantSuffix?: string) {
  return `${partNumber ?? ''}|${variantSuffix ?? ''}`;
}

function totalOrderedQty(job: Job): number {
  if (job.parts && job.parts.length > 0) {
    let total = 0;
    for (const part of job.parts) {
      const dq = part.dashQuantities ?? {};
      for (const v of Object.keys(dq)) total += Number(dq[v]) || 0;
    }
    return total;
  }
  if (job.dashQuantities) {
    let total = 0;
    for (const v of Object.keys(job.dashQuantities)) total += Number(job.dashQuantities[v]) || 0;
    if (total > 0) return total;
  }
  return Number(job.qty) || 0;
}

const DeliveriesSection: React.FC<DeliveriesSectionProps> = ({
  job,
  currentUser,
  partNamesByNumber,
}) => {
  const { showToast } = useToast();
  const { data: deliveries, isLoading } = useJobDeliveries(job.id);
  const { createDelivery, updateDelivery, deleteDelivery } = useDeliveryMutations({
    currentUser,
    showToast,
  });

  const [showRecord, setShowRecord] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [previewing, setPreviewing] = useState<Delivery | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isAdmin = currentUser?.isAdmin ?? false;

  const { totalDelivered, ordered, alreadyDeliveredByKey } = useMemo(() => {
    const list: Delivery[] = deliveries ?? [];
    const byKey: Record<string, number> = {};
    let total = 0;
    for (const d of list) {
      for (const item of d.lineItems) {
        const k = lineKey(item.partNumber, item.variantSuffix);
        byKey[k] = (byKey[k] ?? 0) + (Number(item.quantity) || 0);
        total += Number(item.quantity) || 0;
      }
    }
    return {
      totalDelivered: total,
      ordered: totalOrderedQty(job),
      alreadyDeliveredByKey: byKey,
    };
  }, [deliveries, job]);

  // When editing, exclude that delivery's own quantities from the "already delivered" baseline
  const baselineForEditing = useMemo(() => {
    if (!editing) return alreadyDeliveredByKey;
    const adjusted = { ...alreadyDeliveredByKey };
    for (const item of editing.lineItems) {
      const k = lineKey(item.partNumber, item.variantSuffix);
      adjusted[k] = (adjusted[k] ?? 0) - (Number(item.quantity) || 0);
    }
    return adjusted;
  }, [editing, alreadyDeliveredByKey]);

  const remaining = ordered > 0 ? Math.max(0, ordered - totalDelivered) : null;
  const progressPercent = ordered > 0 ? Math.min(100, (totalDelivered / ordered) * 100) : 0;

  const handleRecord = async (
    data: Parameters<typeof createDelivery>[0] | Parameters<typeof updateDelivery>[2]
  ) => {
    if (editing) {
      await updateDelivery(job.id, editing.id, data);
      setEditing(null);
    } else {
      await createDelivery({ ...(data as Parameters<typeof createDelivery>[0]), jobId: job.id });
      setShowRecord(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    await deleteDelivery(job.id, confirmDeleteId);
    setConfirmDeleteId(null);
  };

  return (
    <section className="mb-4 rounded-lg border border-line bg-surface-dark p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-cyan-400">local_shipping</span>
          <h3 className="text-base font-semibold text-white">Deliveries</h3>
          <span className="rounded bg-overlay/10 px-1.5 py-0.5 text-xs text-muted">
            {deliveries?.length ?? 0}
          </span>
        </div>
        <button
          onClick={() => setShowRecord(true)}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-on-accent"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Record Delivery
        </button>
      </div>

      {ordered > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-muted">
              <span className="font-bold text-white">{totalDelivered}</span> of{' '}
              <span className="font-semibold">{ordered}</span> delivered
            </span>
            {remaining != null && remaining > 0 && (
              <span className="text-xs text-muted">{remaining} remaining</span>
            )}
            {remaining === 0 && (
              <span className="text-xs font-semibold text-green-400">Complete</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-overlay/10">
            <div
              className="h-full rounded-full bg-cyan-500 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="py-4 text-center text-sm text-subtle">Loading deliveries...</p>
      ) : !deliveries?.length ? (
        <p className="rounded border border-dashed border-line py-4 text-center text-sm text-subtle">
          No deliveries recorded yet.
        </p>
      ) : (
        <div className="space-y-2">
          {deliveries.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              canEdit={isAdmin || d.createdBy === currentUser?.id}
              onPreview={() => setPreviewing(d)}
              onEdit={() => setEditing(d)}
              onDelete={() => setConfirmDeleteId(d.id)}
            />
          ))}
        </div>
      )}

      {(showRecord || editing) && (
        <RecordDeliveryModal
          job={job}
          existing={editing ?? undefined}
          alreadyDeliveredByKey={editing ? baselineForEditing : alreadyDeliveredByKey}
          partNamesByNumber={partNamesByNumber}
          onClose={() => {
            setShowRecord(false);
            setEditing(null);
          }}
          onSave={handleRecord}
        />
      )}

      {previewing && (
        <PackingSlipPreview
          delivery={previewing}
          job={job}
          canEditBranding={isAdmin}
          onClose={() => setPreviewing(null)}
        />
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface-dark p-5">
            <h3 className="mb-2 text-base font-semibold text-white">Delete delivery?</h3>
            <p className="mb-4 text-sm text-muted">
              This removes the record permanently. The packing slip can no longer be reprinted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded px-3 py-1.5 text-sm text-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-on-danger"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default DeliveriesSection;
