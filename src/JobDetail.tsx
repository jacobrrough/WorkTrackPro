import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { useClockIn } from '@/contexts/ClockInContext';
import { useLocation } from 'react-router-dom';
import { useThrottle } from '@/useThrottle';
import {
  syncJobInventoryFromPart,
  syncJobInventoryFromParts,
  computeRequiredMaterials,
  type PartWithDashQuantities,
} from '@/lib/partsCalculations';
import { syncPartMaterialFromJobQuantity } from '@/lib/materialFromPart';
import { buildPartVariantDefaults, computeVariantBreakdown } from '@/lib/variantAllocation';
import {
  variantLaborFromSetComposition,
  variantCncFromSetComposition,
  variantPrinter3DFromSetComposition,
} from '@/lib/partDistribution';
import type { VariantDefaultOverrides } from '@/lib/variantAllocation';
import { useApp } from '@/AppContext';
import { getDashQuantity, normalizeDashQuantities, toDashSuffix } from '@/lib/variantMath';
import { canViewJobFinancials, shouldComputeJobFinancials } from '@/lib/priceVisibility';
import { calculateJobPriceFromPart, calculateJobPriceFromParts } from '@/lib/jobPriceFromPart';
import { useMaterialSync } from '@/features/jobs/hooks/useMaterialSync';
import {
  useMaterialCosts,
  computePartDerivedMaterialTotal,
} from '@/features/jobs/hooks/useMaterialCosts';
import { useVariantBreakdown } from '@/features/jobs/hooks/useVariantBreakdown';
import { getMachineTotalsFromJob } from '@/lib/machineHours';
import { computeJobCompletionProgress } from '@/lib/jobProgress';
import JobComments from '@/features/jobs/components/JobComments';
import JobInventory from '@/features/jobs/components/JobInventory';
import JobDetailHeaderBar from '@/features/jobs/components/JobDetailHeaderBar';
import ConfirmDialog from './ConfirmDialog';
import PartSelector from '@/components/PartSelector';

interface JobDetailProps {
  job: Job;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  isClockedIn: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
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

function parseQuantityFromText(value: string | undefined | null): number {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildEffectivePartQuantities(
  part: Part | null,
  dashQuantities: Record<string, number>,
  qtyText: string | undefined | null
): Record<string, number> {
  const normalizedDash = normalizeDashQuantities(dashQuantities);
  if (Object.values(normalizedDash).some((qty) => qty > 0)) return normalizedDash;
  if (!part) return normalizedDash;

  const totalQty = parseQuantityFromText(qtyText);
  if (totalQty <= 0) return normalizedDash;

  if (!part.variants?.length) {
    return { '-01': totalQty };
  }

  // Multi-variant fallback: derive dash quantities from set composition × set qty.
  if (part.setComposition && Object.keys(part.setComposition).length > 0) {
    const fromSetCount: Record<string, number> = {};
    for (const variant of part.variants) {
      const qtyPerSet = getDashQuantity(part.setComposition, variant.variantSuffix);
      if (qtyPerSet > 0) {
        fromSetCount[toDashSuffix(variant.variantSuffix)] = qtyPerSet * totalQty;
      }
    }
    const normalizedFromSetCount = normalizeDashQuantities(fromSetCount);
    if (Object.keys(normalizedFromSetCount).length > 0) return normalizedFromSetCount;
  }

  // Copy/single-variant fallback when set composition is missing.
  if (part.variantsAreCopies || part.variants.length === 1) {
    return { [toDashSuffix(part.variants[0].variantSuffix)]: totalQty };
  }

  return normalizedDash;
}

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

/**
 * When the Part has set composition and set-level labor/CNC/3D, use those so the job card
 * matches the Part's quote calculator (e.g. 12.74 labor, 1.0 CNC per set). Otherwise use
 * variant-level sums from buildPartVariantDefaults.
 */
function getPartDerivedDefaultsForJob(
  part: (Part & { variants?: PartVariant[] }) | null,
  dashQuantities: Record<string, number>
): VariantDefaultOverrides {
  const defaults = buildPartVariantDefaults(part, dashQuantities);
  if (
    !part?.variants?.length ||
    !part?.setComposition ||
    Object.keys(part.setComposition).length === 0
  ) {
    return defaults;
  }
  const setLabor = Number(part.laborHours) || 0;
  const setCnc = Number(part.cncTimeHours) || 0;
  const setPrinter = Number(part.printer3DTimeHours) || 0;
  if (setLabor <= 0 && setCnc <= 0 && setPrinter <= 0) return defaults;

  const normalizedDash = normalizeDashQuantities(dashQuantities);
  const { completeSets } = calculateSetCompletion(normalizedDash, part.setComposition);
  const setCount = completeSets > 0 ? completeSets : 1;

  const laborPerUnit: Record<string, number> = { ...defaults.laborPerUnit };
  const machinePerUnit: Record<
    string,
    { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }
  > = { ...defaults.machinePerUnit };

  for (const v of part.variants) {
    const key = toDashSuffix(v.variantSuffix);
    if (setLabor > 0) {
      const val = variantLaborFromSetComposition(v.variantSuffix, setLabor, part.setComposition);
      laborPerUnit[key] = val ?? 0;
    }
    if (setCnc > 0 || setPrinter > 0) {
      const cncVal =
        setCnc > 0
          ? variantCncFromSetComposition(v.variantSuffix, setCnc, part.setComposition)
          : undefined;
      const printerVal =
        setPrinter > 0
          ? variantPrinter3DFromSetComposition(v.variantSuffix, setPrinter, part.setComposition)
          : undefined;
      machinePerUnit[key] = {
        cncHoursPerUnit: cncVal ?? 0,
        printer3DHoursPerUnit: printerVal ?? 0,
      };
    }
  }

  return {
    laborPerUnit,
    machinePerUnit,
    totals: {
      laborHours: setLabor * setCount,
      cncHours: setCnc * setCount,
      printer3DHours: setPrinter * setCount,
    },
  };
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
  const { advanceJobToNextStatus } = useApp();
  const handleClockIn = useCallback(() => {
    if (clockInCtx?.clockIn) {
      clockInCtx.clockIn(job.id);
      return;
    }
    onClockIn();
  }, [clockInCtx, job.id, onClockIn]);
  const handleChecklistComplete = useCallback(async () => {
    await advanceJobToNextStatus(job.id, job.status);
    await onReloadJob?.();
  }, [advanceJobToNextStatus, job.id, job.status, onReloadJob]);

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
  const { showToast } = useToast();
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
  const isCncRequired = completionProgress.plannedCncHours > 0;

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
        : []
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
        : [];
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
    progressEstimatePercent:
      job.progressEstimatePercent != null ? String(job.progressEstimatePercent) : '',
  });
  const [progressEstimateInput, setProgressEstimateInput] = useState(
    job.progressEstimatePercent != null ? String(job.progressEstimatePercent) : ''
  );

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
    Promise.all(
      job.parts.map((link) =>
        partsService.getPartWithVariants(link.partId).then((p) => (cancelled ? null : p))
      )
    ).then((parts) => {
      if (!cancelled) setLinkedParts(parts);
    });
    return () => {
      cancelled = true;
    };
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
    const defaults = getPartDerivedDefaultsForJob(linkedPart, dashQuantities);
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
    allocationSource,
    variantAllocation.totals,
    variantAllocation.totals?.laborHours,
    variantAllocation.totals?.cncHours,
    variantAllocation.totals?.printer3DHours,
  ]);

  // Search for part by part number (reserved for future part search UI)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handlePartNumberSearch = useCallback(async () => {
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

  const handleSubmitComment = async () => {
    if (!newComment.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const comment = await onAddComment(job.id, newComment.trim());
      if (comment) {
        setNewComment('');
        // Comment added successfully - the parent will refresh the job data
      } else {
        console.error('Failed to add comment - no comment returned');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
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
    const shouldAutoMarkCncDone =
      Boolean(normalizedBinLocation) && isCncRequired && !job.cncCompletedAt;
    const partsToSave =
      editingParts.length > 0
        ? editingParts.map((p, i) =>
            i === 0 ? { ...p, dashQuantities: normalizedDashQuantities } : p
          )
        : undefined;
    const payload = {
      ...(partsToSave && partsToSave.length > 0 ? { parts: partsToSave } : {}),
      partNumber,
      revision,
      po,
      description: editForm.description?.trim() || undefined,
      dueDate: dateInputToISO(editForm.dueDate),
      ecd: dateInputToISO(editForm.ecd),
      qty: editForm.qty?.trim() || undefined,
      // Always persist labor hours when form has a value (fixes jobs without variants not registering)
      laborHours: (() => {
        const v = editForm.laborHours?.trim();
        if (v === '' || v == null) return undefined;
        const n = parseFloat(v);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      })(),
      status: editForm.status,
      isRush: editForm.isRush,
      progressEstimatePercent:
        editForm.progressEstimatePercent?.trim() !== ''
          ? Math.max(0, Math.min(100, parseFloat(editForm.progressEstimatePercent) || 0))
          : undefined,
      binLocation: normalizedBinLocation,
      cncCompletedAt: shouldAutoMarkCncDone ? new Date().toISOString() : undefined,
      cncCompletedBy: shouldAutoMarkCncDone ? currentUser.id : undefined,
      variantSuffix: selectedVariant
        ? selectedVariant.variantSuffix
        : editForm.variantSuffix?.trim() || undefined,
      estNumber,
      invNumber: editForm.invNumber?.trim() || undefined,
      rfqNumber: editForm.rfqNumber?.trim() || undefined,
      owrNumber: editForm.owrNumber?.trim() || undefined,
      dashQuantities:
        Object.keys(normalizedDashQuantities).length > 0 ? normalizedDashQuantities : undefined,
      laborBreakdownByVariant:
        Object.keys(persistedLaborBreakdown).length > 0 ? persistedLaborBreakdown : undefined,
      machineBreakdownByVariant:
        Object.keys(persistedMachineBreakdown).length > 0 ? persistedMachineBreakdown : undefined,
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
        if (partsForSync.length > 1 && hasAnyPartQty) {
          try {
            await syncJobInventoryFromParts(job.id, partsForSync, { replace: true });
            await onReloadJob?.();
          } catch (syncErr) {
            console.error('Material sync after save (multi-part):', syncErr);
            showToast(
              'Job saved; material sync failed. Use Auto-assign materials to retry.',
              'warning'
            );
          }
        } else if (partsForSync.length === 1 && partsForSync[0].part && hasAnyPartQty) {
          try {
            await syncJobInventoryFromPart(
              job.id,
              partsForSync[0].part,
              partsForSync[0].dashQuantities,
              { replace: true }
            );
            await onReloadJob?.();
          } catch (syncErr) {
            console.error('Material sync after save:', syncErr);
            showToast(
              'Job saved; material sync failed. Use Auto-assign materials to retry.',
              'warning'
            );
          }
        } else if (linkedPart && Object.values(effectiveMaterialQuantities).some((q) => q > 0)) {
          try {
            await syncJobInventoryFromPart(job.id, linkedPart!, effectiveMaterialQuantities, {
              replace: true,
            });
            await onReloadJob?.();
          } catch (syncErr) {
            console.error('Material sync after save:', syncErr);
            showToast(
              'Job saved; material sync failed. Use Auto-assign materials to retry.',
              'warning'
            );
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
              },
            ]
          : []
    );
    setIsEditing(false);
  };

  const handleAutoAssignMaterials = async () => {
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
      console.error('Auto-assign materials:', err);
      showToast('Failed to auto-assign materials', 'error');
    } finally {
      setSyncingMaterials(false);
    }
  };

  const handleAddPartToExistingJob = useCallback(
    async (part: Part, dashQuantitiesForPart: Record<string, number>) => {
      const currentParts: JobPartLink[] =
        job.parts?.length > 0
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
            try {
              const hasAnyQty = partsWithPartData.some((p) =>
                Object.values(p.dashQuantities).some((q) => q > 0)
              );
              if (hasAnyQty) {
                await syncJobInventoryFromParts(job.id, partsWithPartData, { replace: true });
                showToast('Materials combined from all parts', 'success');
              }
            } catch (syncErr) {
              console.error('Material sync after add part:', syncErr);
              showToast('Part added; sync materials from job if needed', 'warning');
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
              const laborUpdated = await onUpdateJob(job.id, { laborHours: combinedLabor });
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
    [
      job.id,
      job.partId,
      job.partNumber,
      job.dashQuantities,
      job.parts,
      onUpdateJob,
      onReloadJob,
      showToast,
    ]
  );

  const handleAddInventory = useCallback(
    async (jobId: string, inventoryId: string, quantity: number, unit: string) => {
      await onAddInventory(jobId, inventoryId, quantity, unit);
      if (linkedPart && jobId === job.id) {
        try {
          await syncPartMaterialFromJobQuantity(
            linkedPart,
            dashQuantities,
            inventoryId,
            quantity,
            unit
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
    const defaults = getPartDerivedDefaultsForJob(linkedPart, dashQuantities);
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

    const operation = (async () => {
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
        pendingAttachmentTogglesRef.current.delete(operation);
        setPendingAttachmentToggleCount((prev) => Math.max(0, prev - 1));
      }
    })();

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
      const shouldAutoMarkCncDone =
        Boolean(normalizedLocation) && isCncRequired && !job.cncCompletedAt;
      const updated = await onUpdateJob(job.id, {
        binLocation: normalizedLocation,
        cncCompletedAt: shouldAutoMarkCncDone ? new Date().toISOString() : undefined,
        cncCompletedBy: shouldAutoMarkCncDone ? currentUser.id : undefined,
      });

      if (updated && onReloadJob) {
        await onReloadJob();
      }
      if (updated) {
        if (shouldAutoMarkCncDone) {
          showToast('CNC marked done from bin scan', 'success');
        } else {
          showToast('Bin location saved', 'success');
        }
      }
    } catch (error) {
      console.error('Error updating bin location:', error);
      showToast('Failed to update bin location', 'error');
    }
  };

  const handleToggleCncDone = async () => {
    if (!currentUser.isAdmin || !isCncRequired) return;
    try {
      const markDone = !job.cncCompletedAt;
      const updated = await onUpdateJob(job.id, {
        cncCompletedAt: markDone ? new Date().toISOString() : null,
        cncCompletedBy: markDone ? currentUser.id : null,
      });
      if (updated) {
        showToast(markDone ? 'CNC marked done' : 'CNC marked pending', 'success');
        // Do not refetch after CNC toggle: we already merged CNC state into cache in updateJob.
        // Refetch would overwrite cache with API response that may omit cnc_completed_at.
      } else {
        showToast('Failed to update CNC status', 'error');
      }
    } catch (error) {
      console.error('Error updating CNC status:', error);
      showToast('Failed to update CNC status', 'error');
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
              Object.keys(linkedPart.setComposition).length > 0 &&
              Object.keys(dashQuantities).length > 0 && (
                <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-400">Set:</span>
                      <span className="font-medium text-white">
                        {formatSetComposition(linkedPart.setComposition)}
                      </span>
                      <span className="text-slate-400">Ordered:</span>
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
                  <span className="text-[11px] text-slate-400">
                    Source: <span className="font-semibold text-primary">{allocationSource}</span>
                  </span>
                  {linkedPart && Object.keys(dashQuantities).length > 0 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleFillFullSet}
                        className="rounded border border-primary/30 bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/30"
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
                  disabled={syncingMaterials}
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
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Part details
              </p>
              {editingParts.map((link, idx) => (
                <div key={link.partId} className="mb-3 last:mb-0">
                  {editingParts.length > 1 && (
                    <p className="mb-1 text-[10px] font-medium text-primary">Part {idx + 1}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div>
                      <label className="mb-0.5 block text-[11px] text-slate-400">Part Number</label>
                      {idx === 0 ? (
                        <input
                          type="text"
                          value={editForm.partNumber || ''}
                          onChange={(e) =>
                            setEditForm((prev) => ({ ...prev, partNumber: e.target.value }))
                          }
                          onBlur={(e) => {
                            const v = e.currentTarget.value?.trim();
                            if (v) loadLinkedPart(v);
                          }}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-sm text-white focus:border-primary/50 focus:outline-none"
                          placeholder="e.g., SK-F35-0911"
                        />
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-sm text-white">
                          {link.partNumber || '—'}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-slate-400">Rev</label>
                      {idx === 0 ? (
                        <input
                          type="text"
                          value={editForm.revision}
                          onChange={(e) => setEditForm({ ...editForm, revision: e.target.value })}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                          placeholder="A, B, NC"
                        />
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-500">
                          —
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="mb-0.5 block text-[11px] text-slate-400">Part Name</label>
                      {idx === 0 && linkedPart ? (
                        <input
                          type="text"
                          value={partNameEdit}
                          onChange={(e) => setPartNameEdit(e.target.value)}
                          onBlur={savePartName}
                          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                          placeholder="Part name"
                        />
                      ) : linkedParts?.[idx] ? (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white">
                          {linkedParts[idx].name || '—'}
                        </div>
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-500">
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
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Job details
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">EST #</label>
                  <input
                    type="text"
                    value={editForm.estNumber}
                    onChange={(e) => setEditForm({ ...editForm, estNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="EST#"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">RFQ #</label>
                  <input
                    type="text"
                    value={editForm.rfqNumber}
                    onChange={(e) => setEditForm({ ...editForm, rfqNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="RFQ#"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">PO #</label>
                  <input
                    type="text"
                    value={editForm.po}
                    onChange={(e) => setEditForm({ ...editForm, po: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="PO"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">INV#</label>
                  <input
                    type="text"
                    value={editForm.invNumber}
                    onChange={(e) => setEditForm({ ...editForm, invNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="INV#"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">OWR#</label>
                  <input
                    type="text"
                    value={editForm.owrNumber}
                    onChange={(e) => setEditForm({ ...editForm, owrNumber: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="OWR#"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Due</label>
                  <input
                    type="date"
                    value={editForm.dueDate}
                    onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">ECD</label>
                  <input
                    type="date"
                    value={editForm.ecd}
                    onChange={(e) => setEditForm({ ...editForm, ecd: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value as JobStatus })
                    }
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s.id} value={s.id} className="bg-[#1f1b2e] text-white">
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Bin</label>
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
                  <label className="mb-0.5 block text-[11px] text-slate-400">Description</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={2}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="Description..."
                  />
                </div>
              </div>
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
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Part {partIdx + 1}: {link.partNumber}
                    </h3>
                  )}
                  {partForVariants &&
                  partForVariants.variants &&
                  partForVariants.variants.length > 0 ? (
                    <>
                      {partIdx === 0 && (
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Variants & quantities
                        </h3>
                      )}
                      {partIdx === 0 &&
                      linkedPart.setComposition &&
                      Object.keys(linkedPart.setComposition).length > 0 ? (
                        <div className="mb-2 flex flex-wrap items-center gap-3">
                          <span className="text-[11px] text-slate-400">Input by:</span>
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name="quantity-input-mode"
                              checked={quantityInputMode === 'sets'}
                              onChange={() => setQuantityInputMode('sets')}
                              className="h-4 w-4 border-white/20 bg-white/5 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-white">Full sets</span>
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name="quantity-input-mode"
                              checked={quantityInputMode === 'variants'}
                              onChange={() => setQuantityInputMode('variants')}
                              className="h-4 w-4 border-white/20 bg-white/5 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-white">Variants</span>
                          </label>
                        </div>
                      ) : null}
                      {partIdx === 0 &&
                      quantityInputMode === 'sets' &&
                      linkedPart.setComposition &&
                      Object.keys(linkedPart.setComposition).length > 0 ? (
                        <div>
                          <label className="mb-0.5 block text-[11px] text-slate-400">
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
                            className="w-24 rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white focus:border-primary/50 focus:outline-none"
                            aria-label="Number of sets"
                          />
                          {derivedCompleteSets > 0 && (
                            <p className="mt-1 text-xs text-slate-400">
                              {formatDashSummary(qtyForPart)} → Total{' '}
                              {totalFromDashQuantities(qtyForPart)} units
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-[11px] font-medium text-slate-400">
                            Per-variant quantities
                          </p>
                          <span className="block text-xs text-slate-400">
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
                                      className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white focus:border-primary/50 focus:outline-none"
                                      aria-label={`Quantity for ${label}`}
                                    />
                                    <span className="text-[10px] text-slate-400">Qty</span>
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
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Set quantity
                        </h3>
                      )}
                      <label className="mb-0.5 block text-[11px] text-slate-400">Sets</label>
                      {totalFromDashQuantities(qtyForPart) > 0 ? (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-300">
                          {formatDashSummary(qtyForPart)} → Total{' '}
                          {totalFromDashQuantities(qtyForPart)}
                        </div>
                      ) : partIdx === 0 ? (
                        <input
                          type="text"
                          value={editForm.qty}
                          onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                          className="w-full max-w-24 rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white focus:border-primary/50 focus:outline-none"
                          placeholder="Sets"
                          aria-label="Quantity (sets)"
                        />
                      ) : (
                        <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-500">
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
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Labor & materials
              </h3>
              {editingParts.length > 1 && perPartBreakdowns && (
                <div className="mb-3 rounded-sm border border-white/10 bg-white/5 p-2">
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                    Per-part (read-only)
                  </p>
                  {perPartBreakdowns.map((b, i) => (
                    <p key={i} className="text-[11px] text-slate-300">
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
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      Labor hrs
                      {laborHoursFromPart && (
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          auto
                        </span>
                      )}
                    </label>
                    {laborSuggestion != null && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm({ ...editForm, laborHours: laborSuggestion.toString() })
                        }
                        className="text-[10px] text-primary hover:underline"
                      >
                        Use {laborSuggestion.toFixed(1)}h
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.laborHours}
                    onChange={(e) => {
                      setAllocationSource('total');
                      setLaborHoursFromPart(false);
                      setEditForm({ ...editForm, laborHours: e.target.value });
                    }}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                {canViewFinancials && (
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">Rate</label>
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white">
                      ${laborRate}/hr
                    </div>
                  </div>
                )}
                {canViewFinancials && (
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">Labor $</label>
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm font-semibold text-white">
                      ${laborCost.toFixed(2)}
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">CNC hrs</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.cncHours}
                    onChange={(e) => {
                      setAllocationSource('total');
                      setEditForm({ ...editForm, cncHours: e.target.value });
                    }}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">3D hrs</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.printer3DHours}
                    onChange={(e) => {
                      setAllocationSource('total');
                      setEditForm({ ...editForm, printer3DHours: e.target.value });
                    }}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>
                {currentUser.isAdmin && (
                  <div>
                    <label className="mb-0.5 block text-[11px] text-slate-400">
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
                      className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      placeholder="Optional 0–100"
                    />
                  </div>
                )}
                {canViewFinancials && (
                  <div>
                    <label className="mb-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
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
                  Total ${computedCostTotal.toFixed(2)}
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
              {laborBreakdownByDash && laborBreakdownByDash.entries.length > 0 && (
                <div className="mb-3 space-y-0.5">
                  {laborBreakdownByDash.entries.map(
                    ({ suffix, qty, laborHoursTotal, cncHoursTotal, printer3DHoursTotal }) => (
                      <div key={suffix} className="flex justify-between text-[10px] text-slate-400">
                        {suffix} ×{qty} = L {(laborHoursTotal ?? 0).toFixed(1)}h / CNC{' '}
                        {(cncHoursTotal ?? 0).toFixed(1)}h / 3D{' '}
                        {(printer3DHoursTotal ?? 0).toFixed(1)}h
                      </div>
                    )
                  )}
                </div>
              )}
              <div className="border-t border-white/10 pt-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">
                    {linkedPart ? 'Materials' : 'Materials'}
                  </span>
                </div>
                {!linkedPart ? (
                  !job.inventoryItems?.length ? (
                    <p className="text-xs text-slate-400">
                      No materials assigned. Add from part or manually.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {job.inventoryItems.map((item) => {
                        const invItem = inventoryById.get(item.inventoryId);
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
                              <span className="ml-2 text-[10px] text-slate-400">
                                {item.quantity} {item.unit}
                              </span>
                              {isMaterialAuto(item.inventoryId, item.quantity) && (
                                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                                  auto
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => item.id && onRemoveInventory(job.id, item.id)}
                              className="ml-2 rounded p-1 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
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
                  <p className="text-xs text-slate-400">From part BOM below.</p>
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
                      <p className="text-xs text-slate-400">No materials defined for this part.</p>
                    );
                  }
                  if (requiredMap.size === 0) {
                    return (
                      <p className="text-xs text-slate-400">
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
                                <span className="shrink-0 text-[10px] text-slate-400">
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
                className="flex-1 rounded-sm bg-primary py-3 font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Job section - job-level data only */}
            <div className="bg-gradient-to-br from-[#2a1f35] to-[#1a1122] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {job.isRush && (
                  <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-bold uppercase text-white">
                    Rush
                  </span>
                )}
                <span className="text-xs font-bold text-primary">{formatJobCode(job.jobCode)}</span>
              </div>

              {/* Reference Numbers - EST #, RFQ #, PO #, INV#, OWR# */}
              {(job.estNumber || job.rfqNumber || job.po || job.invNumber || job.owrNumber) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {job.estNumber && (
                    <span className="rounded bg-purple-500/20 px-2 py-1 text-xs font-medium text-purple-300">
                      EST #{job.estNumber}
                    </span>
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
                  {displayInvNumber && (
                    <span className="rounded bg-green-500/20 px-2 py-1 text-xs font-medium text-green-300">
                      INV# {displayInvNumber}
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
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Due Date</p>
                  <p className="text-sm font-bold text-white">{formatDateOnly(job.dueDate)}</p>
                </div>
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Status</p>
                  <StatusBadge status={job.status} size="sm" />
                </div>
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">ECD</p>
                  <p className="text-sm font-bold text-white">{formatDateOnly(job.ecd)}</p>
                </div>
                <div className="rounded-sm bg-white/5 p-2.5">
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Bin</p>
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
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
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
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                    <span>L {completionProgress.laborPercent.toFixed(0)}%</span>
                    <span>CNC {completionProgress.cncPercent.toFixed(0)}%</span>
                    <span>3D {completionProgress.printer3DPercent.toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                    <span className="text-[10px] text-slate-500">Progress estimate %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={progressEstimateInput}
                      onChange={(e) => setProgressEstimateInput(e.target.value)}
                      className="h-7 w-14 rounded border border-white/20 bg-white/10 px-1 text-right text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const v = progressEstimateInput.trim();
                        const num =
                          v === '' ? null : Math.max(0, Math.min(100, parseFloat(v) || 0));
                        try {
                          await onUpdateJob(job.id, {
                            progressEstimatePercent: num,
                          });
                          // Do not refetch jobs here – cache merge in updateJob already updated list + detail; refetch can overwrite with server response that omits progress_estimate_percent
                          showToast(
                            num != null ? 'Progress estimate set' : 'Progress estimate cleared',
                            'success'
                          );
                        } catch (e) {
                          showToast('Failed to update progress estimate', 'error');
                        }
                      }}
                      className="rounded border border-primary/40 bg-primary/20 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/30"
                    >
                      Set
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setProgressEstimateInput('');
                        try {
                          await onUpdateJob(job.id, { progressEstimatePercent: null });
                          // Do not refetch – cache merge keeps UI in sync; refetch can revert if server omits column
                          showToast('Progress estimate cleared', 'success');
                        } catch (e) {
                          showToast('Failed to clear', 'error');
                        }
                      }}
                      className="rounded border border-white/20 px-2 py-1 text-[10px] text-slate-400 hover:bg-white/10"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Time / Shifts - list and link to Time Reports */}
              <div className="mb-3 rounded-sm border border-white/10 bg-white/5 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Time
                  </p>
                  {currentUser.isAdmin && (
                    <button
                      type="button"
                      onClick={() => onNavigate('time-reports', job.id)}
                      className="rounded border border-primary/40 bg-primary/20 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/30"
                    >
                      View in Time Reports
                    </button>
                  )}
                </div>
                {(() => {
                  const jobShifts = shifts
                    .filter((s) => s.job === job.id)
                    .sort(
                      (a, b) =>
                        new Date(b.clockInTime).getTime() - new Date(a.clockInTime).getTime()
                    );
                  if (jobShifts.length === 0) {
                    return (
                      <p className="text-xs text-slate-500">
                        No time logged yet.
                        {currentUser.isAdmin && ' Use Time Reports to add or view shifts.'}
                      </p>
                    );
                  }
                  const estRemaining =
                    job.progressEstimatePercent != null &&
                    job.progressEstimatePercent > 0 &&
                    job.progressEstimatePercent < 100 &&
                    loggedLaborHours > 0
                      ? (() => {
                          const totalEst = loggedLaborHours / (job.progressEstimatePercent! / 100);
                          return Math.max(0, totalEst - loggedLaborHours);
                        })()
                      : null;

                  return (
                    <div className="space-y-1">
                      <p className="mb-1.5 text-xs text-slate-400">
                        {loggedLaborHours.toFixed(1)}h total · {jobShifts.length} shift
                        {jobShifts.length !== 1 ? 's' : ''}
                        {estRemaining != null && (
                          <span className="ml-1.5 font-medium text-primary">
                            · Est. remaining: {estRemaining.toFixed(1)}h
                          </span>
                        )}
                      </p>
                      {jobShifts.slice(0, 5).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => currentUser.isAdmin && onNavigate('time-reports', job.id)}
                          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[10px] transition-colors ${
                            currentUser.isAdmin
                              ? 'cursor-pointer hover:bg-white/10'
                              : 'cursor-default'
                          }`}
                        >
                          <span className="text-slate-300">
                            {formatDateOnly(s.clockInTime)} · {s.userName || s.userInitials || '—'}
                          </span>
                          <span className="font-medium text-white">
                            {formatDurationHours(getWorkedShiftMs(s))}
                          </span>
                        </button>
                      ))}
                      {jobShifts.length > 5 && (
                        <p className="pt-1 text-[10px] text-slate-500">
                          +{jobShifts.length - 5} more · View in Time Reports
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {currentUser.isAdmin && isCncRequired && (
                <div className="mb-3 rounded-sm border border-primary/30 bg-primary/10 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        CNC Status
                      </p>
                      <p
                        className={`text-sm font-semibold ${job.cncCompletedAt ? 'text-green-300' : 'text-amber-300'}`}
                      >
                        {job.cncCompletedAt ? 'CNC Done' : 'CNC Pending'}
                      </p>
                      {job.cncCompletedAt && (
                        <p className="text-[10px] text-slate-400">
                          Marked {formatDateOnly(job.cncCompletedAt)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleCncDone}
                      className={`h-11 touch-manipulation rounded-sm border px-3 text-xs font-semibold ${
                        job.cncCompletedAt
                          ? 'border-green-500/40 bg-green-500/20 text-green-200'
                          : 'border-amber-500/40 bg-amber-500/20 text-amber-200'
                      }`}
                    >
                      {job.cncCompletedAt ? 'Mark Pending' : 'Mark Done'}
                    </button>
                  </div>
                </div>
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
                      <p className="text-[9px] font-bold uppercase text-slate-400">Bin Location</p>
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
                job.parts?.length > 0
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
              return (
                <>
                  {viewParts.map((link, idx) => (
                    <div key={link.partId} className="p-4 pt-0">
                      <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Part {viewParts.length > 1 ? idx + 1 : ''}
                        </p>
                        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div>
                            <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">
                              Part Number
                            </p>
                            <p className="font-mono text-sm font-bold text-primary">
                              {link.partNumber || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">
                              Part Name
                            </p>
                            <p className="text-sm font-medium text-white">
                              {(viewParts.length > 1
                                ? linkedParts?.[idx]?.name
                                : linkedPart?.name) || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">
                              Rev
                            </p>
                            <p className="text-sm font-medium text-white">
                              {idx === 0 ? job.revision || '—' : '—'}
                            </p>
                          </div>
                        </div>
                        {Object.keys(link.dashQuantities ?? {}).length > 0 && (
                          <div className="mb-2 rounded-sm border border-white/10 bg-white/5 p-2">
                            <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                              Variants & quantities
                            </p>
                            <p className="text-sm font-medium text-white">
                              {formatDashSummary(link.dashQuantities!)} →{' '}
                              {totalFromDashQuantities(link.dashQuantities!)} total
                            </p>
                          </div>
                        )}
                        {perPartBreakdowns && perPartBreakdowns[idx] && (
                          <div className="flex flex-wrap gap-3 text-[11px] text-slate-300">
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
                    (job.partId || job.partNumber || (job.parts && job.parts.length > 0)) &&
                    !showAddPartToJob && (
                      <div className="px-4 pb-2">
                        <button
                          type="button"
                          onClick={() => setShowAddPartToJob(true)}
                          className="flex items-center gap-2 rounded border border-dashed border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-primary/50 hover:bg-white/10 hover:text-primary"
                        >
                          <span className="material-symbols-outlined text-base">add</span>
                          Add part to job
                        </button>
                      </div>
                    )}
                  {currentUser.isAdmin && showAddPartToJob && (
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
                        className="mt-2 text-xs text-slate-400 underline hover:text-white"
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
                  <p className="mt-2 text-[10px] text-slate-400">Materials combined below</p>
                </div>
              </div>
            )}

            {/* Currently Working */}
            {job.workers && job.workers.length > 0 && (
              <div className="p-3 pt-0">
                <div className="rounded-sm bg-[#1a1122] p-3">
                  <p className="mb-2 text-xs text-slate-400">Currently Working:</p>
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
                <div className="max-h-96 space-y-2 overflow-y-auto rounded-sm bg-[#261a32] p-3 text-sm text-slate-300">
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
                        <div className="rounded-sm bg-[#261a32] p-3 text-center">
                          <p className="text-sm text-slate-400">
                            No materials defined for this part.
                          </p>
                        </div>
                      );
                    }
                    if (requiredMap.size === 0) {
                      return (
                        <div className="rounded-sm bg-[#261a32] p-3 text-center">
                          <p className="text-sm text-slate-400">
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
                                className="flex items-center justify-between overflow-hidden rounded-sm bg-[#261a32] p-3"
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
                                  <span className="shrink-0 text-xs text-slate-400">
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
                      <span className="material-symbols-outlined ml-auto text-slate-400">
                        open_in_new
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-sm text-slate-500">
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
              />
            </div>

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
                onClick={onClockOut}
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
