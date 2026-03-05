import React, { useState } from 'react';
import { formatJobCode, getJobDisplayName } from '@/lib/formatJob';
import type { Job } from '@/core/types';
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
  onNavigate: (view: string, id?: string) => void;
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
  const [clearingBinForId, setClearingBinForId] = useState<string | null>(null);

  const bin = binLocation.trim();
  const jobsAtBin = jobs.filter((j) => (j.binLocation ?? '').trim() === bin);
  const inventoryAtBin = inventory.filter((i) => (i.binLocation ?? '').trim() === bin);

  const handleClearJobBin = async (jobId: string) => {
    setClearingBinForId(jobId);
    try {
      const ok = await onUpdateJob(jobId, { binLocation: undefined });
      if (ok) {
        showToast('Removed from bin', 'success');
        await onRefreshJobs();
      } else {
        showToast('Failed to remove from bin', 'error');
      }
    } catch {
      showToast('Failed to remove from bin', 'error');
    } finally {
      setClearingBinForId(null);
    }
  };

  const handleClearInventoryBin = async (itemId: string) => {
    setClearingBinForId(itemId);
    try {
      const ok = await onUpdateInventoryItem(itemId, { binLocation: undefined });
      if (ok) {
        showToast('Removed from bin', 'success');
        await onRefreshInventory();
      } else {
        showToast('Failed to remove from bin', 'error');
      }
    } catch {
      showToast('Failed to remove from bin', 'error');
    } finally {
      setClearingBinForId(null);
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
            className="flex size-10 items-center justify-center rounded text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {jobsAtBin.length === 0 && inventoryAtBin.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-slate-400">Nothing at this bin</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-sm bg-primary px-4 py-2 text-sm font-bold text-white"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {jobsAtBin.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                    Jobs
                  </h3>
                  <ul className="space-y-1">
                    {jobsAtBin.map((j) => (
                      <li
                        key={j.id}
                        className="flex items-center gap-3 rounded border border-white/10 bg-white/5 p-2"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => handleClearJobBin(j.id)}
                            disabled={clearingBinForId === j.id}
                            className="size-5 rounded border-white/20"
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-white"
                            onClick={(e) => {
                              if ((e.target as HTMLElement).tagName !== 'INPUT') {
                                onNavigate('job-detail', j.id);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ')
                                onNavigate('job-detail', j.id);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            #{formatJobCode(j.jobCode)} – {getJobDisplayName(j)}
                          </span>
                        </label>
                        <span className="material-symbols-outlined text-primary" aria-hidden>
                          chevron_right
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Uncheck to remove from bin. Tap row to open job.
                  </p>
                </section>
              )}
              {inventoryAtBin.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
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
                            disabled={clearingBinForId === item.id}
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
                  <p className="mt-1 text-[10px] text-slate-500">
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
