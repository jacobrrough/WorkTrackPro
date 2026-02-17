import React, { useState, useEffect } from 'react';
import { Job, JobStatus, ViewState, User, Checklist } from '@/core/types';
import { formatDateOnly } from '@/core/date';
import { checklistService } from './pocketbase';
import { useToast } from './Toast';

interface KanbanBoardProps {
  jobs: Job[];
  boardType: 'shopFloor' | 'admin';
  onNavigate: (view: ViewState, jobId?: string) => void;
  onUpdateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  onCreateJob: () => void;
  onDeleteJob?: (jobId: string) => Promise<void>;
  isAdmin: boolean;
  currentUser: User;
}

const SHOP_FLOOR_COLUMNS: { id: JobStatus; title: string; color: string }[] = [
  { id: 'pending', title: 'Pending', color: 'bg-pink-500' },
  { id: 'rush', title: 'Rush', color: 'bg-red-600' },
  { id: 'inProgress', title: 'In Progress', color: 'bg-blue-500' },
  { id: 'qualityControl', title: 'Quality Control', color: 'bg-green-500' },
  { id: 'finished', title: 'Finished', color: 'bg-yellow-500' },
  { id: 'delivered', title: 'Delivered', color: 'bg-cyan-500' },
  { id: 'onHold', title: 'On Hold', color: 'bg-gray-500' },
];

const ADMIN_COLUMNS: { id: JobStatus; title: string; color: string }[] = [
  { id: 'toBeQuoted', title: 'To Be Quoted', color: 'bg-red-500' },
  { id: 'quoted', title: 'Quoted', color: 'bg-orange-400' },
  { id: 'rfqReceived', title: 'RFQ Received', color: 'bg-orange-500' },
  { id: 'rfqSent', title: 'RFQ Sent', color: 'bg-yellow-500' },
  { id: 'pod', title: "PO'd", color: 'bg-green-500' },
  { id: 'pending', title: 'Pending', color: 'bg-blue-500' },
  { id: 'onHold', title: 'ON HOLD', color: 'bg-red-600' },
  { id: 'finished', title: 'Finished', color: 'bg-emerald-500' },
  { id: 'delivered', title: 'Delivered', color: 'bg-cyan-500' },
  { id: 'waitingForPayment', title: 'Waiting For Payment', color: 'bg-amber-500' },
  { id: 'projectCompleted', title: 'Project Completed', color: 'bg-purple-500' },
];

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  jobs,
  boardType,
  onNavigate,
  onUpdateJobStatus,
  onCreateJob,
  onDeleteJob,
  isAdmin,
  currentUser: _currentUser,
}) => {
  const [draggedJob, setDraggedJob] = useState<Job | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [checklistStates, setChecklistStates] = useState<
    Record<string, { total: number; completed: number }>
  >({});
  const [columnMenuOpen, setColumnMenuOpen] = useState<string | null>(null);
  const [editingChecklistFor, setEditingChecklistFor] = useState<JobStatus | null>(null);
  const { showToast } = useToast();

  const canDragCards = boardType === 'shopFloor' || isAdmin;
  const columns = boardType === 'shopFloor' ? SHOP_FLOOR_COLUMNS : ADMIN_COLUMNS;

  // Load checklist states for all jobs
  useEffect(() => {
    loadChecklistStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadChecklistStates depends on jobs
  }, [jobs]);

  const loadChecklistStates = async () => {
    if (jobs.length === 0) {
      setChecklistStates({});
      return;
    }

    const states: Record<string, { total: number; completed: number }> = {};

    try {
      const jobIds = jobs.map((j) => j.id);
      const records = await Promise.all(jobIds.map((id) => checklistService.getByJob(id)));

      for (let i = 0; i < jobIds.length; i++) {
        const jobId = jobIds[i];
        const list = records[i] ?? [];
        for (const checklist of list) {
          const items = checklist.items ?? [];
          states[jobId] = {
            total: items.length,
            completed: items.filter((i) => i.checked).length,
          };
          break; // one status per job for display
        }
      }
    } catch (error) {
      console.error('Failed to load checklists:', error);
    }

    setChecklistStates(states);
  };

  const getJobsForColumn = (columnId: JobStatus) => {
    return jobs.filter((job) => {
      // Rush column - show rush jobs that aren't finished/delivered
      if (columnId === 'rush') {
        return job.isRush && job.status !== 'finished' && job.status !== 'delivered';
      }

      // Shop Floor board
      if (boardType === 'shopFloor') {
        // Show ALL jobs with matching status (regardless of boardType)
        // This prevents cards from disappearing when dragged
        return job.status === columnId && !job.isRush;
      }

      // Admin board - only show admin jobs
      if (boardType === 'admin') {
        return job.boardType === 'admin' && job.status === columnId && !job.isRush;
      }

      return false;
    });
  };

  const handleDragStart = (e: React.DragEvent, job: Job) => {
    setDraggedJob(job);
    e.dataTransfer.effectAllowed = 'move';
  };

  const checkChecklistComplete = async (jobId: string): Promise<boolean> => {
    try {
      const records = await checklistService.getByJob(jobId);
      if (records.length === 0) return true; // No checklist = allow move
      const checklist = records[0];
      const items = checklist.items || [];
      if (items.length === 0) return true; // Empty checklist = allow move
      const allComplete = items.every((item: { checked?: boolean }) => item.checked);
      return allComplete;
    } catch (error) {
      console.error('Failed to check checklist:', error);
      return true; // On error, allow move
    }
  };

  const handleDrop = async (e: React.DragEvent, columnId: JobStatus) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedJob || draggedJob.status === columnId) {
      setDraggedJob(null);
      return;
    }

    // CRITICAL: Prevent dragging non-rush jobs to Rush column
    if (columnId === 'rush' && !draggedJob.isRush) {
      showToast('Cannot move to Rush: open job, enable "Rush Job", then save', 'warning');
      setDraggedJob(null);
      return;
    }
    if (
      columnId !== 'rush' &&
      draggedJob.isRush &&
      columnId !== 'finished' &&
      columnId !== 'delivered'
    ) {
      showToast('Rush job must stay in Rush column; disable Rush in job edit to move', 'warning');
      setDraggedJob(null);
      return;
    }
    const checklistComplete = await checkChecklistComplete(draggedJob.id);
    if (!checklistComplete) {
      const checklistState = checklistStates[draggedJob.id];
      const msg = checklistState
        ? `Complete checklist first (${checklistState.completed}/${checklistState.total})`
        : 'Complete all checklist items before moving this job';
      showToast(msg, 'warning');
      setDraggedJob(null);
      return;
    }

    // Allow rush jobs to move to finished/delivered
    if ((columnId === 'finished' || columnId === 'delivered') && draggedJob.isRush) {
      await onUpdateJobStatus(draggedJob.id, columnId);
      setDraggedJob(null);
      return;
    }

    // Normal status change
    await onUpdateJobStatus(draggedJob.id, columnId);

    // BOARD SYNC LOGIC: Sync is handled by backend; these branches reserved for future client-side side effects.
    if (columnId === 'pending' && boardType === 'admin') {
      // Intentional no-op: visibility handled by backend
    }
    if (columnId === 'finished' && boardType === 'shopFloor') {
      // Intentional no-op: admin sync handled by backend
    }

    setDraggedJob(null);
  };

  const handleMenuClick = (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    setMenuOpenFor(menuOpenFor === jobId ? null : jobId);
  };

  const handleDelete = async () => {
    if (deleteConfirm && onDeleteJob) {
      await onDeleteJob(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  // Close menus on outside click
  useEffect(() => {
    if (menuOpenFor || columnMenuOpen) {
      const close = () => {
        setMenuOpenFor(null);
        setColumnMenuOpen(null);
      };
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }
  }, [menuOpenFor, columnMenuOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-[#1a1122] to-[#2d1f3d] pb-20">
      {/* Header - Streamlined */}
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-white/10 bg-background-dark/95 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex size-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <div>
              <h1 className="text-base font-bold text-white">
                {boardType === 'shopFloor' ? 'Shop Floor' : 'Admin'}
              </h1>
              <p className="text-[10px] text-slate-400">{jobs.length} jobs</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => onNavigate(boardType === 'shopFloor' ? 'board-admin' : 'board-shop')}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                {boardType === 'shopFloor' ? 'Admin' : 'Shop'}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={onCreateJob}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/90"
              >
                <span className="material-symbols-outlined text-base">add</span>
                <span>New</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Board */}
      <div
        className="flex-1 overflow-x-auto overflow-y-hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex h-full min-w-max gap-2.5 p-3">
          {columns.map((column) => {
            const columnJobs = getJobsForColumn(column.id);
            const isOver = dragOverColumn === column.id;

            return (
              <div
                key={column.id}
                className={`flex w-64 flex-col rounded-lg border bg-black/20 ${isOver ? 'border-primary bg-primary/10' : 'border-white/5'}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverColumn(column.id);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => handleDrop(e, column.id)}
              >
                {/* Column Header - Compact */}
                <div
                  className={`flex items-center justify-between rounded-t-lg px-2.5 py-2 ${column.color} relative`}
                >
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs font-bold text-white">{column.title}</h3>
                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {columnJobs.length}
                    </span>
                  </div>

                  {/* Admin Column Menu */}
                  {isAdmin && (
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setColumnMenuOpen(columnMenuOpen === column.id ? null : column.id);
                        }}
                        className="rounded p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <span className="material-symbols-outlined text-sm">more_vert</span>
                      </button>

                      {columnMenuOpen === column.id && (
                        <div className="absolute right-0 top-8 z-50 min-w-[180px] rounded-lg border border-white/20 bg-[#2a1f35] py-1 shadow-xl">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setColumnMenuOpen(null);
                              setEditingChecklistFor(column.id);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                          >
                            <span className="material-symbols-outlined text-sm">checklist</span>
                            Manage Checklist
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Cards */}
                <div
                  className="flex-1 space-y-1.5 overflow-y-auto p-1.5"
                  style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
                >
                  {columnJobs.map((job) => {
                    const checklistState = checklistStates[job.id];
                    const hasChecklist = checklistState && checklistState.total > 0;
                    const checklistComplete =
                      hasChecklist && checklistState.completed === checklistState.total;

                    return (
                      <div
                        key={job.id}
                        draggable={canDragCards}
                        onDragStart={(e) => canDragCards && handleDragStart(e, job)}
                        onClick={() => onNavigate('job-detail', job.id)}
                        className={`relative cursor-pointer rounded-lg border border-white/5 bg-[#2a1f35] p-2.5 transition-all hover:border-primary/30 hover:bg-[#3a2f45] active:scale-[0.98] ${draggedJob?.id === job.id ? 'opacity-50' : ''}`}
                      >
                        {/* Admin Menu Button */}
                        {isAdmin && (
                          <div className="absolute right-2 top-2">
                            <button
                              onClick={(e) => handleMenuClick(e, job.id)}
                              className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
                            >
                              <span className="material-symbols-outlined text-sm">more_vert</span>
                            </button>

                            {menuOpenFor === job.id && (
                              <div className="absolute right-0 top-7 z-50 min-w-[120px] rounded-lg border border-white/20 bg-[#2a1f35] py-1 shadow-xl">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpenFor(null);
                                    onNavigate('job-detail', job.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                                >
                                  <span className="material-symbols-outlined text-sm">edit</span>
                                  Edit
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpenFor(null);
                                    setDeleteConfirm(job.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Labels - Compact */}
                        <div className="mb-1.5 flex flex-wrap gap-1 pr-5">
                          {job.isRush && (
                            <span className="rounded bg-red-500 px-1 py-0.5 text-[10px] font-bold text-white">
                              Rush
                            </span>
                          )}
                        </div>

                        {/* Title - Compact */}
                        <h4 className="mb-0.5 line-clamp-2 pr-5 text-xs font-bold leading-tight text-white">
                          {job.po ? `PO# ${job.po}` : job.name}
                        </h4>
                        {job.po && (
                          <p className="mb-1.5 line-clamp-1 text-[10px] text-slate-300">
                            {job.name}
                          </p>
                        )}

                        {/* Footer - Compact */}
                        <div className="flex items-center justify-between border-t border-white/5 pt-1.5">
                          {job.dueDate && (
                            <div
                              className={`rounded px-1 py-0.5 text-[9px] ${new Date(job.dueDate) < new Date() ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-slate-400'}`}
                            >
                              {formatDateOnly(job.dueDate).replace(/, \d{4}/, '')}
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            {hasChecklist && (
                              <span
                                className={`flex items-center gap-0.5 text-[9px] ${checklistComplete ? 'text-green-400' : 'text-slate-400'}`}
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: '11px' }}
                                >
                                  checklist
                                </span>
                                {checklistState.completed}/{checklistState.total}
                              </span>
                            )}
                            {job.commentCount > 0 && (
                              <span className="flex items-center gap-0.5 text-[9px] text-slate-500">
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: '11px' }}
                                >
                                  comment
                                </span>
                                {job.commentCount}
                              </span>
                            )}
                            {job.attachmentCount > 0 && (
                              <span className="flex items-center gap-0.5 text-[9px] text-slate-500">
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: '11px' }}
                                >
                                  attach_file
                                </span>
                                {job.attachmentCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#1a1122] p-6">
            <h3 className="mb-2 text-lg font-bold text-white">Delete Job?</h3>
            <p className="mb-6 text-sm text-slate-400">This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-xl bg-white/10 py-3 font-bold text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 rounded-xl bg-red-500 py-3 font-bold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checklist Editor Modal */}
      {editingChecklistFor && (
        <ChecklistEditorModal
          status={editingChecklistFor}
          onClose={() => setEditingChecklistFor(null)}
          currentUser={_currentUser}
          onChecklistUpdated={() => {
            // Reload checklist states after update
            loadChecklistStates();
          }}
        />
      )}
    </div>
  );
};

// Inline Checklist Editor Component
interface ChecklistEditorModalProps {
  status: JobStatus;
  onClose: () => void;
  currentUser: User;
  onChecklistUpdated: () => void;
}

const ChecklistEditorModal: React.FC<ChecklistEditorModalProps> = ({
  status,
  onClose,
  currentUser: _currentUser,
  onChecklistUpdated,
}) => {
  const { showToast } = useToast();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [newItemText, setNewItemText] = useState('');
  const [saving, setSaving] = useState(false);

  const STATUS_LABELS: Record<JobStatus, string> = {
    pending: 'Pending',
    rush: 'Rush',
    inProgress: 'In Progress',
    qualityControl: 'Quality Control',
    finished: 'Finished',
    delivered: 'Delivered',
    onHold: 'On Hold',
    toBeQuoted: 'To Be Quoted',
    quoted: 'Quoted',
    rfqReceived: 'RFQ Received',
    rfqSent: 'RFQ Sent',
    pod: "PO'd",
    waitingForPayment: 'Waiting For Payment',
    projectCompleted: 'Project Completed',
  };

  useEffect(() => {
    loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadChecklist depends on status
  }, [status]);

  const loadChecklist = async () => {
    try {
      const templates = await checklistService.getTemplates();
      const found = templates.find((c) => c.status === status);
      setChecklist(found ?? null);
    } catch (error) {
      console.error('Failed to load checklist:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateChecklist = async () => {
    setSaving(true);
    try {
      const record = await checklistService.create({ job_id: null, status, items: [] });
      if (record) setChecklist(record);
      onChecklistUpdated();
    } catch (error) {
      console.error('Failed to create checklist:', error);
      showToast('Failed to create checklist', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddItem = async () => {
    if (!checklist || !newItemText.trim()) return;

    const newItem = {
      id: `item_${Date.now()}`,
      text: newItemText.trim(),
      checked: false,
    };

    const updatedItems = [...(checklist.items || []), newItem];

    setSaving(true);
    try {
      await checklistService.update(checklist.id, { items: updatedItems });
      setChecklist({ ...checklist, items: updatedItems } as Checklist);
      setNewItemText('');
      onChecklistUpdated();
    } catch (error) {
      console.error('Failed to add item:', error);
      showToast('Failed to add item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!checklist) return;

    const updatedItems = checklist.items.filter((item: { id: string }) => item.id !== itemId);

    setSaving(true);
    try {
      await checklistService.update(checklist.id, { items: updatedItems });
      setChecklist({ ...checklist, items: updatedItems } as Checklist);
      onChecklistUpdated();
    } catch (error) {
      console.error('Failed to delete item:', error);
      showToast('Failed to delete item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReorderItem = async (fromIndex: number, direction: 'up' | 'down') => {
    if (!checklist) return;

    const items = [...checklist.items];
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;

    if (toIndex < 0 || toIndex >= items.length) return;

    [items[fromIndex], items[toIndex]] = [items[toIndex], items[fromIndex]];

    setSaving(true);
    try {
      await checklistService.update(checklist.id, { items });
      setChecklist({ ...checklist, items } as Checklist);
      onChecklistUpdated();
    } catch (error) {
      console.error('Failed to reorder items:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-card-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h2 className="font-bold text-white">Checklist: {STATUS_LABELS[status]}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="max-h-[calc(80vh-80px)] overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-slate-400">Loading...</p>
          ) : !checklist ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-slate-400">No checklist exists for this status yet.</p>
              <button
                onClick={handleCreateChecklist}
                disabled={saving}
                className="rounded-lg bg-primary px-6 py-2 font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Checklist'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Add Item */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <label className="mb-2 block text-xs font-bold uppercase text-slate-400">
                  Add New Item
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddItem()}
                    placeholder="Enter checklist item..."
                    className="flex-1 rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleAddItem}
                    disabled={!newItemText.trim() || saving}
                    className="rounded bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase text-slate-400">
                  Checklist Items ({checklist.items?.length || 0})
                </h3>
                {!checklist.items || checklist.items.length === 0 ? (
                  <p className="py-8 text-center text-slate-500">No items yet. Add items above.</p>
                ) : (
                  checklist.items.map(
                    (item: { id: string; text?: string; checked?: boolean }, index: number) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
                      >
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleReorderItem(index, 'up')}
                            disabled={index === 0 || saving}
                            className="text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <span className="material-symbols-outlined text-sm">arrow_upward</span>
                          </button>
                          <button
                            onClick={() => handleReorderItem(index, 'down')}
                            disabled={index === checklist.items.length - 1 || saving}
                            className="text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <span className="material-symbols-outlined text-sm">
                              arrow_downward
                            </span>
                          </button>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-white">{item.text}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          disabled={saving}
                          className="text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    )
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KanbanBoard;
