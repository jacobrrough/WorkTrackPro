// ChecklistDisplay.tsx - Display checklist on job cards and detail pages
import React, { useState, useEffect } from 'react';
import { Checklist, ChecklistHistory, JobStatus, User, getStatusDisplayName } from '@/core/types';
import { useToast } from './Toast';
import { checklistService, checklistHistoryService } from './pocketbase';

interface ChecklistDisplayProps {
  jobId: string;
  jobStatus: JobStatus;
  currentUser: User;
  compact?: boolean; // For card view vs detail view
  onChecklistComplete?: () => void;
}

const ChecklistDisplay: React.FC<ChecklistDisplayProps> = ({
  jobId,
  jobStatus,
  currentUser,
  compact = false,
  onChecklistComplete,
}) => {
  const { showToast } = useToast();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ChecklistHistory[]>([]);
  const [, setError] = useState<string | null>(null);

  const loadChecklist = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allChecklists = await checklistService.getByJob(jobId);
      let matchingChecklist = allChecklists.find((c) => c.status === jobStatus);

      // Always ensure checklist exists for current column/status.
      // If no template exists, service creates fallback checklist with one "MOVE" item.
      if (!matchingChecklist) {
        matchingChecklist = await checklistService.ensureJobChecklistForStatus(jobId, jobStatus);
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

    setUpdating(true);
    try {
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

      // Check if all items are now complete
      const allComplete = updatedItems.every((i) => i.checked);
      if (allComplete && onChecklistComplete) {
        onChecklistComplete();
      }
    } catch (error) {
      console.error('Failed to toggle item:', error);
      showToast('Failed to update checklist', 'error');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return compact ? null : <p className="text-sm text-slate-500">Loading checklist...</p>;
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
        <span className="material-symbols-outlined text-sm text-slate-400">checklist</span>
        <span className={`font-bold ${allComplete ? 'text-green-400' : 'text-slate-400'}`}>
          {completedCount}/{totalCount}
        </span>
        {allComplete && <span className="text-green-400">✓</span>}
      </div>
    );
  }

  // Full view for detail page
  return (
    <div className="rounded-sm border border-white/10 bg-white/5 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">checklist</span>
          <h3 className="font-bold text-white">Checklist</h3>
          <span
            className={`text-sm font-bold ${allComplete ? 'text-green-400' : 'text-slate-400'}`}
          >
            ({completedCount}/{totalCount})
          </span>
        </div>
        <button
          onClick={loadHistory}
          className="flex items-center gap-1 text-sm text-slate-400 hover:text-primary"
          title="View who completed items"
        >
          <span className="material-symbols-outlined text-sm">history</span>
          History
        </button>
      </div>

      <div className="space-y-2">
        {checklist.items.map((item, index) => (
          <label
            key={item.id}
            className={`flex cursor-pointer items-start gap-3 rounded p-2 transition-all ${
              item.checked
                ? 'border border-green-500/20 bg-green-500/10'
                : 'border border-white/10 bg-white/5 hover:border-primary/50'
            }`}
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={() => handleToggleItem(index)}
              disabled={updating}
              className="mt-1 h-4 w-4 rounded border-white/20 bg-white/10 text-primary focus:ring-primary focus:ring-offset-0"
            />
            <div className="flex-1">
              <p
                className={`text-sm ${item.checked ? 'text-green-400 line-through' : 'text-white'}`}
              >
                {item.text}
              </p>
              {item.checked && item.checkedByName && (
                <p className="mt-1 text-xs text-slate-500">
                  Completed by {item.checkedByName}
                  {item.checkedAt && ` on ${new Date(item.checkedAt).toLocaleDateString()}`}
                </p>
              )}
            </div>
          </label>
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
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-sm border border-white/10 bg-card-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <h3 className="font-bold text-white">Checklist History</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="max-h-[calc(80vh-80px)] overflow-y-auto p-3">
              {history.length === 0 ? (
                <p className="py-8 text-center text-slate-400">No history yet</p>
              ) : (
                <div className="space-y-3">
                  {history.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-sm border border-white/10 bg-white/5 p-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-white">{record.userName}</p>
                          <p className="text-xs text-slate-400">
                            {new Date(record.timestamp).toLocaleString()}
                            {'status' in record && record.status
                              ? ` · ${getStatusDisplayName(record.status)}`
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
                      <p className="text-sm text-slate-300">{record.itemText}</p>
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
