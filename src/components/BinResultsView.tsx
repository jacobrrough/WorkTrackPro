import { useMemo, useState } from 'react';
import { formatJobCode, getJobDisplayName } from '@/lib/formatJob';
import type { Job, ViewState } from '@/core/types';
import type { InventoryItem } from '@/core/types';
import { useToast } from '@/Toast';
import AddInventoryItem from '@/AddInventoryItem';

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
  /** Scan a code (job or inventory) to assign it to this bin. */
  onAddByScan?: () => void;
  /** Create a brand-new inventory item already assigned to this bin. */
  onCreateInventory?: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  /** Controls whether the create form exposes admin-only fields (e.g. price). */
  isAdmin?: boolean;
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
  onAddByScan,
  onCreateInventory,
  isAdmin = false,
}) => {
  const { showToast } = useToast();
  // Which "add to bin" sub-view is open, if any.
  const [addMode, setAddMode] = useState<'list' | 'create' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [clearingJobIds, setClearingJobIds] = useState<Set<string>>(new Set());
  // Staged removal: items are *selected* first, then removed together via the
  // bottom action bar. A single tap on a row never removes anything — it opens
  // the item — so accidental removals can't happen.
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<Set<string>>(new Set());
  const [removingInventory, setRemovingInventory] = useState(false);

  const bin = binLocation.trim();
  const jobsAtBin = jobs.filter((j) => (j.binLocation ?? '').trim() === bin);
  const inventoryAtBin = inventory.filter((i) => (i.binLocation ?? '').trim() === bin);
  // Count only selected items that are still in this bin — a background refresh can drop an
  // item out of the bin while its id lingers in the selection set, which would otherwise
  // make the "Remove N" button overcount.
  const selectedInBinCount = inventoryAtBin.filter((i) => selectedInventoryIds.has(i.id)).length;

  const toggleInventorySelection = (itemId: string) => {
    setSelectedInventoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // Items eligible to be added: everything not already in this bin, matched against the search box.
  // Tools (category 'tool') are excluded — their location is owned by the tag-in/out custody flow,
  // not by directly stamping a bin onto the row.
  const pickerResults = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return inventory
      .filter((i) => i.category !== 'tool')
      .filter((i) => (i.binLocation ?? '').trim() !== bin)
      .filter(
        (i) =>
          q === '' ||
          i.name.toLowerCase().includes(q) ||
          (i.barcode ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [inventory, bin, pickerSearch]);

  const handleAssignToBin = async (item: InventoryItem) => {
    if (assigningId) return;
    setAssigningId(item.id);
    try {
      const ok = await onUpdateInventoryItem(item.id, { binLocation: bin });
      showToast(
        ok ? `Added ${item.name} to bin` : 'Failed to add to bin',
        ok ? 'success' : 'error'
      );
      if (ok) {
        setAddMode(null);
        setPickerSearch('');
      }
    } catch (err) {
      console.error('[BinResultsView] assign inventory to bin failed:', err);
      showToast('Failed to add to bin', 'error');
    } finally {
      setAssigningId(null);
      onRefreshInventory().catch((err) =>
        console.error('[BinResultsView] refresh inventory after assign failed:', err)
      );
    }
  };

  const handleCreateInBin = async (data: Partial<InventoryItem>): Promise<boolean> => {
    if (!onCreateInventory) return false;
    try {
      // Honor whatever bin the user left in the (pre-filled, editable) form; only fall
      // back to this bin if they cleared it.
      const binLocation = (data.binLocation ?? '').trim() || bin;
      const created = await onCreateInventory({ ...data, binLocation });
      if (created) {
        await onRefreshInventory().catch(() => {});
      }
      return Boolean(created);
    } catch (err) {
      console.error('[BinResultsView] create inventory in bin failed:', err);
      return false;
    }
  };

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

  const handleRemoveSelectedInventory = async () => {
    const ids = inventoryAtBin.filter((i) => selectedInventoryIds.has(i.id)).map((i) => i.id);
    if (ids.length === 0 || removingInventory) return;

    setRemovingInventory(true);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          onUpdateInventoryItem(id, { binLocation: undefined })
            .then((res) => Boolean(res))
            .catch((err) => {
              console.error('[BinResultsView] remove inventory from bin failed:', err);
              return false;
            })
        )
      );
      const removed = results.filter(Boolean).length;
      const failed = ids.length - removed;
      if (failed === 0) {
        showToast(
          removed === 1 ? 'Removed 1 item from bin' : `Removed ${removed} items from bin`,
          'success'
        );
      } else if (removed === 0) {
        showToast('Failed to remove from bin', 'error');
      } else {
        showToast(`Removed ${removed}, but ${failed} failed`, 'warning');
      }
      setSelectedInventoryIds(new Set());
    } finally {
      setRemovingInventory(false);
      onRefreshInventory().catch((err) =>
        console.error('[BinResultsView] refresh inventory after remove failed:', err)
      );
    }
  };

  const addSection = (
    <div className="flex flex-col gap-2 pt-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">Add to this bin</p>
      {onAddByScan && (
        <button
          type="button"
          onClick={onAddByScan}
          className="flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/20 py-3 text-sm font-bold text-primary"
        >
          <span className="material-symbols-outlined">qr_code_scanner</span>
          Scan a code
        </button>
      )}
      <button
        type="button"
        onClick={() => setAddMode('list')}
        className="flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/20 py-3 text-sm font-bold text-primary"
      >
        <span className="material-symbols-outlined">list</span>
        Pick from a list
      </button>
      {onCreateInventory && (
        <button
          type="button"
          onClick={() => setAddMode('create')}
          className="flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/20 py-3 text-sm font-bold text-primary"
        >
          <span className="material-symbols-outlined">add_circle</span>
          Create a new part
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-2 rounded-lg bg-white/10 py-3 text-sm font-bold text-white"
      >
        Done
      </button>
    </div>
  );

  if (addMode === 'create' && onCreateInventory) {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col bg-background-dark"
        role="dialog"
        aria-modal="true"
      >
        <AddInventoryItem
          onAdd={handleCreateInBin}
          onCancel={() => setAddMode(null)}
          isAdmin={isAdmin}
          initialBinLocation={bin}
        />
      </div>
    );
  }

  if (addMode === 'list') {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col bg-background-dark"
        role="dialog"
        aria-modal="true"
        aria-label={`Add inventory to bin ${binLocation}`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-background-dark/95 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setAddMode(null);
              setPickerSearch('');
            }}
            className="flex size-10 items-center justify-center rounded text-muted hover:text-white"
            aria-label="Back to bin"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h2 className="text-lg font-bold text-white">Add to bin {binLocation}</h2>
        </header>
        <div className="shrink-0 px-4 pt-3">
          <input
            type="search"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Search inventory by name or barcode"
            className="w-full rounded-lg border border-line bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {pickerResults.length === 0 ? (
            <p className="py-8 text-center text-muted">
              {pickerSearch.trim() ? 'No matching items' : 'No inventory available to add'}
            </p>
          ) : (
            <ul className="space-y-1">
              {pickerResults.map((item) => {
                const isAssigning = assigningId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleAssignToBin(item)}
                      disabled={assigningId !== null}
                      className="flex w-full items-center gap-3 rounded border border-line bg-white/5 p-3 text-left disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-white">{item.name}</span>
                        {(item.binLocation ?? '').trim() && (
                          <span className="block truncate text-xs text-subtle">
                            Currently in bin {item.binLocation}
                          </span>
                        )}
                      </span>
                      <span className="material-symbols-outlined shrink-0 text-primary" aria-hidden>
                        {isAssigning ? 'hourglass_empty' : 'add_circle'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {pickerResults.length >= 50 && (
            <p className="mt-2 text-center text-xs text-subtle">
              Showing first 50 — refine your search to narrow results.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background-dark"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bin-results-title"
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-background-dark/95 px-4 py-3">
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
            <div className="space-y-4">
              <p className="py-6 text-center text-muted">Nothing at this bin yet</p>
              {addSection}
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
                          className="flex items-center gap-3 rounded border border-line bg-white/5 p-2"
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
                    {inventoryAtBin.map((item) => {
                      const isSelected = selectedInventoryIds.has(item.id);
                      return (
                        <li
                          key={item.id}
                          className="flex items-center gap-3 rounded border border-line bg-white/5 p-2"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleInventorySelection(item.id)}
                            disabled={removingInventory}
                            className="size-5 shrink-0 rounded border-line-strong"
                            aria-label={`Select ${item.name} for removal from bin`}
                          />
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                            onClick={() => onNavigate('inventory-detail', item.id)}
                          >
                            <span className="min-w-0 flex-1 truncate text-white">{item.name}</span>
                            <span
                              className="material-symbols-outlined shrink-0 text-primary"
                              aria-hidden
                            >
                              chevron_right
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-[10px] text-subtle">
                    Tap an item to open it. Check items, then remove them below.
                  </p>
                  {selectedInBinCount > 0 && (
                    <button
                      type="button"
                      onClick={handleRemoveSelectedInventory}
                      disabled={removingInventory}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/20 py-3 text-sm font-bold text-red-300 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        {removingInventory ? 'hourglass_empty' : 'remove_circle'}
                      </span>
                      {removingInventory
                        ? 'Removing…'
                        : `Remove ${selectedInBinCount} selected from bin`}
                    </button>
                  )}
                </section>
              )}
              {addSection}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BinResultsView;
