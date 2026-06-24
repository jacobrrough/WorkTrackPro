import { useState } from 'react';
import { formatJobCode, getJobDisplayName } from '@/lib/formatJob';
import type { Job, ViewState } from '@/core/types';
import type { InventoryItem } from '@/core/types';
import { useToast } from '@/Toast';

export interface BinResultsViewProps {
  binLocation: string;
  jobs: Job[];
  inventory: InventoryItem[];
  onUpdateJob: (jobId: string, data: Partial<Job>) => Promise<Job | null>;
  onUpdateInventoryItem: (
    id: string,
    data: Partial<InventoryItem>
  ) => Promise<InventoryItem | null>;
  onRefreshJobs: () => Promise<void>;
  onRefreshInventory: () => Promise<void>;
  onNavigate: (view: ViewState, id?: string) => void;
  onClose: () => void;
  onAddJobToBin?: () => void;
}

/**
 * Shared bin results UI: list jobs and inventory at a bin, uncheck to remove from bin,
 * optional "Add job to this bin" action. Used by Dashboard and ScannerScreen.
 */
const BinResultsView: React.FC<BinResultsViewProps> = ({
  binLocation,
  jobs,
  inventory,
  onUpdateJob,
  onUpdateInventoryItem,
  onRefreshJobs,
  onRefreshInventory,
  onNavigate,
  onClose,
  onAddJobToBin,
}) => {
  const { showToast } = useToast();
  const [clearingJobIds, setClearingJobIds] = useState<Set<string>>(new Set());
  const [clearingInventoryIds, setClearingInventoryIds] = useState<Set<string>>(new Set());

  const bin = binLocation.trim();
  const jobsAtBin = jobs.filter((j) => (j.binLocation ?? '').trim() === bin);
  const inventoryAtBin = inventory.filter((i) => (i.binLocation ?? '').trim() === bin);

  const handleClearJobBin = async (jobId: string) => {
    setClearingJobIds((prev) => new Set(prev).add(jobId));
    try {
      const ok = await onUpdateJob(jobId, { binLocation: undefined });
      showToast(ok ? 'Removed from bin' : 'Failed to remove from bin', ok ? 'success' : 'error');
    } catch (err) {
      console.error('[BinResultsView] clear job bin failed:', err);
      showToast('Failed to remove from bin', 'error');
    } finally {
      setClearingJobIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      onRefreshJobs().catch((err) =>
        console.error('[BinResultsView] refresh jobs after clear failed:', err)
      );
    }
  };

  const handleClearInventoryBin = async (itemId: string) => {
    setClearingInventoryIds((prev) => new Set(prev).add(itemId));
    try {
      const ok = await onUpdateInventoryItem(itemId, { binLocation: undefined });
      showToast(ok ? 'Removed from bin' : 'Failed to remove from bin', ok ? 'success' : 'error');
    } catch (err) {
      console.error('[BinResultsView] clear inventory bin failed:', err);
      showToast('Failed to remove from bin', 'error');
    } finally {
      setClearingInventoryIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      onRefreshInventory().catch((err) =>
        console.error('[BinResultsView] refresh inventory after clear failed:', err)
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background-dark"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bin-results-title"
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3">
          <h2 id="bin-results-title" className="text-lg font-bold text-white">
            Bin {binLocation}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded text-muted hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {jobsAtBin.length === 0 && inventoryAtBin.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted">Nothing at this bin</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-sm bg-primary px-4 py-2 text-sm font-bold text-on-accent"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {jobsAtBin.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                    Jobs
                  </h3>
                  <ul className="space-y-1">
                    {jobsAtBin.map((j) => {
                      const isClearing = clearingJobIds.has(j.id);
                      return (
                        <li
                          key={j.id}
                          className="flex items-center gap-3 rounded border border-white/10 bg-white/5 p-2"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                            onClick={() => {
                              if (!isClearing) onNavigate('job-detail', j.id);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate text-white">
                              #{formatJobCode(j.jobCode)} – {getJobDisplayName(j)}
                            </span>
                            <span
                              className="material-symbols-outlined shrink-0 text-primary"
                              aria-hidden
                            >
                              chevron_right
                            </span>
                          </button>
                          <button
                            type="button"
                            className="flex size-11 shrink-0 items-center justify-center rounded text-subtle hover:text-white"
                            onClick={() => handleClearJobBin(j.id)}
                            disabled={isClearing}
                            aria-label={`Remove #${formatJobCode(j.jobCode)} ${getJobDisplayName(j)} from bin`}
                          >
                            <span className="material-symbols-outlined" aria-hidden>
                              {isClearing ? 'hourglass_empty' : 'remove_circle'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-[10px] text-subtle">
                    Tap to open. Use the icon to remove from bin.
                  </p>
                </section>
              )}
              {inventoryAtBin.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                    Inventory
                  </h3>
                  <ul className="space-y-1">
                    {inventoryAtBin.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-3 rounded border border-white/10 bg-white/5 p-2"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => handleClearInventoryBin(item.id)}
                            disabled={clearingInventoryIds.has(item.id)}
                            className="size-5 rounded border-white/20"
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-white"
                            onClick={(e) => {
                              if ((e.target as HTMLElement).tagName !== 'INPUT') {
                                onNavigate('inventory-detail', item.id);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ')
                                onNavigate('inventory-detail', item.id);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            {item.name}
                          </span>
                        </label>
                        <span className="material-symbols-outlined text-primary" aria-hidden>
                          chevron_right
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10px] text-subtle">
                    Uncheck to remove from bin. Tap row to open item.
                  </p>
                </section>
              )}
              <div className="flex flex-col gap-2 pt-2">
                {onAddJobToBin && (
                  <button
                    type="button"
                    onClick={onAddJobToBin}
                    className="flex items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/20 py-3 text-sm font-bold text-primary"
                  >
                    <span className="material-symbols-outlined">add_circle</span>
                    Add job to this bin
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-sm bg-white/10 py-3 text-sm font-bold text-white"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BinResultsView;
