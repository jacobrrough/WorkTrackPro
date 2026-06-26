import React, {
  Suspense,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  Job,
  ViewState,
  Shift,
  InventoryItem,
  User,
  Comment,
  JobStatus,
  Attachment,
  JobPartLink,
} from '@/core/types';
import { ACCOUNTING_BUILD_ENABLED } from './lib/featureFlags';
import { lazyWithRetry } from './lib/lazyWithRetry';

// Billing surfaces live in the accounting module and mount LAZILY so a flag-off build
// contains zero accounting code (same dead-ternary seam as AppRouter's AccountingRouter).
const JobBillingPanel = ACCOUNTING_BUILD_ENABLED
  ? lazyWithRetry(() => import('./features/accounting/jobs/JobBillingPanel'), 'JobBillingPanel')
  : null;
const JobCustomerSelect = ACCOUNTING_BUILD_ENABLED
  ? lazyWithRetry(() => import('./features/accounting/jobs/JobCustomerSelect'), 'JobCustomerSelect')
  : null;
// EST#/INV# pills that resolve to the real estimate/invoice documents (+ customer). Lazy +
// flag-gated like the panels above; PlainEstInvPills is the accounting-free fallback used when
// the flag is off, the chunk is loading, or a number doesn't resolve.
const JobReferencePills = ACCOUNTING_BUILD_ENABLED
  ? lazyWithRetry(() => import('./features/accounting/jobs/JobReferencePills'), 'JobReferencePills')
  : null;
// Inline "link this typed EST#/INV# to the real estimate/invoice" suggestion, shown in the edit
// form as the numbers are typed. Lazy + flag-gated like JobReferencePills.
const JobDocLinkSuggestion = ACCOUNTING_BUILD_ENABLED
  ? lazyWithRetry(
      () => import('./features/accounting/jobs/JobDocLinkSuggestion'),
      'JobDocLinkSuggestion'
    )
  : null;

function PlainEstInvPills({
  estNumber,
  invNumber,
}: {
  estNumber?: string | null;
  invNumber?: string | null;
}) {
  return (
    <>
      {estNumber && (
        <span className="rounded bg-purple-500/20 px-2 py-1 text-xs font-medium text-purple-300">
          EST #{estNumber}
        </span>
      )}
      {invNumber && (
        <span className="rounded bg-green-500/20 px-2 py-1 text-xs font-medium text-green-300">
          INV# {invNumber}
        </span>
      )}
    </>
  );
}
import { jobService } from './pocketbase';
import FileUploadButton from './FileUploadButton';
import FileViewer from './FileViewer';
import AttachmentsList from './AttachmentsList';
import BinLocationScanner from './BinLocationScanner';
import ChecklistDisplay from './ChecklistDisplay';
import { formatDateOnly, isoToDateInput, dateInputToISO } from '@/core/date';
import { formatDurationHMS, formatDurationHours } from './lib/timeUtils';
import { getWorkedShiftMs } from './lib/lunchUtils';
import { useToast } from './Toast';
import { StatusBadge } from './components/ui/StatusBadge';
import { calculateJobHoursFromShifts, getLaborSuggestion } from './lib/laborSuggestion';
import {
  formatJobCode,
  formatDashSummary,
  totalFromDashQuantities,
  formatSetComposition,
  getJobNameForSave,
  sanitizeReferenceValue,
  calculateSetCompletion,
} from './lib/formatJob';
import { partsService } from './services/api/parts';
import { Part, PartVariant } from '@/core/types';
import { useNavigation } from '@/contexts/NavigationContext';
import { useSettings } from '@/contexts/SettingsContext';
import type { ClockPunchResult } from '@/core/clockPunch';
import { useClockIn } from '@/contexts/ClockInContext';
import { useLocation } from 'react-router-dom';
import { useThrottle } from '@/useThrottle';
import {
  syncJobInventoryFromPart,
  syncJobInventoryFromParts,
  computeRequiredMaterials,
  type PartWithDashQuantities,
} from '@/lib/partsCalculations';
import { syncPartMaterialFromJobQuantity, type MaterialSyncScope } from '@/lib/materialFromPart';
import { buildPartVariantDefaults, computeVariantBreakdown } from '@/lib/variantAllocation';
import {
  isPartsEditingAllowed,
  getPartsLockedReason,
  getNextWorkflowStatus,
} from '@/lib/jobWorkflow';
import { useApp } from '@/AppContext';
import { UnitProgressAccordion } from '@/features/jobs/components/UnitProgressAccordion';
import { buildDistributedBom, unitCountsByVariant, cncableVariantKeys } from '@/lib/cncDeduction';
import { logUnitProgress } from '@/services/api/unitProgress';
import { getDashQuantity, normalizeDashQuantities, toDashSuffix } from '@/lib/variantMath';
import { buildEffectivePartQuantities } from '@/lib/effectivePartQuantities';
import { canViewJobFinancials, shouldComputeJobFinancials } from '@/lib/priceVisibility';
import { calculateJobPriceFromPart, calculateJobPriceFromParts } from '@/lib/jobPriceFromPart';
import { useMaterialSync } from '@/features/jobs/hooks/useMaterialSync';
import {
  useMaterialCosts,
  computePartDerivedMaterialTotal,
} from '@/features/jobs/hooks/useMaterialCosts';
import { useVariantBreakdown } from '@/features/jobs/hooks/useVariantBreakdown';
import { buildNoVariantMachineBreakdown } from '@/features/jobs/hooks/variantBreakdownUtils';
import { getMachineTotalsFromJob } from '@/lib/machineHours';
import { computeJobCompletionProgress } from '@/lib/jobProgress';
import JobComments from '@/features/jobs/components/JobComments';
import DeliveriesSection from '@/features/deliveries/DeliveriesSection';
import JobStatusHistory from '@/features/jobs/components/JobStatusHistory';
import JobInventory from '@/features/jobs/components/JobInventory';
import JobDetailHeaderBar from '@/features/jobs/components/JobDetailHeaderBar';
import { LaborSuggestion } from '@/features/jobs/components/LaborSuggestion';
import { MachineCompletionSection } from '@/features/jobs/components/MachineCompletionSection';
import { ProgressEstimateInput } from '@/features/jobs/components/ProgressEstimateInput';
import { VariantBreakdown } from '@/features/jobs/components/VariantBreakdown';
import ConfirmDialog from './ConfirmDialog';
import PartSelector from '@/components/PartSelector';

interface JobDetailProps {
  job: Job;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  isClockedIn: boolean;
  onClockIn: () => void | Promise<ClockPunchResult>;
  onClockOut: () => void | Promise<ClockPunchResult>;
  activeShift: Shift | null;
  inventory: InventoryItem[];
  jobs: Job[]; // For labor hours suggestion
  shifts: Shift[]; // For labor hours suggestion
  onAddComment: (jobId: string, text: string) => Promise<Comment | null>;
  onAddInventory: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    unit: string
  ) => Promise<void>;
  onRemoveInventory: (jobId: string, jobInventoryId: string) => Promise<void>;
  onUpdateJob: (jobId: string, data: Partial<Job>) => Promise<Job | null>;
  onDeleteJob: (jobId: string) => Promise<boolean>;
  onReloadJob?: () => Promise<void>;
  currentUser: User;
  onAddAttachment: (jobId: string, file: File, isAdminOnly?: boolean) => Promise<boolean>;
  onDeleteAttachment: (attachmentId: string) => Promise<boolean>;
  onUpdateAttachmentAdminOnly?: (attachmentId: string, isAdminOnly: boolean) => Promise<boolean>;
  calculateAvailable: (item: InventoryItem) => number;
}

// All available statuses for editing
const ALL_STATUSES: { id: JobStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'inProgress', label: 'In Progress' },
  { id: 'qualityControl', label: 'Quality Control' },
  { id: 'finished', label: 'Finished' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'onHold', label: 'On Hold' },
  { id: 'toBeQuoted', label: 'To Be Quoted' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'rfqReceived', label: 'RFQ Received' },
  { id: 'rfqSent', label: 'RFQ Sent' },
  { id: 'pod', label: "PO'd" },
  { id: 'waitingForPayment', label: 'Waiting For Payment' },
  { id: 'projectCompleted', label: 'Project Completed' },
];
const normalizeLegacyRushStatus = (status: JobStatus): JobStatus =>
  status === 'rush' ? 'pending' : status;

function getMachineOverrideFromJob(
  job: Job
): Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }> {
  const out: Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }> = {};
  for (const [suffix, entry] of Object.entries(job.machineBreakdownByVariant ?? {})) {
    const cncRaw = Number(entry.cncHoursPerUnit);
    const printerRaw = Number(entry.printer3DHoursPerUnit);
    out[toDashSuffix(suffix)] = {
      cncHoursPerUnit: Number.isFinite(cncRaw) ? cncRaw : undefined,
      printer3DHoursPerUnit: Number.isFinite(printerRaw) ? printerRaw : undefined,
    };
  }
  return out;
}

/** Returns the toast message shown when a BOM sync is skipped because the job is consumed. */
function bomSyncSkippedMessage(job: { jobCode: number; status: string }): string {
  const label = job.status === 'delivered' ? 'delivered' : 'finished';
  return `BOM changes won't sync to Job #${job.jobCode} — it's already ${label}.`;
}

const JobDetail: React.FC<JobDetailProps> = ({
  job,
  onNavigate,
  onBack,
  isClockedIn,
  onClockIn,
  onClockOut,
  activeShift,
  inventory,
  jobs,
  shifts,
  onAddComment,
  onAddInventory,
  onRemoveInventory,
  onUpdateJob,
  onDeleteJob,
  onReloadJob,
  currentUser,
  onAddAttachment,
  onDeleteAttachment,
  onUpdateAttachmentAdminOnly,
  calculateAvailable,
}) => {
  const clockInCtx = useClockIn();
  const { advanceJobToNextStatus, users } = useApp();
  const { showToast } = useToast();
  const handleClockIn = useCallback(async () => {
    const applyResult = (r: ClockPunchResult) => {
      if (r.ok) showToast('Clocked in', 'success');
      else if (r.authExpired) showToast('Session expired — please log in again', 'error');
      else if (r.queued) showToast('Saved offline — will sync when connected', 'warning');
      else showToast('Failed to clock in', 'error');
    };
    if (clockInCtx?.clockIn) {
      const r = await clockInCtx.clockIn(job.id);
      applyResult(r);
      return;
    }
    const r = await onClockIn();
    if (r && typeof r === 'object' && 'ok' in r) applyResult(r as ClockPunchResult);
  }, [clockInCtx, job.id, onClockIn, showToast]);

  const handleClockOut = useCallback(async () => {
    const r = await onClockOut();
    if (r && typeof r === 'object' && 'ok' in r) {
      const result = r as ClockPunchResult;
      if (result.ok) showToast('Clocked out successfully', 'success');
      else if (result.queued) showToast('Saved offline — will sync when connected', 'warning');
      else showToast('Failed to clock out', 'error');
    }
  }, [onClockOut, showToast]);

  const handleChecklistComplete = useCallback(async () => {
    // advanceJobToNextStatus returns false for several reasons. Most are silent by
    // design: intentional no-ops (onHold/rush or a terminal status have no next step)
    // and real failures already surface a specific toast from updateJobStatus
    // (useJobMutations.ts) — re-toasting here would double up. The one false-return
    // that is BOTH actionable AND silent is a non-admin completing the
    // projectCompleted → paid checklist: the hook refuses before calling
    // updateJobStatus, so the worker gets no feedback. Detect exactly that case
    // (using the same workflow + admin checks the hook applies) and explain it; for
    // every other path, defer to the hook's own messaging and just reload.
    const blockedPaidAdvance = getNextWorkflowStatus(job.status) === 'paid' && !currentUser.isAdmin;
    if (blockedPaidAdvance) {
      showToast('Only an admin can mark this job as paid.', 'warning');
    } else {
      await advanceJobToNextStatus(job.id);
    }
    await onReloadJob?.();
  }, [advanceJobToNextStatus, job.id, job.status, currentUser.isAdmin, onReloadJob, showToast]);

  const [timer, setTimer] = useState('00:00:00');
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [syncingMaterials, setSyncingMaterials] = useState(false);
  const [attachmentAdminOverrides, setAttachmentAdminOverrides] = useState<Record<string, boolean>>(
    {}
  );
  const [pendingAttachmentToggleCount, setPendingAttachmentToggleCount] = useState(0);
  const pendingAttachmentTogglesRef = useRef<Set<Promise<void>>>(new Set());
  /** True when labor hours were auto-filled from part (show "auto" marker until user edits) */
  const [laborHoursFromPart, setLaborHoursFromPart] = useState(false);
  const canViewFinancials = canViewJobFinancials(currentUser.isAdmin);
  // File viewing state
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  /** Part drawings: files standard users can access on job cards */
  const [partDrawings, setPartDrawings] = useState<Attachment[]>([]);

  // Bin location state
  const [showBinLocationScanner, setShowBinLocationScanner] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteJobConfirm, setShowDeleteJobConfirm] = useState(false);
  const [isDeletingJob, setIsDeletingJob] = useState(false);
  const [showAddPartToJob, setShowAddPartToJob] = useState(false);
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);
  const editSeedRef = useRef<string | null>(null);
  // Edit-mode Description textarea: starts at a comfortable minimum height and
  // grows to fit its content (so long descriptions don't get crammed into 2 rows).
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const autosizeDescription = useCallback(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  const [linkedPart, setLinkedPart] = useState<Part | null>(null);
  /** When job.parts?.length > 1, loaded Part entities for each link (same order as job.parts). */
  const [linkedParts, setLinkedParts] = useState<(Part | null)[] | null>(null);
  const [, setLoadingPart] = useState(false);
  const [partNumberSearch, setPartNumberSearch] = useState(job.partNumber || '');
  const [selectedVariant, setSelectedVariant] = useState<PartVariant | null>(null);
  const { settings } = useSettings();
  const laborRate = settings.laborRate;
  const materialUpcharge = settings.materialUpcharge;
  const cncRate = settings.cncRate;
  const printer3DRate = settings.printer3DRate;
  const location = useLocation();
  const { state: navState, updateState } = useNavigation();
  const partsLocked = !isPartsEditingAllowed(job.status);
  const partsLockedReason = getPartsLockedReason(job.status);
  const [dashQuantities, setDashQuantities] = useState<Record<string, number>>(
    normalizeDashQuantities(job.dashQuantities || {})
  );
  /** When part has variants: 'sets' = one input for number of sets; 'variants' = per-variant inputs */
  const [quantityInputMode, setQuantityInputMode] = useState<'sets' | 'variants'>('variants');
  const [allocationSource, setAllocationSource] = useState<'variant' | 'total'>(
    job.allocationSource ?? 'variant'
  );
  const [laborPerUnitOverrides, setLaborPerUnitOverrides] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [suffix, entry] of Object.entries(job.laborBreakdownByVariant ?? {})) {
      out[toDashSuffix(suffix)] = Number(entry.hoursPerUnit) || 0;
    }
    return out;
  });
  const [machinePerUnitOverrides, setMachinePerUnitOverrides] = useState<
    Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }>
  >(() => getMachineOverrideFromJob(job));
  const machineTotals = useMemo(() => getMachineTotalsFromJob(job), [job]);
  const loggedLaborHours = useMemo(
    () => calculateJobHoursFromShifts(job.id, shifts),
    [job.id, shifts]
  );
  const completionProgress = useMemo(
    () => computeJobCompletionProgress(job, loggedLaborHours),
    [job, loggedLaborHours]
  );
  const is3DPrintRequired = completionProgress.plannedPrinter3DHours > 0;

  // Per-unit progress tracking (CNC + units-done accordions). Distribute the padded BOM across the
  // variants that use each material to know what to deduct per unit.
  const cncAbleCategories = useMemo(
    () => new Set(settings.cncAbleCategories ?? ['foam']),
    [settings.cncAbleCategories]
  );
  const distributedBom = useMemo(
    () =>
      buildDistributedBom({
        job,
        part: linkedPart,
        inventoryById: new Map(inventory.map((i) => [i.id, i])),
        cncAbleCategories,
      }),
    [job, linkedPart, inventory, cncAbleCategories]
  );
  const unitCounts = useMemo(() => unitCountsByVariant(job), [job]);
  const cncAbleKeys = useMemo(() => cncableVariantKeys(distributedBom), [distributedBom]);
  const allVariantKeys = useMemo(() => Object.keys(unitCounts), [unitCounts]);
  const hasUnitsToTrack = allVariantKeys.some((k) => (unitCounts[k] ?? 0) > 0);
  /** When set, a unit-done increment is waiting on the "is CNC also done?" confirm. */
  const [pendingUnitConfirm, setPendingUnitConfirm] = useState<{
    variantKey: string;
    delta: number;
  } | null>(null);

  const applyProgress = useCallback(
    async (cncDelta: number, variantKey: string, unitDelta: number) => {
      const ok = await logUnitProgress({
        job,
        part: linkedPart,
        inventory,
        cncAbleCategories,
        edits: [{ variantKey, cncDelta, unitDelta }],
      });
      if (ok) {
        await onReloadJob?.();
      } else {
        showToast('Could not update progress — please try again.', 'error');
      }
    },
    [job, linkedPart, inventory, cncAbleCategories, onReloadJob, showToast]
  );

  const handleCncAdjust = useCallback(
    (variantKey: string, delta: number) => applyProgress(delta, variantKey, 0),
    [applyProgress]
  );

  const handleUnitAdjust = useCallback(
    async (variantKey: string, delta: number) => {
      if (delta > 0) {
        const projCnc = Number(job.cncDoneByVariant?.[variantKey]) || 0;
        const projUnit = (Number(job.unitsDoneByVariant?.[variantKey]) || 0) + delta;
        // Unit outran CNC for a CNC-able variant — ask whether CNC is also done.
        if (projUnit > projCnc && cncAbleKeys.includes(variantKey)) {
          setPendingUnitConfirm({ variantKey, delta });
          return;
        }
      }
      await applyProgress(0, variantKey, delta);
    },
    [applyProgress, job.cncDoneByVariant, job.unitsDoneByVariant, cncAbleKeys]
  );

  /** In edit mode, local copy of job.parts (or [primary]) for editing part list and per-part dash quantities. */
  const [editingParts, setEditingParts] = useState<JobPartLink[]>(() =>
    job.parts?.length
      ? [...job.parts]
      : job.partId
        ? [
            {
              partId: job.partId,
              partNumber: job.partNumber ?? '',
              dashQuantities: job.dashQuantities ?? {},
            },
          ]
        : [
            {
              partId: '',
              partNumber: job.partNumber ?? '',
              dashQuantities: job.dashQuantities ?? {},
            },
          ]
  );
  useEffect(() => {
    const next = job.parts?.length
      ? [...job.parts]
      : job.partId
        ? [
            {
              partId: job.partId,
              partNumber: job.partNumber ?? '',
              dashQuantities: job.dashQuantities ?? {},
            },
          ]
        : [
            {
              partId: '',
              partNumber: job.partNumber ?? '',
              dashQuantities: job.dashQuantities ?? {},
            },
          ];
    setEditingParts(next);
  }, [job.parts, job.partId, job.partNumber, job.dashQuantities]);

  /** Per-part labor/CNC/3D for view and multi-part totals (one entry per job.parts / linkedParts). */
  const perPartBreakdowns = useMemo(() => {
    const parts = job.parts?.length
      ? job.parts
      : job.partId
        ? [
            {
              partId: job.partId,
              partNumber: job.partNumber ?? '',
              dashQuantities: job.dashQuantities ?? {},
            },
          ]
        : [];
    if (!linkedParts?.length || parts.length === 0) return null;
    const out: { laborHours: number; cncHours: number; printer3DHours: number }[] = [];
    for (let i = 0; i < parts.length && i < linkedParts.length; i++) {
      const part = linkedParts[i];
      const dq = parts[i].dashQuantities ?? {};
      if (!part) {
        out.push({ laborHours: 0, cncHours: 0, printer3DHours: 0 });
        continue;
      }
      const { totals } = computeVariantBreakdown({
        part,
        dashQuantities: dq,
        source: 'variant',
      });
      out.push({
        laborHours: totals.laborHours,
        cncHours: totals.cncHours,
        printer3DHours: totals.printer3DHours,
      });
    }
    return out.length ? out : null;
  }, [job.parts, job.partId, job.partNumber, job.dashQuantities, linkedParts]);

  const [editForm, setEditForm] = useState({
    po: job.po || '',
    description: job.description || '',
    dueDate: isoToDateInput(job.dueDate),
    ecd: isoToDateInput(job.ecd),
    qty: job.qty || '',
    laborHours: job.laborHours?.toString() || '',
    cncHours: machineTotals.cncHours > 0 ? machineTotals.cncHours.toFixed(2) : '',
    printer3DHours: machineTotals.printer3DHours > 0 ? machineTotals.printer3DHours.toFixed(2) : '',
    status: normalizeLegacyRushStatus(job.status),
    isRush: job.isRush,
    binLocation: job.binLocation || '',
    partNumber: job.partNumber || '',
    revision: job.revision || '',
    variantSuffix: job.variantSuffix || '',
    estNumber: job.estNumber || '',
    invNumber: job.invNumber || '',
    rfqNumber: job.rfqNumber || '',
    owrNumber: job.owrNumber || '',
    customerId: job.customerId || '',
    progressEstimatePercent:
      job.progressEstimatePercent != null ? String(job.progressEstimatePercent) : '',
  });
  const [progressEstimateInput, setProgressEstimateInput] = useState(
    job.progressEstimatePercent != null ? String(job.progressEstimatePercent) : ''
  );

  // Size the Description textarea to its content whenever edit mode opens or the
  // text changes programmatically (typing is handled inline in onChange).
  // useLayoutEffect runs before paint so a long existing description never flashes
  // at the minimum height before growing.
  useLayoutEffect(() => {
    if (isEditing) autosizeDescription();
  }, [isEditing, editForm.description, autosizeDescription]);

  // Store current pathname and scrollPositions in refs to avoid dependency issues
  const pathnameRef = useRef(location.pathname);
  const scrollPositionsRef = useRef(navState.scrollPositions);

  useEffect(() => {
    pathnameRef.current = location.pathname;
    scrollPositionsRef.current = navState.scrollPositions;
  }, [location.pathname, navState.scrollPositions]);

  // Restore scroll position and active tab
  useEffect(() => {
    const scrollPos = navState.scrollPositions[location.pathname] || 0;
    if (scrollPos > 0) {
      window.scrollTo(0, scrollPos);
    }
  }, [location.pathname, navState.scrollPositions]);

  // Save scroll position on scroll (throttled)
  const handleScroll = useThrottle(() => {
    updateState({
      scrollPositions: {
        ...scrollPositionsRef.current,
        [pathnameRef.current]: window.scrollY,
      },
    });
  }, 100); // Throttle to once per 100ms

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Save last viewed job
  useEffect(() => {
    updateState({ lastViewedJobId: job.id });
  }, [job.id, updateState]);

  // Allow Kanban "Edit" action to open detail directly in edit mode.
  useEffect(() => {
    if (!currentUser.isAdmin) return;
    const key = 'wtp-open-job-edit';
    const shouldAutoEdit = localStorage.getItem(key);
    if (shouldAutoEdit && shouldAutoEdit === job.id) {
      setIsEditing(true);
      localStorage.removeItem(key);
    }
  }, [job.id, currentUser.isAdmin]);

  // Sync progress estimate input when job updates (e.g. after Set/Clear or reload)
  useEffect(() => {
    setProgressEstimateInput(
      job.progressEstimatePercent != null ? String(Math.round(job.progressEstimatePercent)) : ''
    );
  }, [job.progressEstimatePercent]);

  // Part drawings: files standard users can access on job cards
  useEffect(() => {
    if (!job.partId) {
      setPartDrawings([]);
      return;
    }
    let cancelled = false;
    partsService
      .getPartDrawings(job.partId)
      .then((drawings) => {
        if (!cancelled) setPartDrawings(drawings);
      })
      .catch(() => {
        if (!cancelled) setPartDrawings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [job.partId]);

  // Reset local attachment overrides when switching jobs.
  useEffect(() => {
    setAttachmentAdminOverrides({});
  }, [job.id]);

  // Calculate labor hours suggestion from similar jobs
  // Auto job name (convention or Job #code) for labor suggestion and display
  const autoJobName = getJobNameForSave(
    {
      ...job,
      ...editForm,
      partNumber: (editForm.partNumber ?? job.partNumber ?? '').trim(),
      revision: editForm.revision?.trim(),
      estNumber: editForm.estNumber?.trim(),
      po: editForm.po?.trim(),
      status: editForm.status,
    },
    job.jobCode
  );

  const laborSuggestion = useMemo(() => {
    if (!autoJobName.trim()) return null;
    const suggestion = getLaborSuggestion(autoJobName, jobs, shifts);
    return suggestion > 0 ? suggestion : null;
  }, [autoJobName, jobs, shifts]);

  const inventoryById = useMemo(
    () => new Map(inventory.map((item) => [item.id, item])),
    [inventory]
  );

  const selectedVariantSuffix = selectedVariant?.variantSuffix || editForm.variantSuffix;
  const effectiveMaterialQuantities = useMemo(() => {
    return buildEffectivePartQuantities(
      linkedPart,
      dashQuantities,
      isEditing ? editForm.qty : job.qty
    );
  }, [dashQuantities, linkedPart, isEditing, editForm.qty, job.qty]);

  const materialCosts = useMaterialCosts({
    linkedPart,
    selectedVariantSuffix,
    dashQuantities: effectiveMaterialQuantities,
    inventoryById,
    jobInventoryItems: job.inventoryItems || [],
    materialUpcharge,
    isAdmin: shouldComputeJobFinancials(currentUser.isAdmin),
  });

  const partsWithPartData = useMemo((): PartWithDashQuantities[] | undefined => {
    if (!job.parts?.length || job.parts.length <= 1 || !linkedParts?.length) return undefined;
    const out: PartWithDashQuantities[] = [];
    for (let i = 0; i < job.parts.length && i < linkedParts.length; i++) {
      const part = linkedParts[i];
      const dq =
        isEditing && editingParts.length > i
          ? (editingParts[i].dashQuantities ?? {})
          : (job.parts![i].dashQuantities ?? {});
      if (part) out.push({ part, dashQuantities: dq });
    }
    return out.length > 0 ? out : undefined;
  }, [job.parts, linkedParts, isEditing, editingParts]);

  const { isMaterialAuto } = useMaterialSync({
    jobId: job.id,
    linkedPart,
    dashQuantities: effectiveMaterialQuantities,
    partsWithPartData,
    onReloadJob,
  });

  // Load linked part (prefer job.partId so auto-calc uses the exact linked part)
  const loadLinkedPart = useCallback(
    async (partNumber: string, partId?: string) => {
      if (!partNumber?.trim() && !partId) {
        setLinkedPart(null);
        return;
      }
      setLoadingPart(true);
      try {
        let partWithVariants: Awaited<ReturnType<typeof partsService.getPartWithVariants>> = null;
        if (partId) {
          partWithVariants = await partsService.getPartWithVariants(partId);
        }
        if (!partWithVariants && partNumber?.trim()) {
          let part = await partsService.getPartByNumber(partNumber.trim());
          if (!part) {
            const basePartNumber = partNumber.replace(/-\d{2}$/, '').trim();
            if (basePartNumber !== partNumber.trim()) {
              part = await partsService.getPartByNumber(basePartNumber);
            }
          }
          if (part) {
            partWithVariants = await partsService.getPartWithVariants(part.id);
          }
        }
        // If a linked part id resolves to an empty shell, prefer canonical part-number match.
        // This repairs legacy/casing duplicates where a job can point to a BOM-less part row.
        if (partWithVariants && partNumber?.trim()) {
          const hasBom =
            (partWithVariants.materials?.length ?? 0) > 0 ||
            (partWithVariants.variants ?? []).some((v) => (v.materials?.length ?? 0) > 0);
          if (!hasBom) {
            const canonicalPart = await partsService.getPartByNumber(partNumber.trim());
            if (canonicalPart && canonicalPart.id !== partWithVariants.id) {
              const canonicalWithVariants = await partsService.getPartWithVariants(
                canonicalPart.id
              );
              const canonicalHasBom =
                (canonicalWithVariants?.materials?.length ?? 0) > 0 ||
                (canonicalWithVariants?.variants ?? []).some((v) => (v.materials?.length ?? 0) > 0);
              if (canonicalWithVariants && canonicalHasBom) {
                partWithVariants = canonicalWithVariants;
              }
            }
          }
        }
        if (partWithVariants) {
          setLinkedPart(partWithVariants);
          if (job.variantSuffix && partWithVariants.variants) {
            const variant = partWithVariants.variants.find(
              (v) => v.variantSuffix === job.variantSuffix
            );
            setSelectedVariant(variant || null);
          } else {
            setSelectedVariant(null);
          }
        } else {
          setLinkedPart(null);
          setSelectedVariant(null);
        }
      } catch (error) {
        console.error('Error loading part:', error);
        setLinkedPart(null);
        setSelectedVariant(null);
      } finally {
        setLoadingPart(false);
      }
    },
    [job.variantSuffix]
  );

  // Load linked part when part number or partId changes
  useEffect(() => {
    if (job.partNumber || job.partId) {
      loadLinkedPart(job.partNumber ?? '', job.partId);
    }
  }, [job.partNumber, job.partId, loadLinkedPart]);

  // When job has multiple parts, load Part entity for each
  useEffect(() => {
    if (!job.parts?.length || job.parts.length <= 1) {
      setLinkedParts(null);
      return;
    }
    let cancelled = false;
    Promise.allSettled(job.parts.map((link) => partsService.getPartWithVariants(link.partId)))
      .then((results) => {
        if (cancelled) return;
        setLinkedParts(results.map((r) => (r.status === 'fulfilled' ? r.value : null)));
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Load linked parts failed', err);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.parts?.length, job.parts?.map((p) => p.partId)?.join(',') ?? '']);

  useEffect(() => {
    if (!job.partNumber && !job.partId) return;
    const handlePartUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ partId?: string; partNumber?: string }>).detail;
      if (!detail) return;
      const normalizedJobPart = (job.partNumber ?? '').trim();
      const normalizedEventPart = (detail.partNumber ?? '').trim();
      const partNumberMatch =
        normalizedJobPart.length > 0 &&
        normalizedEventPart.length > 0 &&
        normalizedJobPart === normalizedEventPart;
      const partIdMatch = !!job.partId && !!detail.partId && job.partId === detail.partId;
      if (!partNumberMatch && !partIdMatch) return;
      loadLinkedPart(
        (detail.partNumber ?? job.partNumber ?? '').trim(),
        detail.partId ?? job.partId
      );
    };
    window.addEventListener('parts:updated', handlePartUpdated as EventListener);
    return () => window.removeEventListener('parts:updated', handlePartUpdated as EventListener);
  }, [job.partId, job.partNumber, loadLinkedPart]);

  // When linked part loads and job has no labor/machine set, pull labor/CNC/3D from master part into overrides
  const jobHasNoLabor =
    (job.laborHours == null || job.laborHours === 0) &&
    (!job.laborBreakdownByVariant ||
      Object.values(job.laborBreakdownByVariant).every(
        (e) => !Number(e?.hoursPerUnit) || e.hoursPerUnit === 0
      ));
  const jobHasNoMachineHours =
    !job.machineBreakdownByVariant ||
    Object.values(job.machineBreakdownByVariant).every(
      (e) =>
        (!Number(e?.cncHoursPerUnit) || e.cncHoursPerUnit === 0) &&
        (!Number(e?.printer3DHoursPerUnit) || e.printer3DHoursPerUnit === 0)
    );
  const shouldPullFromPart = (jobHasNoLabor || jobHasNoMachineHours) && !!linkedPart;

  /** Complete sets derived from current dash quantities (for "Full sets" input when part has set composition). */
  const derivedCompleteSets = useMemo(() => {
    if (!linkedPart?.setComposition || Object.keys(linkedPart.setComposition).length === 0)
      return 0;
    const norm = normalizeDashQuantities(dashQuantities);
    return calculateSetCompletion(norm, linkedPart.setComposition).completeSets;
  }, [linkedPart?.setComposition, dashQuantities]);

  useEffect(() => {
    if (!shouldPullFromPart || !linkedPart) return;
    const hasVariants = !!linkedPart.variants?.length;
    const hasDashQty = Object.values(dashQuantities).some((q) => q > 0);

    if (hasVariants && hasDashQty) {
      setAllocationSource('variant');
      const defaults = buildPartVariantDefaults(linkedPart, dashQuantities);
      if (jobHasNoLabor || jobHasNoMachineHours) setLaborPerUnitOverrides(defaults.laborPerUnit);
      setMachinePerUnitOverrides(defaults.machinePerUnit);
      if (jobHasNoLabor || jobHasNoMachineHours) setLaborHoursFromPart(true);
      setEditForm((prev) => ({
        ...prev,
        ...(jobHasNoLabor || jobHasNoMachineHours
          ? { laborHours: defaults.totals.laborHours.toFixed(2) }
          : {}),
        cncHours:
          defaults.totals.cncHours > 0 ? defaults.totals.cncHours.toFixed(2) : prev.cncHours,
        printer3DHours:
          defaults.totals.printer3DHours > 0
            ? defaults.totals.printer3DHours.toFixed(2)
            : prev.printer3DHours,
      }));
    } else {
      // Part has no variants: use set-level hours × job qty for total job labor/CNC/3D
      const jobQty = Math.max(1, Number(job.qty) || 1);
      const partLaborPerSet = Number(linkedPart.laborHours) || 0;
      const partCncPerSet = Number(linkedPart.cncTimeHours) || 0;
      const partPrinter3DPerSet = Number(linkedPart.printer3DTimeHours) || 0;
      const partLabor = partLaborPerSet * jobQty;
      const partCnc = partCncPerSet * jobQty;
      const partPrinter3D = partPrinter3DPerSet * jobQty;
      if (jobHasNoLabor || jobHasNoMachineHours) setLaborHoursFromPart(true);
      setEditForm((prev) => ({
        ...prev,
        ...(jobHasNoLabor
          ? { laborHours: partLabor > 0 ? partLabor.toFixed(2) : prev.laborHours }
          : {}),
        cncHours: jobHasNoMachineHours && partCnc > 0 ? partCnc.toFixed(2) : prev.cncHours,
        printer3DHours:
          jobHasNoMachineHours && partPrinter3D > 0
            ? partPrinter3D.toFixed(2)
            : prev.printer3DHours,
      }));
    }
  }, [
    linkedPart,
    linkedPart?.id,
    linkedPart?.variants,
    linkedPart?.laborHours,
    linkedPart?.cncTimeHours,
    linkedPart?.printer3DTimeHours,
    shouldPullFromPart,
    jobHasNoLabor,
    jobHasNoMachineHours,
    dashQuantities,
    job.qty,
  ]);

  // When part has no variants and user changes qty, recompute total labor/CNC/3D from part per-set × qty
  useEffect(() => {
    if (!linkedPart || linkedPart.variants?.length || !laborHoursFromPart) return;
    const jobQty = Math.max(1, Number(editForm.qty) || 1);
    const partLaborPerSet = Number(linkedPart.laborHours) || 0;
    const partCncPerSet = Number(linkedPart.cncTimeHours) || 0;
    const partPrinter3DPerSet = Number(linkedPart.printer3DTimeHours) || 0;
    const totalLabor = partLaborPerSet * jobQty;
    const totalCnc = partCncPerSet * jobQty;
    const totalPrinter3D = partPrinter3DPerSet * jobQty;
    setEditForm((prev) => {
      const nextLabor = totalLabor > 0 ? totalLabor.toFixed(2) : prev.laborHours;
      const nextCnc = totalCnc > 0 ? totalCnc.toFixed(2) : prev.cncHours;
      const nextPrinter3D = totalPrinter3D > 0 ? totalPrinter3D.toFixed(2) : prev.printer3DHours;
      if (
        prev.laborHours === nextLabor &&
        prev.cncHours === nextCnc &&
        prev.printer3DHours === nextPrinter3D
      )
        return prev;
      return {
        ...prev,
        laborHours: nextLabor,
        cncHours: nextCnc,
        printer3DHours: nextPrinter3D,
      };
    });
  }, [
    linkedPart,
    linkedPart?.id,
    linkedPart?.laborHours,
    linkedPart?.cncTimeHours,
    linkedPart?.printer3DTimeHours,
    editForm.qty,
    laborHoursFromPart,
  ]);

  useEffect(() => {
    if (!isEditing) {
      editSeedRef.current = null;
      return;
    }
    if (!linkedPart?.variants?.length) return;
    if (!Object.values(dashQuantities).some((qty) => qty > 0)) return;
    const seedKey = `${job.id}:${linkedPart.id}`;
    if (editSeedRef.current === seedKey) return;
    const defaults = buildPartVariantDefaults(linkedPart, dashQuantities);
    setAllocationSource('variant');
    setLaborPerUnitOverrides(defaults.laborPerUnit);
    setMachinePerUnitOverrides(defaults.machinePerUnit);
    setLaborHoursFromPart(true);
    setEditForm((prev) => ({
      ...prev,
      laborHours: defaults.totals.laborHours.toFixed(2),
      cncHours: defaults.totals.cncHours.toFixed(2),
      printer3DHours: defaults.totals.printer3DHours.toFixed(2),
    }));
    editSeedRef.current = seedKey;
  }, [dashQuantities, isEditing, job.id, linkedPart]);

  // Part name (editable when linked part exists); sync from linked part
  const [partNameEdit, setPartNameEdit] = useState(linkedPart?.name ?? '');
  useEffect(() => {
    setPartNameEdit(linkedPart?.name ?? '');
  }, [linkedPart?.id, linkedPart?.name]);

  const savePartName = useCallback(async () => {
    if (!linkedPart || partNameEdit.trim() === (linkedPart.name ?? '').trim()) return;
    try {
      const updated = await partsService.updatePart(linkedPart.id, { name: partNameEdit.trim() });
      if (updated) {
        setLinkedPart((prev) => (prev ? { ...prev, name: updated.name } : null));
        showToast('Part name updated', 'success');
      }
    } catch {
      showToast('Failed to update part name', 'error');
    }
  }, [linkedPart, partNameEdit, showToast]);

  // Calculate total material cost (from job inventory × price × upcharge)
  const totalMaterialCost = useMemo(() => {
    return Array.from(materialCosts.values()).reduce((sum, cost) => sum + cost, 0);
  }, [materialCosts]);

  // When linked to part, use part-derived material total so Materials ≤ Total (both from part)
  const displayMaterialTotal = useMemo(() => {
    if (linkedPart && inventoryById.size > 0) {
      const partDerived = computePartDerivedMaterialTotal(
        linkedPart,
        effectiveMaterialQuantities,
        inventoryById,
        materialUpcharge
      );
      if (partDerived != null) return partDerived;
    }
    return totalMaterialCost;
  }, [linkedPart, effectiveMaterialQuantities, inventoryById, materialUpcharge, totalMaterialCost]);

  // Calculate labor cost (whole job)
  const laborCost = useMemo(() => {
    const hours = parseFloat(editForm.laborHours) || 0;
    return hours * laborRate;
  }, [editForm.laborHours, laborRate]);

  const partDerivedPrice = useMemo(() => {
    if (partsWithPartData?.length) {
      return calculateJobPriceFromParts(
        partsWithPartData.map(({ part, dashQuantities }) => ({ part, dashQuantities }))
      );
    }
    return linkedPart ? calculateJobPriceFromPart(linkedPart, effectiveMaterialQuantities) : null;
  }, [linkedPart, effectiveMaterialQuantities, partsWithPartData]);

  const computedCostTotal = useMemo(
    () =>
      laborCost +
      displayMaterialTotal +
      (parseFloat(editForm.cncHours) || 0) * cncRate +
      (parseFloat(editForm.printer3DHours) || 0) * printer3DRate,
    [
      laborCost,
      displayMaterialTotal,
      editForm.cncHours,
      editForm.printer3DHours,
      cncRate,
      printer3DRate,
    ]
  );

  const {
    variantAllocation,
    laborBreakdownByDash,
    persistedLaborBreakdown,
    persistedMachineBreakdown,
  } = useVariantBreakdown({
    part: linkedPart,
    dashQuantities,
    source: allocationSource,
    totalLaborHours: parseFloat(editForm.laborHours) || 0,
    totalCncHours: parseFloat(editForm.cncHours) || 0,
    totalPrinter3DHours: parseFloat(editForm.printer3DHours) || 0,
    laborOverridePerUnit: laborPerUnitOverrides,
    machineOverridePerUnit: machinePerUnitOverrides,
  });

  // Keep edit-form labor/CNC/3D fields synced with part-derived totals in variant mode.
  const laborBreakdownTotal = laborBreakdownByDash?.totalFromDash ?? 0;
  useEffect(() => {
    if (allocationSource !== 'variant') return;
    // When part has no variants or no dash qty, variant allocation has no entries — don't overwrite
    // form with zeros; let the pull-from-part effect set labor/CNC from part set-level values.
    if (!laborBreakdownByDash) return;
    const totals = variantAllocation.totals;
    setEditForm((prev) => {
      const nextLabor = (laborBreakdownTotal ?? 0).toFixed(2);
      const nextCnc = (totals?.cncHours ?? 0).toFixed(2);
      const nextPrinter3D = (totals?.printer3DHours ?? 0).toFixed(2);
      if (
        prev.laborHours === nextLabor &&
        prev.cncHours === nextCnc &&
        prev.printer3DHours === nextPrinter3D
      ) {
        return prev;
      }
      setLaborHoursFromPart(
        Number(nextLabor) > 0 || Number(nextCnc) > 0 || Number(nextPrinter3D) > 0
      );
      return {
        ...prev,
        laborHours: nextLabor,
        cncHours: nextCnc,
        printer3DHours: nextPrinter3D,
      };
    });
  }, [
    laborBreakdownTotal,
    laborBreakdownByDash,
    allocationSource,
    variantAllocation.totals,
    variantAllocation.totals?.laborHours,
    variantAllocation.totals?.cncHours,
    variantAllocation.totals?.printer3DHours,
  ]);

  // Search for part by part number (reserved for future part search UI)
  const _handlePartNumberSearch = useCallback(async () => {
    if (!partNumberSearch.trim()) {
      setLinkedPart(null);
      setEditForm((prev) => ({ ...prev, partNumber: '', variantSuffix: '' }));
      setSelectedVariant(null);
      return;
    }

    setLoadingPart(true);
    try {
      const searchPartNumber = partNumberSearch.trim();
      // Extract base part number (remove variant suffix if present)
      const basePartNumber = searchPartNumber.replace(/-\d{2}$/, '');

      let part = await partsService.getPartByNumber(basePartNumber);

      if (!part) {
        // Part doesn't exist - try to create it (if parts table exists)
        try {
          // Use edit form values if available, otherwise fall back to job values
          const partName = autoJobName || basePartNumber;
          const partDescription = editForm.description?.trim() || job.description || undefined;
          const laborHours = editForm.laborHours
            ? parseFloat(editForm.laborHours)
            : job.laborHours || undefined;

          part = await partsService.createPart({
            partNumber: basePartNumber,
            name: partName,
            description: partDescription,
            laborHours: laborHours,
          });
          if (!part) throw new Error('Failed to create part');
          showToast(`Created new part: ${part.name}`, 'success');
        } catch (createError: unknown) {
          const err = createError as { message?: string; code?: string };
          const isPartsTableMissing =
            err?.message === 'PARTS_TABLE_NOT_FOUND' || err?.code === 'PGRST205';
          if (isPartsTableMissing) {
            showToast(
              'Parts table not set up. Part number will save on the job. Run the database migration to enable parts linking.',
              'warning'
            );
            // Still update job with part number text so user can save (show exactly what they typed)
            setEditForm((prev) => ({ ...prev, partNumber: searchPartNumber }));
            setLinkedPart(null);
            setLoadingPart(false);
            return;
          }
          console.error('Error creating part:', createError);
          showToast('Failed to create part. Please try again.', 'error');
          setLinkedPart(null);
          setLoadingPart(false);
          return;
        }
      }

      // Link to the part (found or newly created)
      const partWithVariants = await partsService.getPartWithVariants(part.id);
      if (!partWithVariants) {
        setEditForm((prev) => ({ ...prev, partNumber: searchPartNumber }));
        setLinkedPart(null);
        setLoadingPart(false);
        return;
      }
      setLinkedPart(partWithVariants);

      // Keep part number field exactly as user typed (e.g. DASH-123-01), not base
      setEditForm((prev) => ({ ...prev, partNumber: searchPartNumber }));

      // Pre-fill labor hours from part if not already set (job name is auto from convention)
      setEditForm((prev) => {
        const updates: { partNumber: string; laborHours?: string } = {
          partNumber: searchPartNumber,
        };
        if (!prev.laborHours && part.laborHours) {
          updates.laborHours = part.laborHours.toString();
          setLaborHoursFromPart(true);
        }
        return { ...prev, ...updates };
      });

      if (part) {
        showToast(`Linked to part: ${part.name}`, 'success');
      }
    } catch (error) {
      console.error('Error searching for part:', error);
      showToast('Error searching for part', 'error');
      setLinkedPart(null);
    } finally {
      setLoadingPart(false);
    }
  }, [
    partNumberSearch,
    job.description,
    job.laborHours,
    editForm.description,
    editForm.laborHours,
    autoJobName,
    showToast,
  ]);

  void _handlePartNumberSearch;

  // Reset edit form when job changes (use stable deps to avoid infinite loop).
  // Skip when user is editing so we never overwrite in-progress edits (e.g. after save, job updates and we want to show saved values only when not editing).
  const jobId = job.id;
  const jobPartNumber = job.partNumber || '';
  useEffect(() => {
    if (isEditing) return;
    setLaborHoursFromPart(false);
    setAllocationSource(job.allocationSource ?? 'variant');
    setDashQuantities(
      normalizeDashQuantities(job.parts?.[0]?.dashQuantities ?? job.dashQuantities ?? {})
    );
    setLaborPerUnitOverrides(() => {
      const out: Record<string, number> = {};
      for (const [suffix, entry] of Object.entries(job.laborBreakdownByVariant ?? {})) {
        out[toDashSuffix(suffix)] = Number(entry.hoursPerUnit) || 0;
      }
      return out;
    });
    setMachinePerUnitOverrides(() => {
      return getMachineOverrideFromJob(job);
    });
    const jobHasNoLaborReset =
      (job.laborHours == null || job.laborHours === 0) &&
      (!job.laborBreakdownByVariant ||
        Object.values(job.laborBreakdownByVariant).every(
          (e) => !Number(e?.hoursPerUnit) || e.hoursPerUnit === 0
        ));
    const jobHasNoMachineHoursReset =
      !job.machineBreakdownByVariant ||
      Object.values(job.machineBreakdownByVariant).every(
        (e) =>
          (!Number(e?.cncHoursPerUnit) || e.cncHoursPerUnit === 0) &&
          (!Number(e?.printer3DHoursPerUnit) || e.printer3DHoursPerUnit === 0)
      );
    // For parts without variants: when job has no labor/CNC, use linked part's set-level values so labor applies as soon as part is loaded
    const partNoVariants =
      linkedPart &&
      !linkedPart.variants?.length &&
      (jobHasNoLaborReset || jobHasNoMachineHoursReset);
    const jobQty = Math.max(1, Number(job.qty) || 1);
    const partLaborPerSet =
      partNoVariants && Number(linkedPart!.laborHours) > 0 ? Number(linkedPart!.laborHours) : null;
    const partCncPerSet =
      partNoVariants && Number(linkedPart!.cncTimeHours) > 0
        ? Number(linkedPart!.cncTimeHours)
        : null;
    const partPrinter3DPerSet =
      partNoVariants && Number(linkedPart!.printer3DTimeHours) > 0
        ? Number(linkedPart!.printer3DTimeHours)
        : null;
    const partLabor = partLaborPerSet != null ? partLaborPerSet * jobQty : null;
    const partCnc = partCncPerSet != null ? partCncPerSet * jobQty : null;
    const partPrinter3D = partPrinter3DPerSet != null ? partPrinter3DPerSet * jobQty : null;
    if (partNoVariants && (partLabor != null || partCnc != null || partPrinter3D != null)) {
      setLaborHoursFromPart(true);
    }
    setEditForm((prev) => ({
      ...prev,
      po: job.po || '',
      description: job.description || '',
      dueDate: isoToDateInput(job.dueDate),
      ecd: isoToDateInput(job.ecd),
      qty: job.qty || '',
      laborHours: jobHasNoLaborReset
        ? partLabor != null
          ? partLabor.toFixed(2)
          : prev.laborHours || job.laborHours?.toString() || ''
        : job.laborHours?.toString() || '',
      cncHours: jobHasNoMachineHoursReset
        ? partCnc != null
          ? partCnc.toFixed(2)
          : prev.cncHours || (machineTotals.cncHours > 0 ? machineTotals.cncHours.toFixed(2) : '')
        : machineTotals.cncHours > 0
          ? machineTotals.cncHours.toFixed(2)
          : '',
      printer3DHours: jobHasNoMachineHoursReset
        ? partPrinter3D != null
          ? partPrinter3D.toFixed(2)
          : prev.printer3DHours ||
            (machineTotals.printer3DHours > 0 ? machineTotals.printer3DHours.toFixed(2) : '')
        : machineTotals.printer3DHours > 0
          ? machineTotals.printer3DHours.toFixed(2)
          : '',
      status: normalizeLegacyRushStatus(job.status),
      isRush: job.isRush,
      binLocation: job.binLocation || '',
      partNumber: jobPartNumber,
      revision: job.revision || '',
      variantSuffix: job.variantSuffix || '',
      estNumber: job.estNumber || '',
      invNumber: job.invNumber || '',
      rfqNumber: job.rfqNumber || '',
      owrNumber: job.owrNumber || '',
      customerId: job.customerId || '',
      progressEstimatePercent:
        job.progressEstimatePercent != null ? String(job.progressEstimatePercent) : '',
    }));
    setPartNumberSearch(jobPartNumber);
    if (jobPartNumber) {
      loadLinkedPart(jobPartNumber);
    } else {
      setLinkedPart(null);
      setSelectedVariant(null);
    }
  }, [
    job,
    jobId,
    jobPartNumber,
    job.po,
    job.description,
    job.dueDate,
    job.ecd,
    job.qty,
    job.laborHours,
    job.status,
    job.isRush,
    job.binLocation,
    job.revision,
    job.variantSuffix,
    job.estNumber,
    job.invNumber,
    job.rfqNumber,
    job.owrNumber,
    job.allocationSource,
    job.dashQuantities,
    job.parts,
    job.laborBreakdownByVariant,
    job.machineBreakdownByVariant,
    machineTotals.cncHours,
    machineTotals.printer3DHours,
    loadLinkedPart,
    isEditing,
    linkedPart,
  ]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isClockedIn && activeShift) {
      interval = setInterval(() => {
        setTimer(formatDurationHMS(getWorkedShiftMs(activeShift)));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isClockedIn, activeShift]);

  // Intercept browser-back when a full-screen overlay is open so pressing back
  // closes the overlay instead of navigating away from the job detail page.
  useEffect(() => {
    if (!viewingAttachment && !showBinLocationScanner) return;
    const handlePopState = () => {
      setViewingAttachment(null);
      setShowBinLocationScanner(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [viewingAttachment, showBinLocationScanner]);

  const handleSubmitComment = async () => {
    if (!newComment.trim() || isSubmitting) return;
    setIsSubmitting(true);
    const commentText = newComment.trim();
    try {
      const comment = await onAddComment(job.id, commentText);
      if (comment) {
        setNewComment('');
        if (users.length > 0) {
          const { systemNotificationService } = await import('@/services/api/systemNotifications');
          for (const user of users) {
            const name = user.name ?? user.email;
            const re = new RegExp(
              '@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])',
              'i'
            );
            if (user.id !== currentUser.id && re.test(commentText)) {
              systemNotificationService
                .notifyMention({
                  mentionedUserId: user.id,
                  jobId: job.id,
                  commenterName: currentUser.name ?? currentUser.email,
                  jobCode: job.jobCode,
                  commentPreview: commentText,
                })
                .catch((err) => console.error('Mention notification failed:', err));
            }
          }
        }
      } else {
        console.error('Failed to add comment - no comment returned');
        showToast('Failed to post comment', 'error');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      showToast('Failed to post comment', 'error');
    }
    setIsSubmitting(false);
  };

  const handleUpdateComment = async (commentId: string) => {
    if (!editingCommentText.trim()) return;
    try {
      await jobService.updateComment(commentId, editingCommentText.trim());
      setEditingCommentId(null);
      setEditingCommentText('');
      showToast('Comment updated', 'success');
      // Reload job data to show updated comment
      if (onReloadJob) await onReloadJob();
    } catch (error) {
      console.error('Error updating comment:', error);
      showToast('Failed to update comment', 'error');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setPendingDeleteCommentId(commentId);
  };

  const handleConfirmDeleteComment = useCallback(async () => {
    if (!pendingDeleteCommentId) return;
    try {
      await jobService.deleteComment(pendingDeleteCommentId);
      showToast('Comment deleted', 'success');
      // Reload job data to remove deleted comment
      if (onReloadJob) await onReloadJob();
    } catch (error) {
      console.error('Error deleting comment:', error);
      showToast('Failed to delete comment', 'error');
    } finally {
      setPendingDeleteCommentId(null);
    }
  }, [onReloadJob, pendingDeleteCommentId, showToast]);

  const handleSaveEdit = async () => {
    const partNumber = editForm.partNumber?.trim() || undefined;
    const revision = editForm.revision?.trim() || undefined;
    const estNumber = editForm.estNumber?.trim() || undefined;
    const po = editForm.po?.trim() || undefined;
    const normalizedBinLocation = editForm.binLocation?.trim() || undefined;
    const normalizedDashQuantities = normalizeDashQuantities(dashQuantities);
    // CNC is no longer auto-completed on save (it's tracked per unit); 3D print unchanged.
    const shouldAutoMark3DPrintDone =
      Boolean(normalizedBinLocation) && is3DPrintRequired && !job.printer3DCompletedAt;
    const partsToSave =
      editingParts.length > 0
        ? editingParts
            .filter((p) => p.partId)
            .map((p, i) => (i === 0 ? { ...p, dashQuantities: normalizedDashQuantities } : p))
        : undefined;
    const editQty = parseFloat(editForm.qty) || 1;
    const noVariantMachineBreakdown =
      Object.keys(persistedMachineBreakdown).length === 0 &&
      linkedPart &&
      !linkedPart.variants?.length
        ? buildNoVariantMachineBreakdown(
            Number((parseFloat(editForm.cncHours) || 0).toFixed(2)) / editQty,
            Number((parseFloat(editForm.printer3DHours) || 0).toFixed(2)) / editQty,
            editQty
          )
        : null;

    const canEditParts = isPartsEditingAllowed(job.status);
    const payload = {
      ...(canEditParts && partsToSave && partsToSave.length > 0 ? { parts: partsToSave } : {}),
      ...(canEditParts ? { partNumber } : {}),
      ...(canEditParts ? { revision } : {}),
      po,
      description: editForm.description?.trim() || undefined,
      dueDate: dateInputToISO(editForm.dueDate),
      ecd: dateInputToISO(editForm.ecd),
      ...(canEditParts ? { qty: editForm.qty?.trim() || undefined } : {}),
      // Always persist labor hours when form has a value (fixes jobs without variants not registering)
      laborHours: (() => {
        const v = editForm.laborHours?.trim();
        if (v === '' || v == null) return undefined;
        const n = parseFloat(v);
        return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : undefined;
      })(),
      status: editForm.status,
      isRush: editForm.isRush,
      progressEstimatePercent:
        editForm.progressEstimatePercent?.trim() !== ''
          ? Math.max(0, Math.min(100, parseFloat(editForm.progressEstimatePercent) || 0))
          : undefined,
      binLocation: normalizedBinLocation,
      printer3DCompletedAt: shouldAutoMark3DPrintDone ? new Date().toISOString() : undefined,
      printer3DCompletedBy: shouldAutoMark3DPrintDone ? currentUser.id : undefined,
      variantSuffix: selectedVariant
        ? selectedVariant.variantSuffix
        : editForm.variantSuffix?.trim() || undefined,
      estNumber,
      invNumber: editForm.invNumber?.trim() || undefined,
      rfqNumber: editForm.rfqNumber?.trim() || undefined,
      owrNumber: editForm.owrNumber?.trim() || undefined,
      // '' = explicitly no customer (NULL); undefined would mean "leave unchanged".
      customerId: editForm.customerId || null,
      ...(canEditParts
        ? {
            dashQuantities:
              Object.keys(normalizedDashQuantities).length > 0
                ? normalizedDashQuantities
                : undefined,
          }
        : {}),
      laborBreakdownByVariant:
        Object.keys(persistedLaborBreakdown).length > 0 ? persistedLaborBreakdown : undefined,
      machineBreakdownByVariant:
        Object.keys(persistedMachineBreakdown).length > 0
          ? persistedMachineBreakdown
          : (noVariantMachineBreakdown ?? undefined),
      allocationSource,
    };
    const nameToSave = getJobNameForSave(
      { ...job, ...editForm, partNumber, revision, estNumber, po, status: editForm.status },
      job.jobCode
    );

    setIsSubmitting(true);
    try {
      const updated = await onUpdateJob(job.id, {
        ...payload,
        name: nameToSave,
      });

      if (updated) {
        showToast('Job updated successfully', 'success');
        const statusAllowsAllocation = editForm.status === 'pod';
        const partsForSync: PartWithDashQuantities[] =
          partsToSave && partsToSave.length > 0
            ? (partsToSave
                .map((link, i) => ({
                  part: linkedParts?.[i] ?? linkedPart!,
                  dashQuantities: link.dashQuantities ?? {},
                }))
                .filter(
                  (p): p is PartWithDashQuantities => p.part != null
                ) as PartWithDashQuantities[])
            : [];
        const hasAnyPartQty = partsForSync.some((p) =>
          Object.values(p.dashQuantities).some((q) => q > 0)
        );
        if (statusAllowsAllocation && partsForSync.length > 1 && hasAnyPartQty) {
          try {
            await syncJobInventoryFromParts(job.id, partsForSync, { replace: true });
            await onReloadJob?.();
          } catch (syncErr) {
            const syncMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.error('Material sync after save (multi-part):', syncErr);
            if (syncMsg.startsWith('material_sync_skipped:')) {
              showToast(bomSyncSkippedMessage(job), 'info');
            } else {
              showToast(
                'Job saved; material sync failed. Use Auto-assign materials to retry.',
                'warning'
              );
            }
          }
        } else if (
          statusAllowsAllocation &&
          partsForSync.length === 1 &&
          partsForSync[0].part &&
          hasAnyPartQty
        ) {
          try {
            await syncJobInventoryFromPart(
              job.id,
              partsForSync[0].part,
              partsForSync[0].dashQuantities,
              { replace: true }
            );
            await onReloadJob?.();
          } catch (syncErr) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.error('Material sync after save:', msg);
            if (msg.startsWith('material_sync_skipped:')) {
              showToast(bomSyncSkippedMessage(job), 'info');
            } else {
              showToast(
                'Job saved; material sync failed. Use Auto-assign materials to retry.',
                'warning'
              );
            }
          }
        } else if (
          statusAllowsAllocation &&
          linkedPart &&
          Object.values(effectiveMaterialQuantities).some((q) => q > 0)
        ) {
          try {
            await syncJobInventoryFromPart(job.id, linkedPart!, effectiveMaterialQuantities, {
              replace: true,
            });
            await onReloadJob?.();
          } catch (syncErr) {
            const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
            console.error('Material sync after save:', msg);
            if (msg.startsWith('material_sync_skipped:')) {
              showToast(bomSyncSkippedMessage(job), 'info');
            } else {
              showToast(
                'Job saved; material sync failed. Use Auto-assign materials to retry.',
                'warning'
              );
            }
          }
        }
        setIsEditing(false);
      } else {
        showToast('Failed to save changes', 'error');
      }
    } catch (error) {
      console.error('Error updating job:', error);
      showToast('Failed to save changes', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    setEditForm({
      po: job.po || '',
      description: job.description || '',
      dueDate: isoToDateInput(job.dueDate),
      ecd: isoToDateInput(job.ecd),
      qty: job.qty || '',
      laborHours: job.laborHours?.toString() || '',
      cncHours: machineTotals.cncHours > 0 ? machineTotals.cncHours.toFixed(2) : '',
      printer3DHours:
        machineTotals.printer3DHours > 0 ? machineTotals.printer3DHours.toFixed(2) : '',
      status: normalizeLegacyRushStatus(job.status),
      isRush: job.isRush,
      binLocation: job.binLocation || '',
      partNumber: job.partNumber || '',
      revision: job.revision || '',
      variantSuffix: job.variantSuffix || '',
      estNumber: job.estNumber || '',
      invNumber: job.invNumber || '',
      rfqNumber: job.rfqNumber || '',
      owrNumber: job.owrNumber || '',
      customerId: job.customerId || '',
      progressEstimatePercent:
        job.progressEstimatePercent != null ? String(job.progressEstimatePercent) : '',
    });
    setDashQuantities(
      normalizeDashQuantities(job.parts?.[0]?.dashQuantities ?? job.dashQuantities ?? {})
    );
    setAllocationSource(job.allocationSource ?? 'variant');
    setLaborPerUnitOverrides(() => {
      const out: Record<string, number> = {};
      for (const [suffix, entry] of Object.entries(job.laborBreakdownByVariant ?? {})) {
        out[toDashSuffix(suffix)] = Number(entry.hoursPerUnit) || 0;
      }
      return out;
    });
    setMachinePerUnitOverrides(() => {
      return getMachineOverrideFromJob(job);
    });
    setPartNumberSearch(job.partNumber || '');
    setSelectedVariant(null);
    setEditingParts(
      job.parts?.length
        ? [...job.parts]
        : job.partId
          ? [
              {
                partId: job.partId,
                partNumber: job.partNumber ?? '',
                dashQuantities: job.dashQuantities ?? {},
                rev: job.partRev,
              },
            ]
          : []
    );
    setIsEditing(false);
  };

  const handleAutoAssignMaterials = async () => {
    if (job.status !== 'pod') {
      showToast("Set job status to PO'd to assign materials", 'warning');
      return;
    }
    const hasMultiPartQty =
      partsWithPartData?.length &&
      partsWithPartData.some((p) => Object.values(p.dashQuantities).some((q) => q > 0));
    const hasSinglePartQty =
      linkedPart && Object.values(effectiveMaterialQuantities).some((q) => q > 0);
    if (!hasMultiPartQty && !hasSinglePartQty) return;
    setSyncingMaterials(true);
    try {
      if (hasMultiPartQty && partsWithPartData?.length) {
        await syncJobInventoryFromParts(job.id, partsWithPartData, { replace: true });
      } else {
        await syncJobInventoryFromPart(job.id, linkedPart!, effectiveMaterialQuantities, {
          replace: true,
        });
      }
      await onReloadJob?.();
      showToast('Materials auto-assigned from part(s)', 'success');
    } catch (err) {
      const autoMsg = err instanceof Error ? err.message : String(err);
      console.error('Auto-assign materials:', err);
      if (autoMsg.startsWith('material_sync_skipped:')) {
        showToast(bomSyncSkippedMessage(job), 'warning');
      } else {
        showToast('Failed to auto-assign materials', 'error');
      }
    } finally {
      setSyncingMaterials(false);
    }
  };

  const handleAddPartToExistingJob = useCallback(
    async (part: Part, dashQuantitiesForPart: Record<string, number>) => {
      if (!isPartsEditingAllowed(job.status)) {
        showToast('Cannot modify parts after RFQ Sent', 'error');
        return;
      }
      const currentParts: JobPartLink[] =
        job.parts && job.parts.length > 0
          ? job.parts
          : job.partId
            ? [
                {
                  partId: job.partId,
                  partNumber: job.partNumber ?? '',
                  dashQuantities: job.dashQuantities ?? {},
                },
              ]
            : [];
      const newLink: JobPartLink = {
        partId: part.id,
        partNumber: part.partNumber,
        dashQuantities: dashQuantitiesForPart ?? {},
      };
      const newParts = [...currentParts, newLink];
      try {
        const updated = await onUpdateJob(job.id, { parts: newParts });
        if (updated) {
          setShowAddPartToJob(false);
          showToast(`Added part ${part.partNumber} to job`, 'success');

          // Sync materials from all parts (combined BOM) and optionally combine labor for scheduling
          const partsWithPartData: PartWithDashQuantities[] = [];
          for (let i = 0; i < newParts.length; i++) {
            const link = newParts[i];
            const partWithVariants =
              link.partId === part.id ? part : await partsService.getPartWithVariants(link.partId);
            if (partWithVariants) {
              partsWithPartData.push({
                part: partWithVariants,
                dashQuantities: link.dashQuantities ?? {},
              });
            }
          }
          if (partsWithPartData.length > 0) {
            if (job.status === 'pod') {
              try {
                const hasAnyQty = partsWithPartData.some((p) =>
                  Object.values(p.dashQuantities).some((q) => q > 0)
                );
                if (hasAnyQty) {
                  await syncJobInventoryFromParts(job.id, partsWithPartData, { replace: true });
                  showToast('Materials combined from all parts', 'success');
                }
              } catch (syncErr) {
                const addPartMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
                console.error('Material sync after add part:', syncErr);
                if (addPartMsg.startsWith('material_sync_skipped:')) {
                  showToast(bomSyncSkippedMessage(job), 'info');
                } else {
                  showToast('Part added; sync materials from job if needed', 'warning');
                }
              }
            }
            // Combined labor for scheduling: sum labor from each part × quantities
            let combinedLabor = 0;
            for (const { part: p, dashQuantities: dq } of partsWithPartData) {
              const hasQty = Object.values(dq).some((q) => q > 0);
              let hours: number | undefined;
              if (hasQty) {
                const { totals } = computeVariantBreakdown({
                  part: p,
                  dashQuantities: dq,
                  source: 'variant',
                });
                hours = totals.laborHours > 0 ? totals.laborHours : undefined;
              }
              if (hours == null && typeof p.laborHours === 'number' && p.laborHours > 0) {
                hours = p.laborHours;
              }
              if (typeof hours === 'number' && hours > 0) combinedLabor += hours;
            }
            if (combinedLabor > 0) {
              await onUpdateJob(job.id, { laborHours: combinedLabor });
            }
          }

          // Do not call onReloadJob() here: the cache was already updated by onUpdateJob with
          // the full job (including parts). A refetch can overwrite with a response that omits
          // job_parts and make the newly added part disappear.
        } else {
          showToast('Failed to add part to job', 'error');
        }
      } catch (err) {
        console.error('Add part to job:', err);
        showToast('Failed to add part to job', 'error');
      }
    },
    [job, onUpdateJob, showToast]
  );

  // BOM scopes per inventory id for the add-material picker: the part-level per_set row
  // and/or one row per variant. When an inventory appears in more than one, the picker lets
  // the user say which row a job-material quantity belongs to (for the Part BOM writeback).
  const materialBomScopes = useMemo(() => {
    const map = new Map<string, Array<{ key: string; label: string; variantSuffix?: string }>>();
    if (!linkedPart) return map;
    const add = (
      invId: string | undefined,
      scope: { key: string; label: string; variantSuffix?: string }
    ) => {
      if (!invId) return;
      const arr = map.get(invId) ?? [];
      arr.push(scope);
      map.set(invId, arr);
    };
    for (const m of linkedPart.materials ?? []) {
      add(m.inventoryId, { key: 'part', label: 'Part (per set)' });
    }
    for (const v of linkedPart.variants ?? []) {
      for (const m of v.materials ?? []) {
        add(m.inventoryId, {
          key: `v:${v.variantSuffix}`,
          label: `Variant ${v.variantSuffix}`,
          variantSuffix: v.variantSuffix,
        });
      }
    }
    return map;
  }, [linkedPart]);

  const handleAddInventory = useCallback(
    async (
      jobId: string,
      inventoryId: string,
      quantity: number,
      unit: string,
      scope?: MaterialSyncScope
    ) => {
      await onAddInventory(jobId, inventoryId, quantity, unit);
      if (linkedPart && jobId === job.id) {
        try {
          await syncPartMaterialFromJobQuantity(
            linkedPart,
            dashQuantities,
            inventoryId,
            quantity,
            unit,
            scope
          );
          const updated = await partsService.getPartWithVariants(linkedPart.id);
          if (updated) setLinkedPart(updated);
          await onReloadJob?.();
          showToast('Part BOM updated from job', 'success');
        } catch (err) {
          console.error('Sync job material to Part:', err);
          showToast('Job material updated; Part BOM sync failed', 'warning');
        }
      }
    },
    [onAddInventory, linkedPart, job.id, dashQuantities, onReloadJob, showToast]
  );

  const handleConfirmDeleteJob = useCallback(async () => {
    if (!currentUser.isAdmin || isDeletingJob) return;
    setIsDeletingJob(true);
    try {
      const deleted = await onDeleteJob(job.id);
      if (!deleted) {
        showToast('Failed to delete job', 'error');
        return;
      }
      showToast('Job deleted', 'success');
      setShowDeleteJobConfirm(false);
      if (onBack) {
        onBack();
      } else {
        onNavigate('dashboard');
      }
    } catch (error) {
      console.error('Error deleting job:', error);
      showToast('Failed to delete job', 'error');
    } finally {
      setIsDeletingJob(false);
    }
  }, [currentUser.isAdmin, isDeletingJob, onDeleteJob, job.id, showToast, onBack, onNavigate]);

  const handleDashQuantityChange = useCallback((variantSuffix: string, rawValue: string) => {
    setAllocationSource('variant');
    setLaborHoursFromPart(true);
    const qty = Math.max(0, parseInt(rawValue, 10) || 0);
    const key = toDashSuffix(variantSuffix);
    setDashQuantities((prev) => {
      const next = { ...normalizeDashQuantities(prev) };
      if (qty <= 0) {
        delete next[key];
      } else {
        next[key] = qty;
      }
      return next;
    });
  }, []);

  const handleFillFullSet = useCallback(() => {
    if (!linkedPart?.variants?.length) return;
    setAllocationSource('variant');
    setLaborHoursFromPart(true);
    const setComp = linkedPart.setComposition ?? {};
    const next: Record<string, number> = {};
    linkedPart.variants.forEach((variant) => {
      const key = toDashSuffix(variant.variantSuffix);
      const qty = getDashQuantity(setComp, key) || 1;
      next[key] = qty;
    });
    setDashQuantities(next);
    showToast('Filled with one full set', 'success');
  }, [linkedPart, showToast]);

  /** Set dash quantities from number of full sets (setComposition × numSets). */
  const handleSetsQuantityChange = useCallback(
    (numSets: number) => {
      if (!linkedPart?.variants?.length) return;
      setAllocationSource('variant');
      setLaborHoursFromPart(true);
      const setComp = linkedPart.setComposition ?? {};
      const next: Record<string, number> = {};
      linkedPart.variants.forEach((variant) => {
        const key = toDashSuffix(variant.variantSuffix);
        const qtyPerSet = getDashQuantity(setComp, key) || 1;
        next[key] = Math.max(0, Math.floor(qtyPerSet * numSets));
      });
      setDashQuantities(next);
    },
    [linkedPart]
  );

  const handleApplyFromPart = useCallback(() => {
    if (!linkedPart?.variants?.length) return;
    setAllocationSource('variant');
    const defaults = buildPartVariantDefaults(linkedPart, dashQuantities);
    setLaborPerUnitOverrides(defaults.laborPerUnit);
    setMachinePerUnitOverrides(defaults.machinePerUnit);
    setLaborHoursFromPart(true);
    setEditForm((prev) => ({
      ...prev,
      laborHours: defaults.totals.laborHours.toFixed(2),
      cncHours: defaults.totals.cncHours.toFixed(2),
      printer3DHours: defaults.totals.printer3DHours.toFixed(2),
    }));
    showToast('Applied labor/machine/material logic from part', 'success');
  }, [dashQuantities, linkedPart, showToast]);

  const setEditingPartDashQuantities = useCallback(
    (partIndex: number, dq: Record<string, number>) => {
      setEditingParts((prev) => {
        if (partIndex < 0 || partIndex >= prev.length) return prev;
        const next = [...prev];
        next[partIndex] = { ...next[partIndex], dashQuantities: dq };
        return next;
      });
    },
    []
  );

  // Edit the part number of a non-primary part (the primary uses editForm.partNumber). The
  // saved link is re-resolved from this number server-side, mirroring the primary's flow.
  const setEditingPartNumber = useCallback((partIndex: number, partNumber: string) => {
    setEditingParts((prev) => {
      if (partIndex < 0 || partIndex >= prev.length) return prev;
      const next = [...prev];
      next[partIndex] = { ...next[partIndex], partNumber };
      return next;
    });
  }, []);

  // On blur of a non-primary part number, refresh that row's loaded part (variants/BOM shown
  // below) so the quantity editor tracks the new number live — the analog of loadLinkedPart
  // for the primary. Purely display state; the persisted link is resolved on save.
  const reloadEditingLinkedPart = useCallback(async (partIndex: number, partNumber: string) => {
    const trimmed = partNumber.trim();
    if (!trimmed) return;
    try {
      let part = await partsService.getPartByNumber(trimmed);
      if (!part) {
        const base = trimmed.replace(/-\d{2}$/, '').trim();
        if (base !== trimmed) part = await partsService.getPartByNumber(base);
      }
      const withVariants = part ? await partsService.getPartWithVariants(part.id) : null;
      setLinkedParts((prev) => {
        if (!prev || partIndex < 0 || partIndex >= prev.length) return prev;
        const next = [...prev];
        next[partIndex] = withVariants;
        return next;
      });
    } catch (err) {
      console.error('Reload linked part (multi-part) failed', err);
    }
  }, []);

  // File attachment handlers
  const handleFileUpload = async (file: File, isAdminOnly = false): Promise<boolean> => {
    try {
      const success = await onAddAttachment(job.id, file, isAdminOnly);
      if (success && onReloadJob) {
        await onReloadJob();
      }
      return success;
    } catch (error) {
      console.error('Error uploading file:', error);
      return false;
    }
  };

  const handleViewAttachment = (attachment: Attachment) => {
    if (!attachment.url) {
      showToast('Attachment URL is missing. Try refreshing the job.', 'error');
      return;
    }
    const ext = attachment.filename.split('.').pop()?.toLowerCase() || '';
    let previewUrl = attachment.url;
    if (ext === 'pdf') {
      previewUrl = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(attachment.url)}`;
    } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
      previewUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(attachment.url)}`;
    }
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCloseViewer = () => {
    setViewingAttachment(null);
  };

  const handleDeleteAttachment = async () => {
    if (!viewingAttachment) return;
    try {
      const success = await onDeleteAttachment(viewingAttachment.id);
      if (success && onReloadJob) {
        await onReloadJob();
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
    }
  };

  const handleToggleAttachmentAdminOnly = async (
    attachmentId: string,
    isAdminOnly: boolean
  ): Promise<void> => {
    if (!currentUser.isAdmin) {
      showToast('Only admins can change file visibility', 'error');
      return;
    }
    if (!onUpdateAttachmentAdminOnly) return;
    const previous = attachmentAdminOverrides[attachmentId];
    setAttachmentAdminOverrides((prev) => ({ ...prev, [attachmentId]: isAdminOnly }));
    setPendingAttachmentToggleCount((prev) => prev + 1);

    const ref: { p?: Promise<void> } = {};
    const operation: Promise<void> = (async () => {
      try {
        const success = await onUpdateAttachmentAdminOnly(attachmentId, isAdminOnly);
        if (success && onReloadJob) {
          await onReloadJob();
          showToast(
            isAdminOnly ? 'Moved file to Admin Files' : 'Moved file to Job Attachments',
            'success'
          );
        } else if (!success) {
          setAttachmentAdminOverrides((prev) => {
            if (previous === undefined) {
              const next = { ...prev };
              delete next[attachmentId];
              return next;
            }
            return { ...prev, [attachmentId]: previous };
          });
          showToast('Failed to update Admin-only setting', 'error');
        }
      } catch (error) {
        console.error('Error updating attachment admin-only:', error);
        setAttachmentAdminOverrides((prev) => {
          if (previous === undefined) {
            const next = { ...prev };
            delete next[attachmentId];
            return next;
          }
          return { ...prev, [attachmentId]: previous };
        });
        showToast('Failed to update Admin-only setting', 'error');
      } finally {
        if (ref.p) pendingAttachmentTogglesRef.current.delete(ref.p);
        setPendingAttachmentToggleCount((prev) => Math.max(0, prev - 1));
      }
    })();
    ref.p = operation;

    pendingAttachmentTogglesRef.current.add(operation);
    await operation;
  };

  const waitForPendingAttachmentToggles = useCallback(async (): Promise<void> => {
    if (pendingAttachmentTogglesRef.current.size === 0) return;
    showToast('Saving file visibility change...', 'info');
    await Promise.allSettled(Array.from(pendingAttachmentTogglesRef.current));
  }, [showToast]);

  // Bin location handlers
  const handleBinLocationUpdate = async (location: string) => {
    try {
      const normalizedLocation = location?.trim() || undefined;
      // CNC is no longer auto-completed from a bin scan — it's tracked per unit. 3D print keeps
      // its existing auto-mark behavior for now.
      const shouldAutoMark3DPrintDone =
        Boolean(normalizedLocation) && is3DPrintRequired && !job.printer3DCompletedAt;
      const updated = await onUpdateJob(job.id, {
        binLocation: normalizedLocation,
        printer3DCompletedAt: shouldAutoMark3DPrintDone ? new Date().toISOString() : undefined,
        printer3DCompletedBy: shouldAutoMark3DPrintDone ? currentUser.id : undefined,
      });

      if (updated && onReloadJob) {
        await onReloadJob();
      }
      if (updated) {
        showToast('Bin location saved', 'success');
      }
    } catch (error) {
      console.error('Error updating bin location:', error);
      showToast('Failed to update bin location', 'error');
    }
  };

  const handleToggle3DPrintDone = async () => {
    if (!currentUser.isAdmin || !is3DPrintRequired) return;
    try {
      const markDone = !job.printer3DCompletedAt;
      const updated = await onUpdateJob(job.id, {
        printer3DCompletedAt: markDone ? new Date().toISOString() : null,
        printer3DCompletedBy: markDone ? currentUser.id : null,
      });
      if (updated) {
        showToast(markDone ? '3D print marked done' : '3D print marked pending', 'success');
      } else {
        showToast('Failed to update 3D print status', 'error');
      }
    } catch (error) {
      console.error('Error updating 3D print status:', error);
      showToast('Failed to update 3D print status', 'error');
    }
  };

  // Filter attachments by type
  const effectiveAttachments = (job.attachments || []).map((attachment) => {
    const override = attachmentAdminOverrides[attachment.id];
    return override === undefined ? attachment : { ...attachment, isAdminOnly: override };
  });
  const adminAttachments = effectiveAttachments.filter((a) => a.isAdminOnly);
  const regularAttachments = effectiveAttachments.filter((a) => !a.isAdminOnly);

  const formatCommentTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const displayInvNumber = sanitizeReferenceValue(job.invNumber);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark text-white">
      {/* Custom Scrollbar Styles */}
      <style>{`
        main::-webkit-scrollbar {
          width: 8px;
        }
        main::-webkit-scrollbar-track {
          background: transparent;
        }
        main::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        main::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

      <JobDetailHeaderBar
        isEditing={isEditing}
        jobCode={job.jobCode}
        status={job.status}
        isAdmin={currentUser.isAdmin}
        minimalView={!!navState.minimalView}
        isSubmitting={isSubmitting}
        pendingAttachmentToggleCount={pendingAttachmentToggleCount}
        onBackOrClose={async () => {
          await waitForPendingAttachmentToggles();
          if (isEditing) {
            handleCancelEdit();
          } else if (onBack) {
            onBack();
          } else {
            onNavigate('dashboard');
          }
        }}
        onToggleMinimalView={() => updateState({ minimalView: !navState.minimalView })}
        onEditOrSave={() => (isEditing ? handleSaveEdit() : setIsEditing(true))}
      />

      <main
        className={`flex-1 overflow-y-auto ${!isEditing ? 'content-above-nav' : 'pb-safe pb-6'}`}
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {/* EDIT MODE - compact, sharp */}
        {isEditing ? (
          <div className="space-y-2 p-3 sm:p-3">
            {/* Set comparison + Auto-assign in one strip */}
            {linkedPart &&
              linkedPart.setComposition &&
              Object.keys(linkedPart.setComposition).filter((k) => k !== '_').length > 0 &&
              Object.keys(dashQuantities).length > 0 && (
                <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted">Set:</span>
                      <span className="font-medium text-white">
                        {formatSetComposition(linkedPart.setComposition)}
                      </span>
                      <span className="text-muted">Ordered:</span>
                      <span className="font-medium text-white">
                        {formatDashSummary(dashQuantities)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

            {((linkedPart && Object.values(dashQuantities).some((q) => q > 0)) ||
              (partsWithPartData?.length &&
                partsWithPartData.some((p) =>
                  Object.values(p.dashQuantities).some((q) => q > 0)
                ))) && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-muted">
                    Source: <span className="font-semibold text-primary">{allocationSource}</span>
                  </span>
                  {linkedPart && Object.keys(dashQuantities).length > 0 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleFillFullSet}
                        disabled={partsLocked}
                        title={partsLockedReason ?? undefined}
                        className="rounded border border-primary/30 bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Fill full set
                      </button>
                      <button
                        type="button"
                        onClick={handleApplyFromPart}
                        className="rounded border border-primary/30 bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/30"
                      >
                        Apply from part
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleAutoAssignMaterials}
                  disabled={syncingMaterials || job.status !== 'pod'}
                  title={
                    job.status !== 'pod' ? "Set job status to PO'd to assign materials" : undefined
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-sm border border-primary/30 bg-primary/20 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">
                    {syncingMaterials ? 'hourglass_empty' : 'inventory_2'}
                  </span>
                  {syncingMaterials
                    ? 'Syncing…'
                    : partsWithPartData && partsWithPartData.length > 1
                      ? 'Auto-assign materials from parts'
                      : 'Auto-assign materials from part'}
                </button>
              </div>
            )}

            {/* Part details (top) - one block per part */}
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                Part details
              </p>
              {partsLocked && (
                <p className="mb-2 flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                  <span className="material-symbols-outlined text-sm">lock</span>
                  {partsLockedReason}
                </p>
              )}
              {editingParts.map((link, idx) => (
                <div key={link.partId} className="mb-3 last:mb-0">
                  {editingParts.length > 1 && (
                    <p className="mb-1 text-[10px] font-medium text-primary">Part {idx + 1}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div>
                      <label className="mb-0.5 block text-[11px] text-muted">Part Number</label>
                      {idx === 0 ? (
                        <input
                          type="text"
                          value={editForm.partNumber || ''}
                          onChange={(e) =>
                            setEditForm((prev) => ({ ...prev, partNumber: e.target.value }))
                          }
                          onBlur={(e) => {
                            if (partsLocked) return;
                            const v = e.currentTarget.value?.trim();
                            if (v) loadLinkedPart(v);
                          }}
                          disabled={partsLocked}
                          title={partsLockedReason ?? undefined}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="e.g., SK-F35-0911"
                        />
                      ) : (
                        <input
                          type="text"
                          value={link.partNumber || ''}
                          onChange={(e) => setEditingPartNumber(idx, e.target.value)}
                          onBlur={(e) => {
                            if (partsLocked) return;
                            reloadEditingLinkedPart(idx, e.currentTarget.value);
                          }}
                          disabled={partsLocked}
                          title={partsLockedReason ?? undefined}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="e.g., SK-F35-0911"
                        />
                      )}
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-muted">Rev</label>
                      {idx === 0 ? (
                        <input
                          type="text"
                          value={editForm.revision}
                          onChange={(e) => setEditForm({ ...editForm, revision: e.target.value })}
                          disabled={partsLocked}
                          title={partsLockedReason ?? undefined}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="A, B, NC"
                        />
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-subtle">
                          —
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="mb-0.5 block text-[11px] text-muted">Part Name</label>
                      {idx === 0 && linkedPart ? (
                        <input
                          type="text"
                          value={partNameEdit}
                          onChange={(e) => setPartNameEdit(e.target.value)}
                          onBlur={partsLocked ? undefined : savePartName}
                          disabled={partsLocked}
                          title={partsLockedReason ?? undefined}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="Part name"
                        />
                      ) : linkedParts?.[idx] ? (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white">
                          {linkedParts[idx].name || '—'}
                        </div>
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-subtle">
                          —
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Job details */}
            <div className="rounded-sm border border-white/10 bg-white/5 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                Job details
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {/* Free-text reference numbers (EST#/RFQ#/INV#/PO#/OWR#) for cross-referencing
                    QuickBooks while it runs alongside. Real estimates/invoices ALSO link through
                    the billing panel; these stay editable by hand for reconciliation. */}
                {JobCustomerSelect && (
                  <div className="col-span-2">
                    <label className="mb-0.5 block text-[11px] text-muted">Customer</label>
                    <Suspense
                      fallback={
                        <div className="h-[34px] w-full rounded border border-white/10 bg-white/5" />
                      }
                    >
                      <JobCustomerSelect
                        value={editForm.customerId || null}
                        onChange={(customerId) =>
                          setEditForm({ ...editForm, customerId: customerId ?? '' })
                        }
                        className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                      />
                    </Suspense>
                  </div>
                )}
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">EST #</label>
                  <input
                    type="text"
                    value={editForm.estNumber}
                    onChange={(e) => setEditForm({ ...editForm, estNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="EST #"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">RFQ #</label>
                  <input
                    type="text"
                    value={editForm.rfqNumber}
                    onChange={(e) => setEditForm({ ...editForm, rfqNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="RFQ #"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">INV #</label>
                  <input
                    type="text"
                    value={editForm.invNumber}
                    onChange={(e) => setEditForm({ ...editForm, invNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="INV #"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">PO #</label>
                  <input
                    type="text"
                    value={editForm.po}
                    onChange={(e) => setEditForm({ ...editForm, po: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="PO"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">OWR#</label>
                  <input
                    type="text"
                    value={editForm.owrNumber}
                    onChange={(e) => setEditForm({ ...editForm, owrNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="OWR#"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">Due</label>
                  <input
                    type="date"
                    value={editForm.dueDate}
                    onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">ECD</label>
                  <input
                    type="date"
                    value={editForm.ecd}
                    onChange={(e) => setEditForm({ ...editForm, ecd: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value as JobStatus })
                    }
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s.id} value={s.id} className="bg-surface text-white">
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">Bin</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={editForm.binLocation}
                      onChange={(e) =>
                        setEditForm({ ...editForm, binLocation: e.target.value.toUpperCase() })
                      }
                      className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-sm uppercase text-white focus:border-primary/50 focus:outline-none"
                      placeholder="A4c"
                      maxLength={10}
                    />
                    <button
                      type="button"
                      onClick={() => setShowBinLocationScanner(true)}
                      className="rounded border border-primary/30 bg-primary/20 p-1.5 text-white hover:bg-primary/30"
                      title="Scan"
                    >
                      <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
                    </button>
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5">
                  <span className="text-[11px] font-medium text-white">Rush</span>
                  <button
                    type="button"
                    onClick={() => setEditForm({ ...editForm, isRush: !editForm.isRush })}
                    className={`h-5 w-9 rounded-sm transition-colors ${editForm.isRush ? 'bg-red-500' : 'bg-white/20'}`}
                  >
                    <div
                      className={`h-4 w-4 transform rounded-sm bg-white transition-transform ${editForm.isRush ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </button>
                </div>
                <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                  <label className="mb-0.5 block text-[11px] text-muted">Description</label>
                  <textarea
                    ref={descriptionRef}
                    value={editForm.description}
                    onChange={(e) => {
                      setEditForm({ ...editForm, description: e.target.value });
                      autosizeDescription();
                    }}
                    className="min-h-[4.5rem] w-full resize-none overflow-hidden rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="Description..."
                  />
                </div>
              </div>
              {/* When an EST#/INV# is typed, offer to link the matching estimate/invoice to this
                  job (deep-links the real document into the billing panel + job costing). */}
              {JobDocLinkSuggestion &&
                (editForm.estNumber?.trim() || editForm.invNumber?.trim()) && (
                  <Suspense fallback={null}>
                    <JobDocLinkSuggestion
                      jobId={job.id}
                      estNumber={editForm.estNumber}
                      invNumber={editForm.invNumber}
                    />
                  </Suspense>
                )}
            </div>

            {/* Variants and quantities - one block per part */}
            {editingParts.map((link, partIdx) => {
              const partForVariants = partIdx === 0 ? linkedPart : linkedParts?.[partIdx];
              const qtyForPart = partIdx === 0 ? dashQuantities : (link.dashQuantities ?? {});
              const setQtyForPart =
                partIdx === 0
                  ? setDashQuantities
                  : (next: Record<string, number>) => setEditingPartDashQuantities(partIdx, next);
              return (
                <div key={link.partId} className="rounded-sm border border-white/10 bg-white/5 p-2">
                  {editingParts.length > 1 && (
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Part {partIdx + 1}: {link.partNumber}
                    </h3>
                  )}
                  {partForVariants &&
                  partForVariants.variants &&
                  partForVariants.variants.length > 0 ? (
                    <>
                      {partIdx === 0 && (
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Variants & quantities
                        </h3>
                      )}
                      {partIdx === 0 &&
                      linkedPart?.setComposition &&
                      Object.keys(linkedPart.setComposition).filter((k) => k !== '_').length > 0 ? (
                        <div className="mb-2 flex flex-wrap items-center gap-3">
                          <span className="text-[11px] text-muted">Input by:</span>
                          <label
                            className={`flex items-center gap-1.5 ${partsLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                          >
                            <input
                              type="radio"
                              name="quantity-input-mode"
                              checked={quantityInputMode === 'sets'}
                              onChange={() => setQuantityInputMode('sets')}
                              disabled={partsLocked}
                              className="h-4 w-4 border-white/20 bg-white/5 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-white">Full sets</span>
                          </label>
                          <label
                            className={`flex items-center gap-1.5 ${partsLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                          >
                            <input
                              type="radio"
                              name="quantity-input-mode"
                              checked={quantityInputMode === 'variants'}
                              onChange={() => setQuantityInputMode('variants')}
                              disabled={partsLocked}
                              className="h-4 w-4 border-white/20 bg-white/5 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-white">Variants</span>
                          </label>
                        </div>
                      ) : null}
                      {partIdx === 0 &&
                      quantityInputMode === 'sets' &&
                      linkedPart?.setComposition &&
                      Object.keys(linkedPart.setComposition).length > 0 ? (
                        <div>
                          <label className="mb-0.5 block text-[11px] text-muted">
                            Number of sets
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={derivedCompleteSets}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              handleSetsQuantityChange(Number.isFinite(v) && v >= 0 ? v : 0);
                            }}
                            disabled={partsLocked}
                            title={partsLockedReason ?? undefined}
                            className="w-24 rounded border border-white/10 bg-white/5 px-2 py-1 text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Number of sets"
                          />
                          {derivedCompleteSets > 0 && (
                            <p className="mt-1 text-xs text-muted">
                              {formatDashSummary(qtyForPart)} → Total{' '}
                              {totalFromDashQuantities(qtyForPart)} units
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-[11px] font-medium text-muted">
                            Per-variant quantities
                          </p>
                          <span className="block text-xs text-muted">
                            {formatDashSummary(qtyForPart)} → Total{' '}
                            {totalFromDashQuantities(qtyForPart)}
                          </span>
                          <div className="flex flex-wrap gap-x-4 gap-y-3">
                            {partForVariants.variants.map((variant) => {
                              const qty = getDashQuantity(qtyForPart, variant.variantSuffix);
                              const label =
                                partForVariants.partNumber +
                                toDashSuffix(variant.variantSuffix) +
                                (variant.name ? ` (${variant.name})` : '');
                              return (
                                <div
                                  key={variant.id}
                                  className="flex flex-col gap-1 rounded border border-white/10 bg-white/5 px-2 py-1.5"
                                >
                                  <label
                                    htmlFor={`dash-qty-${partIdx}-${variant.id}`}
                                    className="text-xs font-medium text-white"
                                  >
                                    {label}
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      id={`dash-qty-${partIdx}-${variant.id}`}
                                      type="number"
                                      min={0}
                                      value={qty}
                                      onChange={(e) => {
                                        if (partIdx === 0) {
                                          handleDashQuantityChange(
                                            variant.variantSuffix,
                                            e.target.value
                                          );
                                        } else {
                                          const key = toDashSuffix(variant.variantSuffix);
                                          const next = { ...normalizeDashQuantities(qtyForPart) };
                                          const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                                          if (v <= 0) delete next[key];
                                          else next[key] = v;
                                          setQtyForPart(next);
                                        }
                                      }}
                                      disabled={partsLocked}
                                      title={partsLockedReason ?? undefined}
                                      className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                      aria-label={`Quantity for ${label}`}
                                    />
                                    <span className="text-[10px] text-muted">Qty</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      {partIdx === 0 && (
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Set quantity
                        </h3>
                      )}
                      <label className="mb-0.5 block text-[11px] text-muted">Sets</label>
                      {totalFromDashQuantities(qtyForPart) > 0 ? (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-muted">
                          {formatDashSummary(qtyForPart)} → Total{' '}
                          {totalFromDashQuantities(qtyForPart)}
                        </div>
                      ) : partIdx === 0 ? (
                        <input
                          type="text"
                          value={editForm.qty}
                          onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                          disabled={partsLocked}
                          title={partsLockedReason ?? undefined}
                          className="w-full max-w-24 rounded border border-white/10 bg-white/5 px-2 py-1 text-base text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="Sets"
                          aria-label="Quantity (sets)"
                        />
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-subtle">
                          —
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Labor & Materials intertwined with variants section */}
            <div className="rounded-sm border border-white/10 bg-white/5 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                Labor & materials
              </h3>
              {editingParts.length > 1 && perPartBreakdowns && (
                <div className="mb-3 rounded-sm border border-white/10 bg-white/5 p-2">
                  <p className="mb-1 text-[10px] font-bold uppercase text-muted">
                    Per-part (read-only)
                  </p>
                  {perPartBreakdowns.map((b, i) => (
                    <p key={i} className="text-[11px] text-muted">
                      Part {i + 1}: L {(b.laborHours || 0).toFixed(1)}h, CNC{' '}
                      {(b.cncHours || 0).toFixed(1)}h, 3D {(b.printer3DHours || 0).toFixed(1)}h
                    </p>
                  ))}
                  <p className="mt-1 text-[11px] font-medium text-primary">
                    Combined total (editable below)
                  </p>
                </div>
              )}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                <div>
                  <div className="mb-0.5 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[11px] text-muted">
                      Labor hrs
                      {laborHoursFromPart && (
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          auto
                        </span>
                      )}
                    </label>
                    <LaborSuggestion
                      suggestion={laborSuggestion}
                      onApply={() =>
                        setEditForm({ ...editForm, laborHours: laborSuggestion!.toString() })
                      }
                    />
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.laborHours}
                    onChange={(e) => {
                      setAllocationSource('total');
                      setLaborHoursFromPart(false);
                      setEditForm({ ...editForm, laborHours: e.target.value });
                    }}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                {canViewFinancials && (
                  <div>
                    <label className="mb-0.5 block text-[11px] text-muted">Rate</label>
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white">
                      ${laborRate}/hr
                    </div>
                  </div>
                )}
                {canViewFinancials && (
                  <div>
                    <label className="mb-0.5 block text-[11px] text-muted">Labor $</label>
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm font-semibold text-white">
                      ${laborCost.toFixed(2)}
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">CNC hrs</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.cncHours}
                    onChange={(e) => {
                      setAllocationSource('total');
                      setEditForm({ ...editForm, cncHours: e.target.value });
                    }}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-muted">3D hrs</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.printer3DHours}
                    onChange={(e) => {
                      setAllocationSource('total');
                      setEditForm({ ...editForm, printer3DHours: e.target.value });
                    }}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                {currentUser.isAdmin && (
                  <div>
                    <label className="mb-0.5 block text-[11px] text-muted">
                      Progress estimate %
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editForm.progressEstimatePercent}
                      onChange={(e) =>
                        setEditForm({ ...editForm, progressEstimatePercent: e.target.value })
                      }
                      className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
                      placeholder="Optional 0–100"
                    />
                  </div>
                )}
                {canViewFinancials && (
                  <div>
                    <label className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      Materials $
                      {linkedPart && (
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          from part
                        </span>
                      )}
                    </label>
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm font-semibold text-white">
                      ${displayMaterialTotal.toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
              {canViewFinancials && (
                <div className="mb-3 rounded border border-primary/30 bg-primary/10 px-2 py-1.5 text-sm font-bold text-primary">
                  {(() => {
                    const totalFromPart =
                      linkedPart && partDerivedPrice?.totalPrice
                        ? partDerivedPrice.totalPrice
                        : null;
                    const effectiveTotal =
                      totalFromPart != null && totalFromPart > 0
                        ? totalFromPart
                        : computedCostTotal;
                    return <>Total ${effectiveTotal.toFixed(2)}</>;
                  })()}
                  <span className="ml-2 text-[10px] font-normal text-primary/80">
                    (Labor + Materials + CNC + 3D)
                  </span>
                  {linkedPart &&
                    partDerivedPrice?.totalPrice != null &&
                    partDerivedPrice.totalPrice > 0 && (
                      <p className="mt-1 text-[10px] font-normal text-primary/80">
                        From part (set × qty): ${partDerivedPrice.totalPrice.toFixed(2)}
                      </p>
                    )}
                </div>
              )}
              <VariantBreakdown entries={laborBreakdownByDash?.entries ?? []} />
              <div className="border-t border-white/10 pt-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    {linkedPart ? 'Materials' : 'Materials'}
                  </span>
                </div>
                {!linkedPart ? (
                  !job.inventoryItems?.length ? (
                    <p className="text-xs text-muted">
                      No materials assigned. Add from part or manually.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {job.inventoryItems.map((item) => {
                        const invItem = item.inventoryId
                          ? inventoryById.get(item.inventoryId)
                          : undefined;
                        return (
                          <li
                            key={item.id}
                            className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  invItem && onNavigate('inventory-detail', invItem.id)
                                }
                                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-primary hover:underline"
                              >
                                {item.inventoryName || invItem?.name || 'Unknown'}
                              </button>
                              <span className="ml-2 text-[10px] text-muted">
                                {item.quantity} {item.unit}
                              </span>
                              {item.inventoryId &&
                                isMaterialAuto(item.inventoryId, item.quantity) && (
                                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                                    auto
                                  </span>
                                )}
                            </div>
                            <button
                              type="button"
                              onClick={() => item.id && onRemoveInventory(job.id, item.id)}
                              className="ml-2 rounded p-1 text-muted hover:bg-red-500/20 hover:text-red-400"
                              aria-label="Remove"
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  <p className="text-xs text-muted">From part BOM below.</p>
                )}
              </div>
            </div>

            {linkedPart && (
              <div className="rounded-sm border border-white/10 bg-white/5 p-3">
                <h3 className="mb-1.5 text-xs font-semibold text-white">
                  Part BOM ({linkedPart.partNumber})
                </h3>
                {(() => {
                  const requiredMap = computeRequiredMaterials(
                    linkedPart,
                    effectiveMaterialQuantities
                  );
                  const materialsFromPart =
                    linkedPart.variantsAreCopies && linkedPart.variants?.[0]?.materials?.length
                      ? linkedPart.variants[0].materials
                      : linkedPart.materials || [];
                  if (requiredMap.size === 0 && materialsFromPart.length === 0) {
                    return (
                      <p className="text-xs text-muted">No materials defined for this part.</p>
                    );
                  }
                  if (requiredMap.size === 0) {
                    return (
                      <p className="text-xs text-muted">
                        Set variant quantities above to see required materials.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-1.5">
                      {Array.from(requiredMap.entries()).map(
                        ([inventoryId, { quantity, unit }]) => {
                          const invItem = inventoryById.get(inventoryId);
                          const materialName = invItem?.name ?? 'Unknown';
                          return (
                            <div
                              key={inventoryId}
                              className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {invItem ? (
                                  <button
                                    type="button"
                                    onClick={() => onNavigate('inventory-detail', invItem.id)}
                                    className="truncate text-left text-xs font-medium text-primary hover:underline"
                                  >
                                    {materialName}
                                  </button>
                                ) : (
                                  <span className="truncate text-xs font-medium text-white">
                                    {materialName}
                                  </span>
                                )}
                                <span className="shrink-0 text-[10px] text-muted">
                                  {quantity.toFixed(2)} {unit}
                                </span>
                              </div>
                            </div>
                          );
                        }
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              {currentUser.isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowDeleteJobConfirm(true)}
                  disabled={isDeletingJob || isSubmitting}
                  className="min-h-[48px] touch-manipulation rounded-sm border border-red-500/40 bg-red-500/10 px-4 py-3 font-bold text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete Job
                </button>
              )}
              <button
                onClick={handleCancelEdit}
                className="flex-1 rounded-sm bg-white/10 py-3 font-bold text-white transition-colors hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSubmitting}
                className="flex-1 rounded-sm bg-primary py-3 font-bold text-on-accent transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Job section - job-level data only */}
            <div className="bg-gradient-to-br from-surface-3 to-app-2 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {job.isRush && (
                  <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-bold uppercase text-white">
                    Rush
                  </span>
                )}
                <span className="text-xs font-bold text-primary">{formatJobCode(job.jobCode)}</span>
              </div>

              {/* Reference Numbers — EST #/INV # deep-link to the real estimate/invoice (and show
                  the customer) when accounting is built in; RFQ/PO/OWR stay plain. */}
              {(job.estNumber || job.rfqNumber || job.po || job.invNumber || job.owrNumber) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {JobReferencePills ? (
                    <Suspense
                      fallback={
                        <PlainEstInvPills estNumber={job.estNumber} invNumber={displayInvNumber} />
                      }
                    >
                      <JobReferencePills estNumber={job.estNumber} invNumber={displayInvNumber} />
                    </Suspense>
                  ) : (
                    <PlainEstInvPills estNumber={job.estNumber} invNumber={displayInvNumber} />
                  )}
                  {job.rfqNumber && (
                    <span className="rounded bg-orange-500/20 px-2 py-1 text-xs font-medium text-orange-300">
                      RFQ #{job.rfqNumber}
                    </span>
                  )}
                  {job.po && (
                    <span className="rounded bg-blue-500/20 px-2 py-1 text-xs font-medium text-blue-300">
                      PO #{job.po}
                    </span>
                  )}
                  {job.owrNumber && (
                    <span className="rounded bg-cyan-500/20 px-2 py-1 text-xs font-medium text-cyan-300">
                      OWR# {job.owrNumber}
                    </span>
                  )}
                </div>
              )}

              {/* Job info grid: Due, Status, ECD, Bin */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-muted">Due Date</p>
                  <p className="text-sm font-bold text-white">{formatDateOnly(job.dueDate)}</p>
                </div>
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-muted">Status</p>
                  <StatusBadge status={job.status} size="sm" />
                </div>
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-muted">ECD</p>
                  <p className="text-sm font-bold text-white">{formatDateOnly(job.ecd)}</p>
                </div>
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-muted">Bin</p>
                  <p className="text-sm font-bold text-white">{job.binLocation || '—'}</p>
                </div>
              </div>

              {/* Timer if clocked in - Compact */}
              {isClockedIn && (
                <div className="mb-2 rounded-sm border border-green-500/30 bg-green-500/20 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-sm bg-green-500"></div>
                      <span className="text-xs font-medium text-green-400">Active</span>
                    </div>
                    <span className="font-mono text-xl font-bold text-green-400">{timer}</span>
                  </div>
                </div>
              )}

              {currentUser.isAdmin && (
                <div className="mb-3 rounded-sm border border-white/10 bg-white/5 p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                      Completion
                    </p>
                    <div className="flex items-center gap-2">
                      {completionProgress.laborOverEstimate && (
                        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                          Over estimate – review
                        </span>
                      )}
                      {completionProgress.atRiskFromProgressEstimate && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                          At risk
                        </span>
                      )}
                      <span className="text-sm font-bold text-white">
                        {completionProgress.weightedPercent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all ${
                        completionProgress.laborOverEstimate ? 'bg-red-500' : 'bg-primary'
                      }`}
                      style={{ width: `${completionProgress.weightedPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                    <span>L {completionProgress.laborPercent.toFixed(0)}%</span>
                    <span>CNC {completionProgress.cncPercent.toFixed(0)}%</span>
                    <span>3D {completionProgress.printer3DPercent.toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                    <span className="text-[10px] text-subtle">Progress estimate %</span>
                    <ProgressEstimateInput
                      value={progressEstimateInput}
                      onChange={setProgressEstimateInput}
                      onSave={async () => {
                        const v = progressEstimateInput.trim();
                        const num =
                          v === '' ? null : Math.max(0, Math.min(100, parseFloat(v) || 0));
                        try {
                          const updated = await onUpdateJob(job.id, {
                            progressEstimatePercent: num,
                          });
                          if (!updated) {
                            showToast('Failed to update progress estimate', 'error');
                            return;
                          }
                          showToast(
                            num != null ? 'Progress estimate set' : 'Progress estimate cleared',
                            'success'
                          );
                        } catch {
                          showToast('Failed to update progress estimate', 'error');
                        }
                      }}
                      onClear={async () => {
                        setProgressEstimateInput('');
                        try {
                          const updated = await onUpdateJob(job.id, {
                            progressEstimatePercent: null,
                          });
                          if (!updated) {
                            showToast('Failed to clear', 'error');
                            return;
                          }
                          showToast('Progress estimate cleared', 'success');
                        } catch {
                          showToast('Failed to clear', 'error');
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Billing — the job's customer + linked estimates/invoices (admin-only;
                  zero accounting code in flag-off builds). */}
              {JobBillingPanel && canViewFinancials && (
                <div className="mb-3">
                  <Suspense fallback={null}>
                    <JobBillingPanel job={job} />
                  </Suspense>
                </div>
              )}

              {/* Time / Shifts - list and link to Time Reports */}
              <div className="mb-3 rounded-sm border border-white/10 bg-white/5 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Time</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('time-reports', job.id)}
                    className="rounded border border-primary/40 bg-primary/20 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/30"
                  >
                    View in Time Reports
                  </button>
                </div>
                {(() => {
                  const jobShiftsAll = shifts
                    .filter((s) => s.job === job.id)
                    .sort(
                      (a, b) =>
                        new Date(b.clockInTime).getTime() - new Date(a.clockInTime).getTime()
                    );
                  const jobShifts = currentUser.isAdmin
                    ? jobShiftsAll
                    : jobShiftsAll.filter((s) => s.user === currentUser.id);
                  const hoursSummary = currentUser.isAdmin
                    ? loggedLaborHours
                    : calculateJobHoursFromShifts(
                        job.id,
                        shifts.filter((s) => s.job === job.id && s.user === currentUser.id)
                      );
                  if (jobShifts.length === 0) {
                    return (
                      <p className="text-xs text-subtle">
                        {currentUser.isAdmin
                          ? 'No time logged yet. Use Time Reports to add or view shifts.'
                          : 'No time logged on this job for you yet.'}
                      </p>
                    );
                  }
                  const estRemaining =
                    currentUser.isAdmin && completionProgress.remainingLaborHours > 0
                      ? completionProgress.remainingLaborHours
                      : null;

                  return (
                    <div className="space-y-1">
                      <p className="mb-1.5 text-xs text-muted">
                        {currentUser.isAdmin ? (
                          <>
                            {hoursSummary.toFixed(1)}h total · {jobShifts.length} shift
                            {jobShifts.length !== 1 ? 's' : ''}
                            {estRemaining != null && (
                              <span className="ml-1.5 font-medium text-primary">
                                · Est. remaining: {estRemaining.toFixed(1)}h
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {hoursSummary.toFixed(1)}h your time · {jobShifts.length} shift
                            {jobShifts.length !== 1 ? 's' : ''}
                          </>
                        )}
                      </p>
                      {jobShifts.slice(0, 5).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onNavigate('time-reports', job.id)}
                          className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-[10px] transition-colors hover:bg-white/10"
                        >
                          <span className="text-muted">
                            {formatDateOnly(s.clockInTime)} · {s.userName || s.userInitials || '—'}
                          </span>
                          <span className="font-medium text-white">
                            {formatDurationHours(getWorkedShiftMs(s))}
                          </span>
                        </button>
                      ))}
                      {jobShifts.length > 5 && (
                        <button
                          type="button"
                          onClick={() => onNavigate('time-reports', job.id)}
                          className="w-full pt-1 text-left text-[10px] text-subtle transition-colors hover:text-primary"
                        >
                          +{jobShifts.length - 5} more · View in Time Reports
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              {cncAbleKeys.length > 0 && (
                <UnitProgressAccordion
                  title="CNC"
                  subtitle="Mark units CNC-done — deducts foam"
                  accent="amber"
                  variantKeys={cncAbleKeys}
                  unitCounts={unitCounts}
                  doneCounts={job.cncDoneByVariant ?? {}}
                  onAdjust={handleCncAdjust}
                />
              )}

              {hasUnitsToTrack && (
                <UnitProgressAccordion
                  title="Units Done"
                  subtitle="Mark units fully finished — deducts the rest"
                  accent="green"
                  variantKeys={allVariantKeys}
                  unitCounts={unitCounts}
                  doneCounts={job.unitsDoneByVariant ?? {}}
                  onAdjust={handleUnitAdjust}
                />
              )}

              {currentUser.isAdmin && is3DPrintRequired && (
                <MachineCompletionSection
                  type="printer3d"
                  completedAt={job.printer3DCompletedAt}
                  onToggle={handleToggle3DPrintDone}
                  canToggle={currentUser.isAdmin && is3DPrintRequired}
                />
              )}

              {/* Bin Location - Compact */}
              {job.binLocation && (
                <button
                  onClick={() => setShowBinLocationScanner(true)}
                  className="flex w-full items-center justify-between rounded-sm border border-primary/30 bg-primary/10 p-2.5 transition-colors hover:bg-primary/15"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="material-symbols-outlined text-base text-primary">
                      location_on
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase text-muted">Bin Location</p>
                      <p className="truncate font-mono text-sm font-bold text-white">
                        {job.binLocation}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-base text-primary">
                    chevron_right
                  </span>
                </button>
              )}

              {!job.binLocation && currentUser.isAdmin && (
                <button
                  onClick={() => setShowBinLocationScanner(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-sm border border-white/10 bg-white/5 p-2.5 transition-colors hover:bg-white/10"
                >
                  <span className="material-symbols-outlined text-base text-primary">
                    add_location
                  </span>
                  <span className="text-sm font-medium text-white">Add Bin Location</span>
                </button>
              )}
            </div>

            {/* Part section(s) - one block per part */}
            {(() => {
              const viewParts: JobPartLink[] =
                job.parts && job.parts.length > 0
                  ? job.parts
                  : // A no-variant job may be linked by part number only (no part id). Still
                    // render the part card from whatever identity exists so the part
                    // number/name/rev and quantity don't silently disappear.
                    job.partId || job.partNumber
                    ? [
                        {
                          partId: job.partId ?? '',
                          partNumber: job.partNumber ?? '',
                          dashQuantities: job.dashQuantities ?? {},
                          rev: job.partRev,
                        },
                      ]
                    : [];
              return (
                <>
                  {viewParts.map((link, idx) => (
                    <div key={link.partId || link.partNumber || idx} className="p-4 pt-0">
                      <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                          Part {viewParts.length > 1 ? idx + 1 : ''}
                        </p>
                        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div>
                            <p className="mb-0.5 text-[10px] font-bold uppercase text-muted">
                              Part Number
                            </p>
                            <p className="font-mono text-sm font-bold text-primary">
                              {link.partNumber || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="mb-0.5 text-[10px] font-bold uppercase text-muted">
                              Part Name
                            </p>
                            <p className="text-sm font-medium text-white">
                              {(viewParts.length > 1
                                ? linkedParts?.[idx]?.name
                                : linkedPart?.name) || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="mb-0.5 text-[10px] font-bold uppercase text-muted">
                              Part Rev
                            </p>
                            <p className="text-sm font-medium text-white">
                              {link.rev ?? (idx === 0 ? job.partRev : null) ?? '—'}
                            </p>
                          </div>
                        </div>
                        {Object.keys(link.dashQuantities ?? {}).length > 0 ? (
                          <div className="mb-2 rounded-sm border border-white/10 bg-white/5 p-2">
                            <p className="mb-1 text-[10px] font-bold uppercase text-muted">
                              Variants & quantities
                            </p>
                            <p className="text-sm font-medium text-white">
                              {formatDashSummary(link.dashQuantities!)} →{' '}
                              {totalFromDashQuantities(link.dashQuantities!)} total
                            </p>
                          </div>
                        ) : (
                          // No variants: still surface the job's total quantity so a no-variant
                          // part isn't left without a quantity readout.
                          idx === 0 &&
                          job.qty && (
                            <div className="mb-2 rounded-sm border border-white/10 bg-white/5 p-2">
                              <p className="mb-1 text-[10px] font-bold uppercase text-muted">
                                Quantity
                              </p>
                              <p className="text-sm font-medium text-white">{job.qty}</p>
                            </div>
                          )
                        )}
                        {perPartBreakdowns && perPartBreakdowns[idx] && (
                          <div className="flex flex-wrap gap-3 text-[11px] text-muted">
                            <span>
                              Labor {(perPartBreakdowns[idx].laborHours || 0).toFixed(1)}h
                            </span>
                            <span>CNC {(perPartBreakdowns[idx].cncHours || 0).toFixed(1)}h</span>
                            <span>
                              3D {(perPartBreakdowns[idx].printer3DHours || 0).toFixed(1)}h
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {currentUser.isAdmin &&
                    !partsLocked &&
                    (job.partId || job.partNumber || (job.parts && job.parts.length > 0)) &&
                    !showAddPartToJob && (
                      <div className="px-4 pb-2">
                        <button
                          type="button"
                          onClick={() => setShowAddPartToJob(true)}
                          className="flex items-center gap-2 rounded border border-dashed border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:bg-white/10 hover:text-primary"
                        >
                          <span className="material-symbols-outlined text-base">add</span>
                          Add part to job
                        </button>
                      </div>
                    )}
                  {currentUser.isAdmin && !partsLocked && showAddPartToJob && (
                    <div className="mx-4 mb-2 rounded-sm border border-primary/40 bg-primary/10 p-3">
                      <p className="mb-2 text-xs font-medium text-primary">
                        Select part to add to this job
                      </p>
                      <PartSelector
                        onSelect={handleAddPartToExistingJob}
                        onPartNumberResolved={(partNumber, matchedPart) => {
                          if (matchedPart === null && !partNumber.trim())
                            setShowAddPartToJob(false);
                        }}
                        isAdmin={currentUser.isAdmin}
                        showPrices={currentUser.isAdmin}
                      />
                      <button
                        type="button"
                        onClick={() => setShowAddPartToJob(false)}
                        className="mt-2 text-xs text-muted underline hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Multi-part totals - combined labor/CNC/3D for scheduling */}
            {job.parts && job.parts.length > 1 && (
              <div className="p-4 pt-0">
                <div className="rounded-sm border border-primary/40 bg-primary/20 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">
                    Multi-part totals
                  </p>
                  <div className="flex flex-wrap gap-4 text-sm font-medium text-white">
                    <span>Labor {(job.laborHours ?? 0).toFixed(1)}h</span>
                    <span>CNC {machineTotals.cncHours.toFixed(1)}h</span>
                    <span>3D {machineTotals.printer3DHours.toFixed(1)}h</span>
                  </div>
                  <p className="mt-2 text-[10px] text-muted">Materials combined below</p>
                </div>
              </div>
            )}

            {/* Currently Working */}
            {job.workers && job.workers.length > 0 && (
              <div className="p-3 pt-0">
                <div className="rounded-sm bg-app-2 p-3">
                  <p className="mb-2 text-xs text-muted">Currently Working:</p>
                  <div className="flex flex-wrap gap-2">
                    {job.workers.map((initials, idx) => (
                      <div
                        key={idx}
                        className="flex size-8 items-center justify-center rounded-sm border-2 border-green-500 bg-green-500/20"
                      >
                        <span className="text-xs font-bold text-green-400">{initials}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {job.description && (
              <div className="p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
                  <span className="material-symbols-outlined text-lg text-primary">
                    description
                  </span>
                  Description
                </h3>
                <div className="max-h-96 space-y-2 overflow-y-auto rounded-sm bg-surface-2 p-3 text-sm text-muted">
                  {job.description.split('\n').map((line, idx) => {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('http')) {
                      const urlParts = trimmedLine.split('/');
                      const lastPart =
                        urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || 'Link';
                      const displayName = lastPart.split('-').slice(1).join(' ') || lastPart;

                      return (
                        <a
                          key={idx}
                          href={trimmedLine}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs text-primary hover:underline"
                          title={trimmedLine}
                        >
                          <span className="material-symbols-outlined align-middle text-sm">
                            link
                          </span>{' '}
                          {displayName.substring(0, 60)}
                        </a>
                      );
                    }
                    return trimmedLine ? (
                      <p key={idx} className="whitespace-pre-wrap">
                        {line}
                      </p>
                    ) : (
                      <div key={idx} className="h-1" />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Checklist Section */}
            <div className="p-3 pt-0">
              <ChecklistDisplay
                jobId={job.id}
                jobStatus={job.status}
                currentUser={currentUser}
                jobInventoryItems={job.inventoryItems}
                compact={false}
                onChecklistComplete={handleChecklistComplete}
              />
            </div>

            <div>
              {linkedPart ? (
                <div className="p-3 pt-0">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                    <span className="material-symbols-outlined text-lg text-primary">
                      inventory_2
                    </span>
                    Part BOM ({linkedPart.partNumber})
                  </h3>
                  {(() => {
                    const jobDashQty = buildEffectivePartQuantities(
                      linkedPart,
                      job.dashQuantities || {},
                      job.qty
                    );
                    const requiredMap = computeRequiredMaterials(linkedPart, jobDashQty);
                    const materialsFromPart =
                      linkedPart.variantsAreCopies && linkedPart.variants?.[0]?.materials?.length
                        ? linkedPart.variants[0].materials
                        : linkedPart.materials || [];
                    if (requiredMap.size === 0 && materialsFromPart.length === 0) {
                      return (
                        <div className="rounded-sm bg-surface-2 p-3 text-center">
                          <p className="text-sm text-muted">No materials defined for this part.</p>
                        </div>
                      );
                    }
                    if (requiredMap.size === 0) {
                      return (
                        <div className="rounded-sm bg-surface-2 p-3 text-center">
                          <p className="text-sm text-muted">
                            Set variant quantities to see required materials.
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        {Array.from(requiredMap.entries()).map(
                          ([inventoryId, { quantity, unit }]) => {
                            const invItem = inventoryById.get(inventoryId);
                            const materialName = invItem?.name ?? 'Unknown';
                            return (
                              <div
                                key={inventoryId}
                                className="flex items-center justify-between overflow-hidden rounded-sm bg-surface-2 p-3"
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                  {invItem ? (
                                    <button
                                      type="button"
                                      onClick={() => onNavigate('inventory-detail', invItem.id)}
                                      className="-ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm p-1 text-left transition-colors hover:bg-white/5"
                                    >
                                      <span className="truncate font-medium text-primary hover:underline">
                                        {materialName}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="truncate font-medium text-white">
                                      {materialName}
                                    </span>
                                  )}
                                  <span className="shrink-0 text-xs text-muted">
                                    {quantity.toFixed(2)} {unit}
                                  </span>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <JobInventory
                  job={job}
                  inventory={inventory}
                  inventoryById={inventoryById}
                  calculateAvailable={calculateAvailable}
                  currentUserIsAdmin={currentUser.isAdmin}
                  isSubmitting={isSubmitting}
                  onNavigate={onNavigate}
                  isMaterialAuto={isMaterialAuto}
                  materialBomScopes={materialBomScopes}
                  onAddInventory={handleAddInventory}
                  onRemoveInventory={onRemoveInventory}
                />
              )}
            </div>

            {/* Drawings: part drawing files are the only files standard users can access */}
            <div className="p-3 pt-0">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <span className="material-symbols-outlined text-lg text-primary">
                  picture_as_pdf
                </span>
                Drawings
              </h3>
              {partDrawings.length > 0 ? (
                <div className="space-y-2">
                  {partDrawings.map((drawing) => (
                    <button
                      key={drawing.id}
                      onClick={() => window.open(drawing.url, '_blank')}
                      className="flex min-h-[48px] w-full touch-manipulation items-center gap-3 rounded-sm border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10"
                    >
                      <span className="material-symbols-outlined text-primary">picture_as_pdf</span>
                      <span className="truncate font-medium text-white">{drawing.filename}</span>
                      <span className="material-symbols-outlined ml-auto text-muted">
                        open_in_new
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-sm text-subtle">
                  {job.partId
                    ? 'No drawings on file for this part.'
                    : 'No part linked — no drawings.'}
                </p>
              )}
            </div>

            {/* Admin Files Section (Admin Only) */}
            {currentUser.isAdmin && (
              <div className="p-3 pt-0">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <span className="material-symbols-outlined text-lg text-red-400">
                      admin_panel_settings
                    </span>
                    Admin Files ({adminAttachments.length})
                  </h3>
                  <FileUploadButton
                    onUpload={(file) => handleFileUpload(file, true)}
                    label="Upload Admin File"
                  />
                </div>

                <AttachmentsList
                  attachments={adminAttachments}
                  onViewAttachment={handleViewAttachment}
                  canUpload={true}
                  showUploadButton={false}
                  showAdminOnlyToggle={!!onUpdateAttachmentAdminOnly}
                  onToggleAdminOnly={
                    onUpdateAttachmentAdminOnly ? handleToggleAttachmentAdminOnly : undefined
                  }
                  canDelete={currentUser.isAdmin}
                  onDeleteAttachment={
                    currentUser.isAdmin
                      ? async (id) => {
                          const ok = await onDeleteAttachment(id);
                          if (ok && onReloadJob) await onReloadJob();
                          return ok;
                        }
                      : undefined
                  }
                />
              </div>
            )}

            {/* Job Attachments Section (visible to all; upload/toggle for admins only) */}
            <div className="p-3 pt-0">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  <span className="material-symbols-outlined text-lg text-primary">
                    attach_file
                  </span>
                  Job Attachments ({regularAttachments.length})
                </h3>
                {currentUser.isAdmin && (
                  <FileUploadButton
                    onUpload={(file) => handleFileUpload(file, false)}
                    label="Upload File"
                  />
                )}
              </div>

              <AttachmentsList
                attachments={regularAttachments}
                onViewAttachment={handleViewAttachment}
                canUpload={currentUser.isAdmin}
                showUploadButton={false}
                showAdminOnlyToggle={currentUser.isAdmin && !!onUpdateAttachmentAdminOnly}
                onToggleAdminOnly={
                  currentUser.isAdmin && onUpdateAttachmentAdminOnly
                    ? handleToggleAttachmentAdminOnly
                    : undefined
                }
                canDelete={currentUser.isAdmin}
                onDeleteAttachment={
                  currentUser.isAdmin
                    ? async (id) => {
                        const ok = await onDeleteAttachment(id);
                        if (ok && onReloadJob) await onReloadJob();
                        return ok;
                      }
                    : undefined
                }
              />
            </div>

            <DeliveriesSection job={job} currentUser={currentUser} />

            {currentUser.isAdmin && (
              <JobStatusHistory jobId={job.id} isAdmin={currentUser.isAdmin} />
            )}

            <div>
              <JobComments
                comments={job.comments || []}
                currentUser={currentUser}
                newComment={newComment}
                setNewComment={setNewComment}
                isSubmitting={isSubmitting}
                onSubmitComment={handleSubmitComment}
                editingCommentId={editingCommentId}
                editingCommentText={editingCommentText}
                setEditingCommentId={setEditingCommentId}
                setEditingCommentText={setEditingCommentText}
                onUpdateComment={handleUpdateComment}
                onDeleteComment={handleDeleteComment}
                formatCommentTime={formatCommentTime}
                users={users}
              />
            </div>
          </>
        )}
      </main>

      {!isEditing && (
        <div className="pb-safe fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-background-dark/95 p-3 backdrop-blur-md">
          <div className="flex gap-3">
            {isClockedIn ? (
              <button
                onClick={() => void handleClockOut()}
                className="flex-1 rounded-sm bg-red-500 py-3 font-bold text-white transition-colors hover:bg-red-600 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined mr-2 align-middle">logout</span>
                Clock Out
              </button>
            ) : (
              <button
                onClick={handleClockIn}
                className="flex-1 rounded-sm bg-green-500 py-3 font-bold text-white transition-colors hover:bg-green-600 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined mr-2 align-middle">login</span>
                Clock In
              </button>
            )}
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      {viewingAttachment && (
        <FileViewer
          attachment={viewingAttachment}
          onClose={handleCloseViewer}
          onDelete={handleDeleteAttachment}
          canDelete={currentUser.isAdmin}
        />
      )}

      {/* Bin Location Scanner Modal */}
      {showBinLocationScanner && (
        <BinLocationScanner
          currentLocation={isEditing ? editForm.binLocation : job.binLocation}
          onLocationUpdate={(location) => {
            if (isEditing) {
              setEditForm({ ...editForm, binLocation: location });
              setShowBinLocationScanner(false);
              // Persist immediately so scanned location is saved without requiring Save
              handleBinLocationUpdate(location);
            } else {
              handleBinLocationUpdate(location);
              setShowBinLocationScanner(false);
            }
          }}
          onClose={() => setShowBinLocationScanner(false)}
        />
      )}

      <ConfirmDialog
        isOpen={!!pendingUnitConfirm}
        title="Is CNC also done?"
        message="You're marking units fully done whose CNC wasn't logged yet. Is the CNC also finished for those units? Yes pulls the foam too; No leaves CNC pending."
        confirmText="Yes, CNC done"
        cancelText="No"
        onConfirm={() => {
          const p = pendingUnitConfirm;
          setPendingUnitConfirm(null);
          if (p) void applyProgress(p.delta, p.variantKey, p.delta);
        }}
        onCancel={() => {
          const p = pendingUnitConfirm;
          setPendingUnitConfirm(null);
          if (p) void applyProgress(0, p.variantKey, p.delta);
        }}
      />

      <ConfirmDialog
        isOpen={showDeleteJobConfirm}
        title="Delete this job?"
        message="This will permanently remove the job and its linked records. This cannot be undone."
        confirmText={isDeletingJob ? 'Deleting...' : 'Delete Job'}
        cancelText="Cancel"
        destructive
        onConfirm={handleConfirmDeleteJob}
        onCancel={() => !isDeletingJob && setShowDeleteJobConfirm(false)}
      />

      <ConfirmDialog
        isOpen={!!pendingDeleteCommentId}
        title="Delete this comment?"
        message="This comment will be permanently removed."
        confirmText="Delete Comment"
        cancelText="Cancel"
        destructive
        onConfirm={handleConfirmDeleteComment}
        onCancel={() => setPendingDeleteCommentId(null)}
      />
    </div>
  );
};

export default JobDetail;
