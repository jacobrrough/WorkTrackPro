import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Job, JobStatus, ViewState, User, Checklist, InventoryItem } from '@/core/types';
import { formatDateOnly } from '@/core/date';
import { formatJobCode, getJobDisplayName, formatJobIdentityLine } from '@/lib/formatJob';
import { checklistService } from './pocketbase';
import { useToast } from './Toast';
import { useNavigation } from '@/contexts/NavigationContext';
import { useThrottle } from '@/useThrottle';
import QRScanner from './components/QRScanner';

interface KanbanBoardProps {
  jobs: Job[];
  boardType: 'shopFloor' | 'admin';
  onNavigate: (view: ViewState, jobId?: string) => void;
  onUpdateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  onUpdateJob?: (jobId: string, updates: Partial<Job>) => Promise<void>;
  onCreateJob: () => void;
  onDeleteJob?: (jobId: string) => Promise<void>;
  isAdmin: boolean;
  currentUser: User;
  inventory?: InventoryItem[];
}

const SHOP_FLOOR_COLUMNS: { id: JobStatus; title: string; color: string }[] = [
  { id: 'pending', title: 'Pending', color: 'bg-pink-500' },
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
];

// Jobs with status 'paid' are reconciled and hidden from normal board/list views
const excludePaid = (jobs: Job[]) => jobs.filter((j) => j.status !== 'paid');
const normalizeLegacyRushStatus = (status: JobStatus): JobStatus =>
  status === 'rush' ? 'pending' : status;

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  jobs: allJobs,
  boardType,
  onNavigate,
  onUpdateJobStatus,
  onUpdateJob,
  onCreateJob,
  onDeleteJob,
  isAdmin,
  currentUser: _currentUser,
  inventory: _inventory = [],
}) => {
  const jobs = useMemo(() => excludePaid(allJobs), [allJobs]);
  const { state: navState, updateState } = useNavigation();
  const [draggedJob, setDraggedJob] = useState<Job | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [checklistStates, setChecklistStates] = useState<
    Record<string, { total: number; completed: number }>
  >({});
  const [checklistRefreshTrigger, setChecklistRefreshTrigger] = useState(0);
  const [columnMenuOpen, setColumnMenuOpen] = useState<string | null>(null);
  const [editingChecklistFor, setEditingChecklistFor] = useState<JobStatus | null>(null);
  const [scanningBinForJob, setScanningBinForJob] = useState<string | null>(null);
  const { showToast } = useToast();

  // Refs for column scroll containers and horizontal board container
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const boardTouchStateRef = useRef({
    active: false,
    isHorizontalSwipe: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
  });
  const scrollPositionsRef = useRef(navState.scrollPositions);

  // HTML5 drag-and-drop on touch devices can hijack swipe gestures; keep drag for fine pointers.
  const supportsFinePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const canDragCards = (boardType === 'shopFloor' || isAdmin) && supportsFinePointer;
  const columns = boardType === 'shopFloor' ? SHOP_FLOOR_COLUMNS : ADMIN_COLUMNS;
  const boardViewKey = `kanban-board-${boardType}`;
  const horizontalScrollKey = `${boardViewKey}-horizontal`;

  // Update scroll positions ref when navState changes
  useEffect(() => {
    scrollPositionsRef.current = navState.scrollPositions;
  }, [navState.scrollPositions]);

  // Restore scroll positions only on mount/return (NOT when scrollPositions updates, or scrolling would re-trigger restore and cause jumpiness)
  const scrollPositionsSnapshot = useRef(navState.scrollPositions);
  useEffect(() => {
    scrollPositionsSnapshot.current = navState.scrollPositions;
  }, [navState.scrollPositions]);

  useEffect(() => {
    const positions = scrollPositionsSnapshot.current;
    const timeoutId = setTimeout(() => {
      const savedHorizontalScroll = positions[horizontalScrollKey];
      if (
        boardContainerRef.current &&
        savedHorizontalScroll !== undefined &&
        savedHorizontalScroll > 0
      ) {
        boardContainerRef.current.scrollLeft = savedHorizontalScroll;
      }
      columns.forEach((column) => {
        const columnKey = `${boardViewKey}-${column.id}`;
        const savedPosition = positions[columnKey];
        const container = columnRefs.current[column.id];
        if (container && savedPosition !== undefined && savedPosition > 0) {
          container.scrollTop = savedPosition;
        }
      });
    }, 80);

    return () => clearTimeout(timeoutId);
    // Intentionally exclude navState.scrollPositions so we only restore on mount/board switch, not on every scroll save
  }, [boardViewKey, horizontalScrollKey, columns]);

  // Throttled horizontal scroll handler for board container
  const handleHorizontalScroll = useThrottle(() => {
    if (!boardContainerRef.current) return;
    updateState({
      scrollPositions: {
        ...scrollPositionsRef.current,
        [horizontalScrollKey]: boardContainerRef.current.scrollLeft,
      },
    });
  }, 100);

  // Throttled vertical scroll handler for columns
  const handleColumnScroll = useThrottle(
    (e: React.UIEvent<HTMLDivElement>, columnId: JobStatus) => {
      const container = e.currentTarget;
      if (!container) return;

      const columnKey = `${boardViewKey}-${columnId}`;
      updateState({
        scrollPositions: {
          ...scrollPositionsRef.current,
          [columnKey]: container.scrollTop,
        },
      });
    },
    100
  );

  const handleBoardTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!boardContainerRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    boardTouchStateRef.current.active = true;
    boardTouchStateRef.current.isHorizontalSwipe = false;
    boardTouchStateRef.current.startX = touch.clientX;
    boardTouchStateRef.current.startY = touch.clientY;
    boardTouchStateRef.current.startScrollLeft = boardContainerRef.current.scrollLeft;
  };

  const handleBoardTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!boardContainerRef.current || e.touches.length !== 1) return;
    const touchState = boardTouchStateRef.current;
    if (!touchState.active) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchState.startX;
    const deltaY = touch.clientY - touchState.startY;

    if (!touchState.isHorizontalSwipe) {
      if (Math.abs(deltaX) < 8) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) {
        touchState.active = false;
        return;
      }
      touchState.isHorizontalSwipe = true;
    }

    if (e.cancelable) e.preventDefault();
    boardContainerRef.current.scrollLeft = touchState.startScrollLeft - deltaX;
    handleHorizontalScroll();
  };

  const handleBoardTouchEnd = () => {
    boardTouchStateRef.current.active = false;
    boardTouchStateRef.current.isHorizontalSwipe = false;
  };

  // Stable key so effect only runs when the set of job IDs changes (avoids infinite loop from new jobs array ref each render)
  const jobIdsKey =
    jobs.length === 0
      ? ''
      : jobs
          .map((j) => j.id)
          .sort()
          .join(',');

  // Load checklist states for all jobs
  useEffect(() => {
    if (jobs.length === 0) {
      setChecklistStates({});
      return;
    }

    let cancelled = false;
    const jobIds = jobs.map((j) => j.id);

    checklistService
      .getByJobIds(jobIds)
      .then((byJob) => {
        if (cancelled) return;
        const states: Record<string, { total: number; completed: number }> = {};
        for (const jobId of jobIds) {
          const list = byJob[jobId] ?? [];
          for (const checklist of list) {
            const items = checklist.items ?? [];
            states[jobId] = {
              total: items.length,
              completed: items.filter((i: { checked?: boolean }) => i.checked).length,
            };
            break; // one status per job for display
          }
        }
        setChecklistStates(states);
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to load checklists:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [jobIdsKey, checklistRefreshTrigger, jobs]);

  const sortColumnJobs = (columnJobs: Job[]) => {
    return [...columnJobs].sort((a, b) => {
      if (a.isRush !== b.isRush) {
        return a.isRush ? -1 : 1;
      }

      const aTargetDate = a.ecd || a.dueDate;
      const bTargetDate = b.ecd || b.dueDate;
      if (aTargetDate && bTargetDate && aTargetDate !== bTargetDate) {
        return aTargetDate.localeCompare(bTargetDate);
      }
      if (aTargetDate && !bTargetDate) return -1;
      if (!aTargetDate && bTargetDate) return 1;
      return (a.jobCode ?? 0) - (b.jobCode ?? 0);
    });
  };

  const getJobsForColumn = (columnId: JobStatus) => {
    const columnJobs = jobs.filter((job) => {
      const effectiveStatus = normalizeLegacyRushStatus(job.status);
      if (effectiveStatus !== columnId) return false;
      if (boardType === 'shopFloor') return true;
      if (boardType === 'admin') return job.boardType === 'admin';
      return false;
    });
    return sortColumnJobs(columnJobs);
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

    if (!draggedJob) {
      setDraggedJob(null);
      return;
    }
    const draggedEffectiveStatus = normalizeLegacyRushStatus(draggedJob.status);
    if (draggedEffectiveStatus === columnId && draggedJob.status !== 'rush') {
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
    e.preventDefault();
    // Close other menus first
    if (menuOpenFor && menuOpenFor !== jobId) {
      setMenuOpenFor(null);
      // Small delay to prevent immediate reopening
      setTimeout(() => setMenuOpenFor(jobId), 10);
    } else {
      setMenuOpenFor(menuOpenFor === jobId ? null : jobId);
    }
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
      const close = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Don't close if clicking inside a menu or menu button
        if (
          target.closest('[aria-label="Job menu"]') ||
          target.closest('.z-\\[100\\]') ||
          target.closest('[role="dialog"]')
        ) {
          return;
        }
        setMenuOpenFor(null);
        setColumnMenuOpen(null);
      };
      // Use mousedown instead of click to catch events earlier
      document.addEventListener('mousedown', close);
      return () => document.removeEventListener('mousedown', close);
    }
  }, [menuOpenFor, columnMenuOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-[#1a1122] to-[#2d1f3d] pb-20">
      {/* Header - Streamlined */}
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-white/10 bg-background-dark/95 px-3 py-2 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex size-9 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
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
            <button
              onClick={() => updateState({ minimalView: !navState.minimalView })}
              className="flex items-center gap-1 rounded-sm bg-white/10 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              title="Toggle minimal view"
            >
              <span className="material-symbols-outlined text-sm">
                {navState.minimalView ? 'view_agenda' : 'view_compact'}
              </span>
            </button>
            {isAdmin && (
              <button
                onClick={() => onNavigate(boardType === 'shopFloor' ? 'board-admin' : 'board-shop')}
                className="rounded-sm bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                {boardType === 'shopFloor' ? 'Admin' : 'Shop'}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={onCreateJob}
                className="flex items-center gap-1 rounded-sm bg-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/90"
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
        ref={boardContainerRef}
        onScroll={handleHorizontalScroll}
        onTouchStart={handleBoardTouchStart}
        onTouchMove={handleBoardTouchMove}
        onTouchEnd={handleBoardTouchEnd}
        onTouchCancel={handleBoardTouchEnd}
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
                className={`flex w-64 flex-col rounded-sm border bg-black/20 ${isOver ? 'border-primary bg-primary/10' : 'border-white/5'}`}
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
                    <span className="rounded-sm bg-white/20 px-1.5 py-0.5 text-[10px] font-bold text-white">
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
                        <div className="absolute right-0 top-8 z-50 min-w-[180px] rounded-sm border border-white/20 bg-[#2a1f35] py-1 shadow-xl">
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
                  ref={(el) => {
                    columnRefs.current[column.id] = el;
                  }}
                  onScroll={(e) => handleColumnScroll(e, column.id)}
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
                        onClick={(e) => {
                          // Don't navigate if clicking on menu or menu is open
                          if (
                            menuOpenFor === job.id ||
                            (e.target as HTMLElement).closest('[aria-label="Job menu"]')
                          ) {
                            return;
                          }
                          onNavigate('job-detail', job.id);
                        }}
                        className={`relative cursor-pointer rounded-sm border border-white/5 bg-[#2a1f35] p-2.5 transition-all hover:border-primary/30 hover:bg-[#3a2f45] active:scale-[0.98] ${draggedJob?.id === job.id ? 'opacity-50' : ''} ${menuOpenFor === job.id ? 'z-40' : ''}`}
                      >
                        <div className="mb-1 flex items-start gap-2">
                          {/* Job identity: Part Number, Rev, Part Name, Qty, EST #, RFQ #, PO #, INV# */}
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-white">
                              {formatJobCode(job.jobCode)}
                            </span>
                            {job.isRush && (
                              <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                Rush
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {/* Scan Bin Location Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setScanningBinForJob(job.id);
                              }}
                              className="flex size-7 items-center justify-center rounded border border-primary/30 bg-primary/20 text-primary transition-colors hover:bg-primary/30 active:bg-primary/40"
                              title="Scan bin location"
                            >
                              <span className="material-symbols-outlined text-base">
                                qr_code_scanner
                              </span>
                            </button>

                            {/* Admin Menu Button */}
                            {isAdmin && (
                              <div className="relative z-10">
                                <button
                                  onClick={(e) => handleMenuClick(e, job.id)}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className="flex size-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-white active:bg-white/20"
                                  aria-label="Job menu"
                                >
                                  <span className="material-symbols-outlined text-base">
                                    more_vert
                                  </span>
                                </button>

                                {menuOpenFor === job.id && (
                                  <div
                                    className="absolute right-0 top-8 z-[100] min-w-[140px] rounded-sm border border-white/20 bg-[#2a1f35] py-1 shadow-2xl backdrop-blur-sm"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setMenuOpenFor(null);
                                        onNavigate('job-detail', job.id);
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/10 active:bg-white/20"
                                    >
                                      <span className="material-symbols-outlined text-base">
                                        edit
                                      </span>
                                      Edit
                                    </button>
                                    {job.status === 'waitingForPayment' && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          setMenuOpenFor(null);
                                          onUpdateJobStatus(job.id, 'paid');
                                          showToast('Job marked as Paid and reconciled', 'success');
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-green-400 transition-colors hover:bg-green-500/10 active:bg-green-500/20"
                                      >
                                        <span className="material-symbols-outlined text-base">
                                          payments
                                        </span>
                                        Mark as Paid
                                      </button>
                                    )}
                                    <div className="my-1 border-t border-white/10" />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setMenuOpenFor(null);
                                        setDeleteConfirm(job.id);
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10 active:bg-red-500/20"
                                    >
                                      <span className="material-symbols-outlined text-base">
                                        delete
                                      </span>
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <p className="mb-1 text-sm font-medium text-slate-300">
                          {formatJobIdentityLine(job) || getJobDisplayName(job) || '—'}
                        </p>

                        {/* Priority 3: ECD / Due date */}
                        <p className="mb-1.5">
                          {(job.ecd || job.dueDate) && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${job.dueDate && new Date(job.dueDate) < new Date() ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-slate-400'}`}
                            >
                              {formatDateOnly(job.ecd || job.dueDate).replace(/, \d{4}/, '')}
                            </span>
                          )}
                        </p>

                        {/* Footer - checklist / comment / attachment counts */}
                        <div className="flex items-center justify-between border-t border-white/5 pt-1.5">
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
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDeleteConfirm(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className="w-full max-w-sm rounded-sm border border-white/10 bg-[#1a1122] p-4 shadow-2xl">
            <h3 id="delete-dialog-title" className="mb-2 text-lg font-bold text-white">
              Delete Job?
            </h3>
            <p className="mb-4 text-sm text-slate-400">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(null);
                }}
                className="flex-1 rounded-sm bg-white/10 py-3 font-bold text-white transition-colors hover:bg-white/20 active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
                className="flex-1 rounded-sm bg-red-500 py-3 font-bold text-white transition-colors hover:bg-red-600 active:scale-[0.98]"
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
            setChecklistRefreshTrigger((t) => t + 1);
          }}
        />
      )}

      {/* Bin Location Scanner */}
      {scanningBinForJob && (
        <QRScanner
          scanType="bin"
          onScanComplete={async (binLocation) => {
            if (onUpdateJob) {
              try {
                await onUpdateJob(scanningBinForJob, { binLocation });
                showToast(`Bin location updated: ${binLocation}`, 'success');
              } catch {
                showToast('Failed to update bin location', 'error');
              }
            } else {
              // Navigate to job detail where they can save
              showToast(`Scanned bin: ${binLocation}`, 'info');
              onNavigate('job-detail', scanningBinForJob);
            }
            setScanningBinForJob(null);
          }}
          onClose={() => setScanningBinForJob(null)}
          currentValue={jobs.find((j) => j.id === scanningBinForJob)?.binLocation}
          title="Scan Bin Location"
          description="Scan QR code on bin location"
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
    paid: 'Paid',
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
        className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-sm border border-white/10 bg-card-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-3">
          <h2 className="font-bold text-white">Checklist: {STATUS_LABELS[status]}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="max-h-[calc(80vh-80px)] overflow-y-auto p-3">
          {loading ? (
            <p className="py-8 text-center text-slate-400">Loading...</p>
          ) : !checklist ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-slate-400">No checklist exists for this status yet.</p>
              <button
                onClick={handleCreateChecklist}
                disabled={saving}
                className="rounded-sm bg-primary px-4 py-1.5 font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Checklist'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Add Item */}
              <div className="rounded-sm border border-white/10 bg-white/5 p-3">
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
                        className="flex items-center gap-3 rounded-sm border border-white/10 bg-white/5 p-3"
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
