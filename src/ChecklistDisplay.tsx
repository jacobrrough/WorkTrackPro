// ChecklistDisplay.tsx - Display checklist on job cards and detail pages
import React, { useState, useEffect } from 'react';
import {
  Checklist,
  ChecklistHistory,
  JobInventoryItem,
  JobStatus,
  User,
  getStatusDisplayName,
} from '@/core/types';
import { useToast } from './Toast';
import { useApp } from '@/AppContext';
import { checklistService, checklistHistoryService } from './pocketbase';
import { inventoryService } from '@/services/api/inventory';

type ShortfallInfo = { name: string; need: number; have: number; unit: string };

interface ChecklistDisplayProps {
  jobId: string;
  jobStatus: JobStatus;
  currentUser: User;
  jobInventoryItems?: JobInventoryItem[];
  compact?: boolean; // For card view vs detail view
  onChecklistComplete?: () => void | Promise<void>;
}

const ChecklistDisplay: React.FC<ChecklistDisplayProps> = ({
  jobId,
  jobStatus,
  currentUser,
  jobInventoryItems,
  compact = false,
  onChecklistComplete,
}) => {
  const { showToast } = useToast();
  // The DB `available` column is not authoritative — stock writes don't update it. Use the
  // app's allocation-aware calculateAvailable so the material-availability gate isn't stale.
  const { calculateAvailable } = useApp();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ChecklistHistory[]>([]);
  const [, setError] = useState<string | null>(null);
  const [shortfallState, setShortfallState] = useState<{
    itemIndex: number;
    items: ShortfallInfo[];
  } | null>(null);

  const loadChecklist = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allChecklists = await checklistService.getByJob(jobId);
      let matchingChecklist = allChecklists.find((c) => c.status === jobStatus);

      // Always ensure checklist exists for current column/status.
      // If no template exists, service creates fallback checklist with one "MOVE" item.
      if (!matchingChecklist) {
        matchingChecklist =
          (await checklistService.ensureJobChecklistForStatus(jobId, jobStatus)) ?? undefined;
      }

      if (matchingChecklist) {
        setChecklist({
          id: matchingChecklist.id,
          job: matchingChecklist.job,
          status: matchingChecklist.status,
          items: matchingChecklist.items || [],
          created: matchingChecklist.created,
          updated: matchingChecklist.updated,
        });
      } else {
        setChecklist(null);
      }
    } catch (error) {
      console.error('❌ Failed to load checklist:', error);
      setError('Failed to load checklist');
      setChecklist(null);
    } finally {
      setLoading(false);
    }
  }, [jobId, jobStatus]);

  useEffect(() => {
    loadChecklist();
  }, [loadChecklist]);

  const loadHistory = async () => {
    if (!jobId) return;
    try {
      const records = await checklistHistoryService.getByJob(jobId);
      setHistory(records);
      setShowHistory(true);
    } catch (error) {
      console.error('Failed to load history:', error);
      showToast('Failed to load history', 'error');
    }
  };

  const handleToggleItem = async (itemIndex: number) => {
    if (!checklist || updating) return;

    const item = checklist.items[itemIndex];
    const newCheckedState = !item.checked;

    setShortfallState(null);
    setUpdating(true);
    try {
      // Material availability gate
      if (newCheckedState && item.isMaterialCheck) {
        const bom = jobInventoryItems ?? [];
        if (!bom.length) {
          console.warn(
            '[ChecklistDisplay] isMaterialCheck item triggered but no BOM data provided'
          );
        } else {
          const ids = bom.map((ji) => ji.inventoryId).filter((id): id is string => !!id);

          const liveItems = await inventoryService.getByIds(ids).catch(() => {
            showToast('Could not verify stock levels — please try again.', 'error');
            return null;
          });
          if (!liveItems) return;

          const liveMap = new Map(liveItems.map((i) => [i.id, i]));
          const shortfalls: ShortfallInfo[] = bom
            .filter((ji): ji is typeof ji & { inventoryId: string } => !!ji.inventoryId)
            .flatMap((ji) => {
              const live = liveMap.get(ji.inventoryId);
              if (!live) return [];
              const have = calculateAvailable(live) + live.onOrder;
              return have < ji.quantity
                ? [{ name: live.name, need: ji.quantity, have, unit: ji.unit }]
                : [];
            });

          if (shortfalls.length) {
            setShortfallState({ itemIndex, items: shortfalls });
            showToast('Not enough stock to proceed — see details below.', 'error');
            return;
          }
        }
      }

      // Update the item
      const updatedItems = checklist.items.map((itm, idx) =>
        idx === itemIndex
          ? {
              ...itm,
              checked: newCheckedState,
              checkedBy: newCheckedState ? currentUser.id : undefined,
              checkedByName: newCheckedState ? currentUser.name : undefined,
              checkedAt: newCheckedState ? new Date().toISOString() : undefined,
            }
          : itm
      );

      await checklistService.update(checklist.id, { items: updatedItems });
      await checklistHistoryService.create({
        checklist_id: checklist.id,
        user_id: currentUser.id,
        item_index: itemIndex,
        item_text: item.text,
        checked: newCheckedState,
      });

      setChecklist({ ...checklist, items: updatedItems });

      // Check if all items are now complete — await so status advance + refresh finish before UI continues
      const allComplete = updatedItems.every((i) => i.checked);
      if (allComplete && onChecklistComplete) {
        await Promise.resolve(onChecklistComplete());
      }
    } catch (error) {
      console.error('Failed to toggle item:', error);
      showToast('Failed to update checklist', 'error');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return compact ? null : <p className="text-sm text-subtle">Loading checklist...</p>;
  }

  if (!checklist || checklist.items.length === 0) {
    return null;
  }

  const completedCount = checklist.items.filter((i) => i.checked).length;
  const totalCount = checklist.items.length;
  const allComplete = completedCount === totalCount;

  if (compact) {
    // Compact view for Kanban cards
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="material-symbols-outlined text-sm text-muted">checklist</span>
        <span className={`font-bold ${allComplete ? 'text-green-400' : 'text-muted'}`}>
          {completedCount}/{totalCount}
        </span>
        {allComplete && <span className="text-green-400">✓</span>}
      </div>
    );
  }

  // Full view for detail page
  return (
    <div className="rounded-2xl border border-line bg-overlay/5 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">checklist</span>
          <h3 className="font-bold text-white">Checklist</h3>
          <span className={`text-sm font-bold ${allComplete ? 'text-green-400' : 'text-muted'}`}>
            ({completedCount}/{totalCount})
          </span>
        </div>
        <button
          onClick={loadHistory}
          className="flex items-center gap-1 text-sm text-muted hover:text-primary"
          title="View who completed items"
        >
          <span className="material-symbols-outlined text-sm">history</span>
          History
        </button>
      </div>

      <div className="space-y-2">
        {checklist.items.map((item, index) => (
          <div key={item.id}>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded p-2 transition-all ${
                item.checked
                  ? 'border border-green-500/20 bg-green-500/10'
                  : 'border border-line bg-overlay/5 hover:border-primary/50'
              }`}
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => handleToggleItem(index)}
                disabled={updating}
                className="mt-1 h-4 w-4 rounded border-line-strong bg-overlay/10 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <div className="flex-1">
                <p
                  className={`text-sm ${item.checked ? 'text-green-400 line-through' : 'text-white'}`}
                >
                  {item.text}
                </p>
                {item.checked && item.checkedByName && (
                  <p className="mt-1 text-xs text-subtle">
                    Completed by {item.checkedByName}
                    {item.checkedAt && ` on ${new Date(item.checkedAt).toLocaleDateString()}`}
                  </p>
                )}
              </div>
            </label>
            {shortfallState?.itemIndex === index && (
              <div className="mt-1 rounded border border-red-500/30 bg-red-500/10 p-2">
                <p className="mb-1.5 text-xs font-bold text-red-400">Insufficient stock:</p>
                <ul className="space-y-1">
                  {shortfallState.items.map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center justify-between text-xs text-red-300"
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="ml-2 shrink-0 font-mono text-[11px]">
                        need {s.need.toFixed(2)} {s.unit}, have {s.have}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {allComplete && (
        <div className="mt-3 rounded border border-green-500/40 bg-green-500/20 p-2 text-center">
          <p className="text-sm font-bold text-green-400">✓ All items complete!</p>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-card-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line p-3">
              <h3 className="font-bold text-white">Checklist History</h3>
              <button onClick={() => setShowHistory(false)} className="text-muted hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="max-h-[calc(80vh-80px)] overflow-y-auto p-3">
              {history.length === 0 ? (
                <p className="py-8 text-center text-muted">No history yet</p>
              ) : (
                <div className="space-y-3">
                  {history.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-2xl border border-line bg-overlay/5 p-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-white">{record.userName}</p>
                          <p className="text-xs text-muted">
                            {new Date(record.timestamp).toLocaleString()}
                            {'status' in record && record.status
                              ? ` · ${getStatusDisplayName(record.status!)}`
                              : ''}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${
                            record.checked
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {record.checked ? 'Checked' : 'Unchecked'}
                        </span>
                      </div>
                      <p className="text-sm text-muted">{record.itemText}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChecklistDisplay;
