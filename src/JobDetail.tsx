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
} from '@/core/types';
import { jobService } from './pocketbase';
import FileUploadButton from './FileUploadButton';
import FileViewer from './FileViewer';
import AttachmentsList from './AttachmentsList';
import BinLocationScanner from './BinLocationScanner';
import ChecklistDisplay from './ChecklistDisplay';
import { formatDateOnly, isoToDateInput, dateInputToISO } from '@/core/date';
import { durationMs, formatDurationHMS } from './lib/timeUtils';
import { useToast } from './Toast';
import { StatusBadge } from './components/ui/StatusBadge';
import { getLaborSuggestion } from './lib/laborSuggestion';
import {
  formatJobCode,
  formatDashSummary,
  totalFromDashQuantities,
  formatSetComposition,
  calculateSetCompletion,
  getJobNameForSave,
  sanitizeReferenceValue,
} from './lib/formatJob';
import { partsService } from './services/api/parts';
import { Part, PartVariant } from '@/core/types';
import { useNavigation } from '@/contexts/NavigationContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useClockIn } from '@/contexts/ClockInContext';
import { useLocation } from 'react-router-dom';
import { useThrottle } from '@/useThrottle';
import { syncJobInventoryFromPart, computeRequiredMaterials } from '@/lib/materialFromPart';
import { useApp } from '@/AppContext';
import { computeVariantBreakdown } from '@/lib/variantAllocation';
import {
  getDashQuantity,
  normalizeDashQuantities,
  quantityPerUnit,
  toDashSuffix,
} from '@/lib/variantMath';

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

function getMachineTotalsFromJob(job: Job): { cncHours: number; printer3DHours: number } {
  const entries = Object.values(job.machineBreakdownByVariant ?? {});
  return entries.reduce(
    (acc, entry) => {
      acc.cncHours += Number(entry.cncHoursTotal) || 0;
      acc.printer3DHours += Number(entry.printer3DHoursTotal) || 0;
      return acc;
    },
    { cncHours: 0, printer3DHours: 0 }
  );
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
  }, [advanceJobToNextStatus, job.id, job.status]);

  const [timer, setTimer] = useState('00:00:00');
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [showAddInventory, setShowAddInventory] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<string>('');
  const [inventoryQty, setInventoryQty] = useState('1');
  const [inventorySearch, setInventorySearch] = useState('');
  const [editingMaterialQty, setEditingMaterialQty] = useState<string | null>(null);
  const [materialQtyValue, setMaterialQtyValue] = useState<string>('');
  const [syncingMaterials, setSyncingMaterials] = useState(false);
  const [attachmentAdminOverrides, setAttachmentAdminOverrides] = useState<Record<string, boolean>>(
    {}
  );
  const [pendingAttachmentToggleCount, setPendingAttachmentToggleCount] = useState(0);
  const pendingAttachmentTogglesRef = useRef<Set<Promise<void>>>(new Set());
  /** True when labor hours were auto-filled from part (show "auto" marker until user edits) */
  const [laborHoursFromPart, setLaborHoursFromPart] = useState(false);
  const { showToast } = useToast();
  const onReloadJobRef = useRef(onReloadJob);

  useEffect(() => {
    onReloadJobRef.current = onReloadJob;
  }, [onReloadJob]);

  // File viewing state
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  /** Part drawings: files standard users can access on job cards */
  const [partDrawings, setPartDrawings] = useState<Attachment[]>([]);

  // Bin location state
  const [showBinLocationScanner, setShowBinLocationScanner] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [linkedPart, setLinkedPart] = useState<Part | null>(null);
  const [, setLoadingPart] = useState(false);
  const [partNumberSearch, setPartNumberSearch] = useState(job.partNumber || '');
  const [selectedVariant, setSelectedVariant] = useState<PartVariant | null>(null);
  const [materialCosts, setMaterialCosts] = useState<Map<string, number>>(new Map());
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
  >(() => {
    const out: Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }> = {};
    for (const [suffix, entry] of Object.entries(job.machineBreakdownByVariant ?? {})) {
      out[toDashSuffix(suffix)] = {
        cncHoursPerUnit: Number(entry.cncHoursPerUnit) || 0,
        printer3DHoursPerUnit: Number(entry.printer3DHoursPerUnit) || 0,
      };
    }
    return out;
  });
  const machineTotals = useMemo(() => getMachineTotalsFromJob(job), [job]);
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
  });

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

  // Calculate material costs from part materials × dashQuantities (live recalculation)
  const calculateMaterialCosts = useCallback(
    (part: Part, variantSuffix?: string) => {
      const costs = new Map<string, number>();

      // If we have dashQuantities, calculate from variants × quantities
      if (dashQuantities && Object.keys(dashQuantities).length > 0 && part.variants) {
        // For each dash quantity, get variant materials and multiply
        for (const [suffix, qty] of Object.entries(dashQuantities)) {
          if (qty <= 0) continue;
          const variant = part.variants.find(
            (v) => toDashSuffix(v.variantSuffix) === toDashSuffix(suffix)
          );
          if (variant?.materials) {
            for (const material of variant.materials) {
              const invItem = inventoryById.get(material.inventoryId);
              if (invItem && invItem.price) {
                const requiredQty =
                  quantityPerUnit(material as { quantityPerUnit?: number; quantity?: number }) *
                  qty;
                const cost = requiredQty * invItem.price * materialUpcharge;
                const existing = costs.get(material.inventoryId) || 0;
                costs.set(material.inventoryId, existing + cost);
              }
            }
          }
        }

        // Also add part-level per_set materials (multiply by total quantity)
        const totalQty = totalFromDashQuantities(dashQuantities);
        if (part.materials) {
          for (const material of part.materials) {
            if (material.usageType === 'per_set') {
              const invItem = inventoryById.get(material.inventoryId);
              if (invItem && invItem.price) {
                const requiredQty =
                  quantityPerUnit(material as { quantityPerUnit?: number; quantity?: number }) *
                  totalQty;
                const cost = requiredQty * invItem.price * materialUpcharge;
                const existing = costs.get(material.inventoryId) || 0;
                costs.set(material.inventoryId, existing + cost);
              }
            }
          }
        }
      } else {
        // Fallback: single variant or part-level materials
        const variant =
          variantSuffix && part.variants
            ? part.variants.find(
                (v) => toDashSuffix(v.variantSuffix) === toDashSuffix(variantSuffix)
              )
            : null;
        const materials = variant?.materials || part.materials || [];

        for (const material of materials) {
          const invItem = inventoryById.get(material.inventoryId);
          if (invItem && invItem.price) {
            const cost =
              quantityPerUnit(material as { quantityPerUnit?: number; quantity?: number }) *
              invItem.price *
              materialUpcharge;
            costs.set(material.inventoryId, cost);
          }
        }
      }

      // Add manually-assigned job-specific materials (not from part)
      for (const jobMaterial of job.inventoryItems || []) {
        const invItem = inventoryById.get(jobMaterial.inventoryId);
        if (invItem && invItem.price) {
          const existingCost = costs.get(jobMaterial.inventoryId) || 0;
          const additionalCost = jobMaterial.quantity * invItem.price * materialUpcharge;
          costs.set(jobMaterial.inventoryId, existingCost + additionalCost);
        }
      }

      setMaterialCosts(costs);
    },
    [inventoryById, job.inventoryItems, dashQuantities, materialUpcharge]
  );

  // Recalculate materials when dashQuantities change (live update)
  useEffect(() => {
    if (linkedPart && Object.keys(dashQuantities).length > 0) {
      calculateMaterialCosts(linkedPart);
    }
  }, [dashQuantities, linkedPart, calculateMaterialCosts]);

  /** Required materials from part × dash quantities (for auto markers and debounced sync) */
  const requiredMaterialsMap = useMemo(() => {
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || Object.keys(normalizedDash).length === 0)
      return new Map<string, { quantity: number; unit: string }>();
    return computeRequiredMaterials(linkedPart, normalizedDash);
  }, [linkedPart, dashQuantities]);

  /** Whether a job inventory item matches the part-derived requirement (auto-assigned) */
  const isMaterialAuto = useCallback(
    (inventoryId: string, quantity: number) => {
      const req = requiredMaterialsMap.get(inventoryId);
      return req != null && Math.abs(req.quantity - quantity) < 0.0001;
    },
    [requiredMaterialsMap]
  );

  // Auto-sync materials when dash quantities change (debounced)
  const syncAfterDashChangeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRequestIdRef = useRef(0);
  useEffect(() => {
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || !Object.values(normalizedDash).some((q) => q > 0)) return;
    if (syncAfterDashChangeRef.current) clearTimeout(syncAfterDashChangeRef.current);
    const requestId = ++syncRequestIdRef.current;
    syncAfterDashChangeRef.current = setTimeout(async () => {
      syncAfterDashChangeRef.current = null;
      try {
        await syncJobInventoryFromPart(job.id, linkedPart, normalizedDash);
        if (requestId === syncRequestIdRef.current) {
          await onReloadJobRef.current?.();
        }
      } catch (e) {
        console.error('Auto-sync materials:', e);
      }
    }, 1200);
    return () => {
      if (syncAfterDashChangeRef.current) clearTimeout(syncAfterDashChangeRef.current);
    };
  }, [job.id, linkedPart, dashQuantities]);

  // Load linked part
  const loadLinkedPart = useCallback(
    async (partNumber: string) => {
      if (!partNumber.trim()) {
        setLinkedPart(null);
        return;
      }
      setLoadingPart(true);
      try {
        const part = await partsService.getPartByNumber(partNumber);
        if (part) {
          const partWithVariants = await partsService.getPartWithVariants(part.id);
          if (!partWithVariants) {
            setLinkedPart(null);
            setSelectedVariant(null);
            return;
          }
          setLinkedPart(partWithVariants);
          // Set selected variant if job has one
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

  // Load linked part when part number changes
  useEffect(() => {
    if (job.partNumber) {
      loadLinkedPart(job.partNumber);
    }
  }, [job.partNumber, loadLinkedPart]);

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

  // Calculate total material cost
  const totalMaterialCost = useMemo(() => {
    return Array.from(materialCosts.values()).reduce((sum, cost) => sum + cost, 0);
  }, [materialCosts]);

  // Calculate labor cost (whole job)
  const laborCost = useMemo(() => {
    const hours = parseFloat(editForm.laborHours) || 0;
    return hours * laborRate;
  }, [editForm.laborHours, laborRate]);

  const variantAllocation = useMemo(
    () =>
      computeVariantBreakdown({
        part: linkedPart,
        dashQuantities,
        source: allocationSource,
        totalLaborHours: parseFloat(editForm.laborHours) || 0,
        totalCncHours: parseFloat(editForm.cncHours) || 0,
        totalPrinter3DHours: parseFloat(editForm.printer3DHours) || 0,
        laborOverridePerUnit: laborPerUnitOverrides,
        machineOverridePerUnit: machinePerUnitOverrides,
      }),
    [
      linkedPart,
      dashQuantities,
      allocationSource,
      editForm.laborHours,
      editForm.cncHours,
      editForm.printer3DHours,
      laborPerUnitOverrides,
      machinePerUnitOverrides,
    ]
  );

  // Per-dash breakdown across labor + machine hours
  const laborBreakdownByDash = useMemo(() => {
    if (variantAllocation.entries.length === 0) return null;
    return {
      entries: variantAllocation.entries,
      totalFromDash: variantAllocation.totals.laborHours,
      totalCncFromDash: variantAllocation.totals.cncHours,
      totalPrinter3DFromDash: variantAllocation.totals.printer3DHours,
    };
  }, [variantAllocation]);

  // Auto-fill labor from part × dash quantities when labor is empty (so calculations stay automatic)
  const laborBreakdownTotal = laborBreakdownByDash?.totalFromDash ?? 0;
  const persistedLaborBreakdown = useMemo(
    () =>
      variantAllocation.entries.reduce<
        Record<string, { qty: number; hoursPerUnit: number; totalHours: number }>
      >((acc, entry) => {
        acc[entry.suffix] = {
          qty: entry.qty,
          hoursPerUnit: entry.laborHoursPerUnit,
          totalHours: entry.laborHoursTotal,
        };
        return acc;
      }, {}),
    [variantAllocation.entries]
  );

  const persistedMachineBreakdown = useMemo(
    () =>
      variantAllocation.entries.reduce<
        Record<
          string,
          {
            qty: number;
            cncHoursPerUnit: number;
            cncHoursTotal: number;
            printer3DHoursPerUnit: number;
            printer3DHoursTotal: number;
          }
        >
      >((acc, entry) => {
        acc[entry.suffix] = {
          qty: entry.qty,
          cncHoursPerUnit: entry.cncHoursPerUnit,
          cncHoursTotal: entry.cncHoursTotal,
          printer3DHoursPerUnit: entry.printer3DHoursPerUnit,
          printer3DHoursTotal: entry.printer3DHoursTotal,
        };
        return acc;
      }, {}),
    [variantAllocation.entries]
  );
  useEffect(() => {
    if (laborBreakdownTotal <= 0 || allocationSource !== 'variant') return;
    setEditForm((prev) => {
      const nextLabor = laborBreakdownTotal.toFixed(2);
      const nextCnc = variantAllocation.totals.cncHours.toFixed(2);
      const nextPrinter3D = variantAllocation.totals.printer3DHours.toFixed(2);
      if (
        prev.laborHours === nextLabor &&
        prev.cncHours === nextCnc &&
        prev.printer3DHours === nextPrinter3D
      ) {
        return prev;
      }
      setLaborHoursFromPart(true);
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
    variantAllocation.totals.cncHours,
    variantAllocation.totals.printer3DHours,
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

      calculateMaterialCosts(partWithVariants);

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
    calculateMaterialCosts,
    job.description,
    job.laborHours,
    editForm.description,
    editForm.laborHours,
    autoJobName,
    showToast,
  ]);

  // Recalculate material costs when variant or linked part changes
  useEffect(() => {
    if (linkedPart) {
      calculateMaterialCosts(linkedPart, selectedVariant?.variantSuffix || editForm.variantSuffix);
    }
  }, [linkedPart, selectedVariant, editForm.variantSuffix, calculateMaterialCosts]);

  // Reset edit form when job changes (use stable deps to avoid infinite loop)
  const jobId = job.id;
  const jobPartNumber = job.partNumber || '';
  useEffect(() => {
    setLaborHoursFromPart(false);
    setAllocationSource(job.allocationSource ?? 'variant');
    setDashQuantities(normalizeDashQuantities(job.dashQuantities || {}));
    setLaborPerUnitOverrides(() => {
      const out: Record<string, number> = {};
      for (const [suffix, entry] of Object.entries(job.laborBreakdownByVariant ?? {})) {
        out[toDashSuffix(suffix)] = Number(entry.hoursPerUnit) || 0;
      }
      return out;
    });
    setMachinePerUnitOverrides(() => {
      const out: Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }> = {};
      for (const [suffix, entry] of Object.entries(job.machineBreakdownByVariant ?? {})) {
        out[toDashSuffix(suffix)] = {
          cncHoursPerUnit: Number(entry.cncHoursPerUnit) || 0,
          printer3DHoursPerUnit: Number(entry.printer3DHoursPerUnit) || 0,
        };
      }
      return out;
    });
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
      partNumber: jobPartNumber,
      revision: job.revision || '',
      variantSuffix: job.variantSuffix || '',
      estNumber: job.estNumber || '',
      invNumber: job.invNumber || '',
      rfqNumber: job.rfqNumber || '',
      owrNumber: job.owrNumber || '',
    });
    setPartNumberSearch(jobPartNumber);
    if (jobPartNumber) {
      loadLinkedPart(jobPartNumber);
    } else {
      setLinkedPart(null);
      setSelectedVariant(null);
    }
  }, [
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
    job.laborBreakdownByVariant,
    job.machineBreakdownByVariant,
    machineTotals.cncHours,
    machineTotals.printer3DHours,
    loadLinkedPart,
  ]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isClockedIn && activeShift) {
      interval = setInterval(() => {
        setTimer(formatDurationHMS(durationMs(activeShift.clockInTime, null)));
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
      // Reload job data to show updated comment
      if (onReloadJob) await onReloadJob();
    } catch (error) {
      console.error('Error updating comment:', error);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await jobService.deleteComment(commentId);
      // Reload job data to remove deleted comment
      if (onReloadJob) await onReloadJob();
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  const handleAddInventory = async () => {
    if (!selectedInventory || !inventoryQty) return;
    const item = inventoryById.get(selectedInventory);
    if (!item) return;

    setIsSubmitting(true);
    try {
      await onAddInventory(job.id, selectedInventory, parseFloat(inventoryQty), item.unit);
      setShowAddInventory(false);
      setSelectedInventory('');
      setInventoryQty('1');
      setInventorySearch('');
    } catch (error) {
      console.error('Error adding inventory:', error);
    }
    setIsSubmitting(false);
  };

  const handleSaveEdit = async () => {
    const partNumber = editForm.partNumber?.trim() || undefined;
    const revision = editForm.revision?.trim() || undefined;
    const estNumber = editForm.estNumber?.trim() || undefined;
    const po = editForm.po?.trim() || undefined;
    const normalizedDashQuantities = normalizeDashQuantities(dashQuantities);
    const payload = {
      partNumber,
      revision,
      po,
      description: editForm.description?.trim() || undefined,
      dueDate: dateInputToISO(editForm.dueDate),
      ecd: dateInputToISO(editForm.ecd),
      qty: editForm.qty?.trim() || undefined,
      laborHours: editForm.laborHours ? parseFloat(editForm.laborHours) : undefined,
      status: editForm.status,
      isRush: editForm.isRush,
      binLocation: editForm.binLocation?.trim() || undefined,
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
        if (linkedPart && Object.values(normalizedDashQuantities).some((q) => q > 0)) {
          try {
            await syncJobInventoryFromPart(job.id, linkedPart, normalizedDashQuantities);
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
    });
    setDashQuantities(normalizeDashQuantities(job.dashQuantities || {}));
    setAllocationSource(job.allocationSource ?? 'variant');
    setLaborPerUnitOverrides(() => {
      const out: Record<string, number> = {};
      for (const [suffix, entry] of Object.entries(job.laborBreakdownByVariant ?? {})) {
        out[toDashSuffix(suffix)] = Number(entry.hoursPerUnit) || 0;
      }
      return out;
    });
    setMachinePerUnitOverrides(() => {
      const out: Record<string, { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }> = {};
      for (const [suffix, entry] of Object.entries(job.machineBreakdownByVariant ?? {})) {
        out[toDashSuffix(suffix)] = {
          cncHoursPerUnit: Number(entry.cncHoursPerUnit) || 0,
          printer3DHoursPerUnit: Number(entry.printer3DHoursPerUnit) || 0,
        };
      }
      return out;
    });
    setPartNumberSearch(job.partNumber || '');
    setSelectedVariant(null);
    setIsEditing(false);
  };

  const handleAutoAssignMaterials = async () => {
    const normalizedDash = normalizeDashQuantities(dashQuantities);
    if (!linkedPart || !Object.values(normalizedDash).some((q) => q > 0)) return;
    setSyncingMaterials(true);
    try {
      await syncJobInventoryFromPart(job.id, linkedPart, normalizedDash);
      await onReloadJob?.();
      showToast('Materials auto-assigned from part', 'success');
    } catch (err) {
      console.error('Auto-assign materials:', err);
      showToast('Failed to auto-assign materials', 'error');
    } finally {
      setSyncingMaterials(false);
    }
  };

  const handleDashQuantityChange = useCallback((variantSuffix: string, rawValue: string) => {
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

  const handleApplyFromPart = useCallback(() => {
    if (!linkedPart?.variants?.length) return;
    setAllocationSource('variant');
    const laborNext: Record<string, number> = {};
    const machineNext: Record<
      string,
      { cncHoursPerUnit?: number; printer3DHoursPerUnit?: number }
    > = {};
    linkedPart.variants.forEach((variant) => {
      const key = toDashSuffix(variant.variantSuffix);
      laborNext[key] = variant.laborHours ?? linkedPart.laborHours ?? 0;
      machineNext[key] = {
        cncHoursPerUnit: variant.requiresCNC ? (variant.cncTimeHours ?? 0) : 0,
        printer3DHoursPerUnit: variant.requires3DPrint ? (variant.printer3DTimeHours ?? 0) : 0,
      };
    });
    setLaborPerUnitOverrides(laborNext);
    setMachinePerUnitOverrides(machineNext);
    setLaborHoursFromPart(true);
    showToast('Applied labor/machine/material logic from part', 'success');
  }, [linkedPart, showToast]);

  const handleVariantHoursChange = useCallback(
    (
      suffix: string,
      field: 'laborHoursPerUnit' | 'cncHoursPerUnit' | 'printer3DHoursPerUnit',
      value: string
    ) => {
      const key = toDashSuffix(suffix);
      const nextValue = Math.max(0, parseFloat(value) || 0);
      setAllocationSource('variant');
      setLaborHoursFromPart(false);
      if (field === 'laborHoursPerUnit') {
        setLaborPerUnitOverrides((prev) => ({ ...prev, [key]: nextValue }));
        return;
      }
      setMachinePerUnitOverrides((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? {}),
          [field]: nextValue,
        },
      }));
    },
    []
  );

  const handleRemoveInventory = async (jobInvId: string) => {
    if (!jobInvId) return;
    try {
      await onRemoveInventory(job.id, jobInvId);
    } catch (error) {
      console.error('Error removing inventory:', error);
    }
  };

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
      const updated = await onUpdateJob(job.id, {
        binLocation: location || undefined,
      });

      if (updated && onReloadJob) {
        await onReloadJob();
      }
    } catch (error) {
      console.error('Error updating bin location:', error);
      showToast('Failed to update bin location', 'error');
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

  const filteredInventory = useMemo(
    () =>
      inventory.filter(
        (i) =>
          i.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
          i.barcode?.toLowerCase().includes(inventorySearch.toLowerCase())
      ),
    [inventory, inventorySearch]
  );

  const getInventoryItem = (inventoryId: string) => {
    return inventoryById.get(inventoryId);
  };
  const displayInvNumber = sanitizeReferenceValue(job.invNumber);

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-white">
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

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-background-dark/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={async () => {
              await waitForPendingAttachmentToggles();
              if (isEditing) {
                handleCancelEdit();
              } else if (onBack) {
                onBack();
              } else {
                onNavigate('dashboard');
              }
            }}
            disabled={pendingAttachmentToggleCount > 0}
            className="flex size-10 items-center justify-center text-slate-400 hover:text-white disabled:opacity-50"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-bold text-white">
              {isEditing ? 'Edit Job' : formatJobCode(job.jobCode)}
            </h1>
            {!isEditing && <StatusBadge status={job.status} size="sm" />}
            {isEditing && <p className="text-[11px] text-slate-400">Edit below</p>}
          </div>
          <div className="flex items-center gap-2">
            {currentUser.isAdmin && !isEditing && (
              <button
                onClick={() => updateState({ minimalView: !navState.minimalView })}
                className="flex size-10 items-center justify-center text-slate-400 hover:text-white"
                title="Toggle minimal view"
              >
                <span className="material-symbols-outlined">
                  {navState.minimalView ? 'view_agenda' : 'view_compact'}
                </span>
              </button>
            )}
            {currentUser.isAdmin && (
              <button
                onClick={() => (isEditing ? handleSaveEdit() : setIsEditing(true))}
                disabled={isSubmitting}
                className={`flex size-10 items-center justify-center ${
                  isEditing
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-primary hover:text-primary/80'
                } ${isSubmitting ? 'opacity-50' : ''}`}
              >
                <span className="material-symbols-outlined">{isEditing ? 'check' : 'edit'}</span>
              </button>
            )}
            {!currentUser.isAdmin && (
              <div className="rounded-sm border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                View Only
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto pb-24"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: !isEditing ? '100px' : '24px',
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
                    {(() => {
                      const { completeSets, percentage } = calculateSetCompletion(
                        dashQuantities,
                        linkedPart.setComposition
                      );
                      return (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-sm bg-white/10">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${Math.min(100, percentage)}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-primary">
                            {completeSets} sets ({percentage}%)
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

            {linkedPart && Object.values(dashQuantities).some((q) => q > 0) && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    Source: <span className="font-semibold text-primary">{allocationSource}</span>
                  </span>
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
                  {syncingMaterials ? 'Syncing…' : 'Auto-assign materials from part'}
                </button>
              </div>
            )}

            {/* Main fields - order: Part Number, Rev, Part Name, Qty, EST #, RFQ #, PO #, INV# */}
            <div className="rounded-sm border border-white/10 bg-white/5 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Part Number</label>
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
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Rev</label>
                  <input
                    type="text"
                    value={editForm.revision}
                    onChange={(e) => setEditForm({ ...editForm, revision: e.target.value })}
                    className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                    placeholder="A, B, NC"
                  />
                </div>
                <div className="col-span-2 sm:col-span-3 lg:col-span-2">
                  <label className="mb-0.5 block text-[11px] text-slate-400">Part Name</label>
                  {linkedPart ? (
                    <input
                      type="text"
                      value={partNameEdit}
                      onChange={(e) => setPartNameEdit(e.target.value)}
                      onBlur={savePartName}
                      className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      placeholder="Part name"
                    />
                  ) : (
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-500">
                      — Link part above to edit
                    </div>
                  )}
                </div>
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

            {/* Variants & quantities - own section below Description */}
            <div className="rounded-sm border border-white/10 bg-white/5 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Variants & quantities
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Qty</label>
                  {linkedPart && linkedPart.variants && linkedPart.variants.length > 0 ? (
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-300">
                      {formatDashSummary(dashQuantities)} → Total:{' '}
                      {totalFromDashQuantities(dashQuantities)}
                    </div>
                  ) : totalFromDashQuantities(dashQuantities) > 0 ? (
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-300">
                      {formatDashSummary(dashQuantities)} → Total:{' '}
                      {totalFromDashQuantities(dashQuantities)}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={editForm.qty}
                      onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                      className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      placeholder="Qty"
                    />
                  )}
                </div>
                {linkedPart && linkedPart.variants && linkedPart.variants.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-slate-400">Per variant</p>
                    {linkedPart.variants.map((variant) => {
                      const variantKey = toDashSuffix(variant.variantSuffix);
                      const qty = getDashQuantity(dashQuantities, variant.variantSuffix);
                      const breakdownEntry = laborBreakdownByDash?.entries.find(
                        (entry) => entry.suffix === variantKey
                      );
                      return (
                        <div key={variant.id} className="flex items-center gap-2">
                          <label className="w-28 truncate text-xs text-slate-400">
                            {linkedPart.partNumber}-{variant.variantSuffix}
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={qty}
                            onChange={(e) =>
                              handleDashQuantityChange(variant.variantSuffix, e.target.value)
                            }
                            className="w-20 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                          />
                          {currentUser.isAdmin && (
                            <>
                              <input
                                type="number"
                                step="0.1"
                                min={0}
                                value={breakdownEntry?.laborHoursPerUnit ?? 0}
                                onChange={(e) =>
                                  handleVariantHoursChange(
                                    variant.variantSuffix,
                                    'laborHoursPerUnit',
                                    e.target.value
                                  )
                                }
                                className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-white focus:border-primary/50 focus:outline-none"
                                title="Labor hrs per unit"
                              />
                              <input
                                type="number"
                                step="0.1"
                                min={0}
                                value={breakdownEntry?.cncHoursPerUnit ?? 0}
                                onChange={(e) =>
                                  handleVariantHoursChange(
                                    variant.variantSuffix,
                                    'cncHoursPerUnit',
                                    e.target.value
                                  )
                                }
                                className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-white focus:border-primary/50 focus:outline-none"
                                title="CNC hrs per unit"
                              />
                              <input
                                type="number"
                                step="0.1"
                                min={0}
                                value={breakdownEntry?.printer3DHoursPerUnit ?? 0}
                                onChange={(e) =>
                                  handleVariantHoursChange(
                                    variant.variantSuffix,
                                    'printer3DHoursPerUnit',
                                    e.target.value
                                  )
                                }
                                className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-white focus:border-primary/50 focus:outline-none"
                                title="3D hrs per unit"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Labor & Materials intertwined with variants section */}
            <div className="rounded-sm border border-white/10 bg-white/5 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Labor & materials
              </h3>
              {currentUser.isAdmin ? (
                <>
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
                    <div>
                      <label className="mb-0.5 block text-[11px] text-slate-400">Rate</label>
                      <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white">
                        ${laborRate}/hr
                      </div>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[11px] text-slate-400">Labor $</label>
                      <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm font-semibold text-white">
                        ${laborCost.toFixed(2)}
                      </div>
                    </div>
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
                    <div>
                      <label className="mb-0.5 block text-[11px] text-slate-400">Materials $</label>
                      <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm font-semibold text-white">
                        ${totalMaterialCost.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="mb-3 rounded border border-primary/30 bg-primary/10 px-2 py-1.5 text-sm font-bold text-primary">
                    Total $
                    {(
                      laborCost +
                      totalMaterialCost +
                      (parseFloat(editForm.cncHours) || 0) * cncRate +
                      (parseFloat(editForm.printer3DHours) || 0) * printer3DRate
                    ).toFixed(2)}
                  </div>
                  {laborBreakdownByDash && laborBreakdownByDash.entries.length > 0 && (
                    <div className="mb-3 space-y-0.5">
                      {laborBreakdownByDash.entries.map(
                        ({ suffix, qty, totalHours, cncHoursTotal, printer3DHoursTotal }) => (
                          <div
                            key={suffix}
                            className="flex justify-between text-[10px] text-slate-400"
                          >
                            {suffix} ×{qty} = L {totalHours.toFixed(1)}h / CNC{' '}
                            {cncHoursTotal.toFixed(1)}h / 3D {printer3DHoursTotal.toFixed(1)}h
                          </div>
                        )
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="mb-3">
                  <label className="text-[11px] text-slate-400">Labor hours</label>
                  <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white">
                    {parseFloat(editForm.laborHours) || 0} h
                  </div>
                </div>
              )}
              <div className="border-t border-white/10 pt-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">Materials</span>
                  <button
                    type="button"
                    onClick={() => setShowAddInventory(true)}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    + Add
                  </button>
                </div>
                {!job.inventoryItems?.length ? (
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
                              onClick={() => invItem && onNavigate('inventory-detail', invItem.id)}
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
                )}
              </div>
            </div>

            {linkedPart && (
              <div className="rounded-sm border border-white/10 bg-white/5 p-3">
                <h3 className="mb-1.5 text-xs font-semibold text-white">
                  Part BOM {linkedPart.variants?.length ? `(${linkedPart.partNumber})` : ''}
                </h3>
                {(() => {
                  const materials = selectedVariant?.materials || linkedPart.materials || [];
                  if (materials.length === 0) {
                    return (
                      <p className="text-xs text-slate-400">No materials defined for this part.</p>
                    );
                  }
                  return (
                    <div className="space-y-1.5">
                      {materials.map((material) => {
                        const invItem = inventoryById.get(material.inventoryId);
                        const cost = materialCosts.get(material.inventoryId) || 0;
                        const materialName = material.inventoryName || invItem?.name || 'Unknown';
                        return (
                          <div
                            key={material.id}
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
                                {quantityPerUnit(
                                  material as { quantityPerUnit?: number; quantity?: number }
                                )}{' '}
                                {material.unit}
                              </span>
                            </div>
                            {currentUser.isAdmin && cost > 0 && (
                              <span className="shrink-0 text-xs font-semibold text-white">
                                ${cost.toFixed(2)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
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
            {/* Job Header Card - Part Number, Part Name, OWR only on top */}
            <div className="bg-gradient-to-br from-[#2a1f35] to-[#1a1122] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {job.isRush && (
                  <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-bold uppercase text-white">
                    Rush
                  </span>
                )}
                <span className="text-xs font-bold text-primary">{formatJobCode(job.jobCode)}</span>
              </div>

              {/* Top line: Part Number | Part Name | OWR# only */}
              <div className="mb-3 grid grid-cols-1 gap-2 rounded-sm border border-primary/30 bg-primary/10 p-3 sm:grid-cols-3">
                <div>
                  <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">
                    Part Number
                  </p>
                  <p className="font-mono text-sm font-bold text-primary">
                    {job.partNumber || '—'}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">Part Name</p>
                  <p className="text-sm font-medium text-white">{linkedPart?.name || '—'}</p>
                </div>
                <div>
                  <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">OWR#</p>
                  <p className="text-sm font-medium text-white">{job.owrNumber || '—'}</p>
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

              {/* Dash Quantities (below top line) */}
              {job.partNumber &&
                job.dashQuantities &&
                Object.keys(job.dashQuantities).length > 0 && (
                  <div className="mb-2 rounded-sm border border-white/10 bg-white/5 p-3">
                    <p className="mb-1 text-xs font-bold uppercase text-slate-400">Dash</p>
                    <p className="mb-2 text-sm font-medium text-white">
                      {formatDashSummary(job.dashQuantities)} →{' '}
                      {totalFromDashQuantities(job.dashQuantities)} total
                    </p>
                    {linkedPart &&
                      linkedPart.setComposition &&
                      Object.keys(linkedPart.setComposition).length > 0 && (
                        <div className="mt-2 rounded border border-white/10 bg-white/5 p-2">
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-300">Set:</span>
                            <span className="font-medium text-white">
                              {formatSetComposition(linkedPart.setComposition)}
                            </span>
                          </div>
                          {(() => {
                            const { completeSets, percentage } = calculateSetCompletion(
                              job.dashQuantities,
                              linkedPart.setComposition
                            );
                            return (
                              <>
                                <div className="mb-1 flex items-center justify-between text-xs">
                                  <span className="text-slate-300">Complete:</span>
                                  <span className="font-bold text-primary">{completeSets}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-white/10">
                                    <div
                                      className="h-full bg-primary transition-all"
                                      style={{ width: `${Math.min(100, percentage)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-medium text-slate-300">
                                    {percentage}%
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                  </div>
                )}

              {/* Reference Numbers - order: EST #, RFQ #, PO #, INV#, OWR# */}
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

              {/* Info Grid - Compact 2x2 */}
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
                  <p className="mb-0.5 text-[9px] font-bold uppercase text-slate-400">Quantity</p>
                  <p className="text-sm font-bold text-white">
                    {job.dashQuantities && Object.keys(job.dashQuantities).length > 0
                      ? `${formatDashSummary(job.dashQuantities)} (${totalFromDashQuantities(job.dashQuantities)})`
                      : job.qty || 'N/A'}
                  </p>
                </div>
              </div>

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

            {/* Materials / Inventory Section */}
            <div className="p-3 pt-0">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  <span className="material-symbols-outlined text-lg text-primary">
                    inventory_2
                  </span>
                  Materials ({job.inventoryItems?.length || 0})
                </h3>
                {currentUser.isAdmin && (
                  <button
                    onClick={() => setShowAddInventory(true)}
                    className="flex items-center gap-1 text-xs font-bold text-primary"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Add
                  </button>
                )}
              </div>

              {!job.inventoryItems || job.inventoryItems.length === 0 ? (
                <div className="rounded-sm bg-[#261a32] p-3 text-center">
                  <span className="material-symbols-outlined mb-2 text-3xl text-slate-500">
                    inventory_2
                  </span>
                  <p className="text-sm text-slate-400">No materials assigned</p>
                  {currentUser.isAdmin && (
                    <button
                      onClick={() => setShowAddInventory(true)}
                      className="mt-2 text-sm font-bold text-primary"
                    >
                      + Add materials
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {(job.inventoryItems || []).map((item) => {
                    const invItem = getInventoryItem(item.inventoryId);
                    const available = invItem
                      ? (invItem.available ?? calculateAvailable(invItem))
                      : 0;
                    const isLow = available < item.quantity;
                    const isEditingThis = editingMaterialQty === item.id;

                    return (
                      <div
                        key={item.id || item.inventoryId}
                        className="overflow-hidden rounded-sm bg-[#261a32]"
                      >
                        <div className="flex items-center justify-between p-3">
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (invItem) {
                                onNavigate('inventory-detail', invItem.id);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (invItem) onNavigate('inventory-detail', invItem.id);
                              }
                            }}
                            className="-ml-1 flex flex-1 cursor-pointer items-center gap-3 rounded-sm p-1 text-left transition-colors hover:bg-white/5"
                          >
                            {invItem?.imageUrl ? (
                              <img
                                src={invItem.imageUrl}
                                alt={item.inventoryName || 'Material'}
                                className={`size-10 flex-shrink-0 rounded-sm object-cover ${isLow ? 'ring-2 ring-red-500' : ''}`}
                              />
                            ) : (
                              <div
                                className={`flex size-10 flex-shrink-0 items-center justify-center rounded-sm ${isLow ? 'bg-red-500/20' : 'bg-white/10'}`}
                              >
                                <span
                                  className={`material-symbols-outlined ${isLow ? 'text-red-400' : 'text-slate-400'}`}
                                >
                                  {isLow ? 'warning' : 'inventory_2'}
                                </span>
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              {invItem ? (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNavigate('inventory-detail', invItem.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onNavigate('inventory-detail', invItem.id);
                                    }
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  className="cursor-pointer truncate font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                                >
                                  {item.inventoryName || invItem.name || 'Unknown Item'}
                                </span>
                              ) : (
                                <p className="truncate font-medium text-white">
                                  {item.inventoryName || 'Unknown Item'}
                                </p>
                              )}
                              <p className="text-xs text-slate-400">
                                Need:{' '}
                                {isEditingThis ? (
                                  <input
                                    type="number"
                                    value={materialQtyValue}
                                    onChange={(e) => setMaterialQtyValue(e.target.value)}
                                    onBlur={async () => {
                                      const newQty = parseFloat(materialQtyValue);
                                      if (newQty > 0 && newQty !== item.quantity && item.id) {
                                        setIsSubmitting(true);
                                        await onRemoveInventory(job.id, item.id);
                                        await onAddInventory(
                                          job.id,
                                          item.inventoryId,
                                          newQty,
                                          item.unit
                                        );
                                        setIsSubmitting(false);
                                      }
                                      setEditingMaterialQty(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingMaterialQty(null);
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-16 rounded border border-primary bg-white/10 px-2 py-0.5 text-xs text-white"
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    onClick={(e) => {
                                      if (currentUser.isAdmin && item.id) {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setEditingMaterialQty(item.id);
                                        setMaterialQtyValue(item.quantity.toString());
                                      }
                                    }}
                                    className={
                                      currentUser.isAdmin
                                        ? '-mx-2 -my-1 inline-block cursor-pointer rounded px-2 py-1 transition-colors hover:bg-primary/10 hover:text-primary hover:underline'
                                        : ''
                                    }
                                    title={currentUser.isAdmin ? 'Click to edit quantity' : ''}
                                  >
                                    {item.quantity}
                                  </span>
                                )}{' '}
                                {item.unit}
                                {isMaterialAuto(item.inventoryId, item.quantity) && (
                                  <span className="ml-1.5 rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                                    auto
                                  </span>
                                )}
                                {invItem && (
                                  <span className="ml-2">
                                    • Available: {invItem.available ?? calculateAvailable(invItem)}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>

                          {currentUser.isAdmin && item.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveInventory(item.id!);
                              }}
                              className="ml-2 p-1 text-red-400 hover:text-red-300"
                              title="Remove material"
                            >
                              <span className="material-symbols-outlined text-lg">delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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

            {/* Job Attachments Section (Admin Only — standard users only see part drawing above) */}
            {currentUser.isAdmin && (
              <div className="p-3 pt-0">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <span className="material-symbols-outlined text-lg text-primary">
                      attach_file
                    </span>
                    Job Attachments ({regularAttachments.length})
                  </h3>
                  <FileUploadButton
                    onUpload={(file) => handleFileUpload(file, false)}
                    label="Upload File"
                  />
                </div>

                <AttachmentsList
                  attachments={regularAttachments}
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

            {/* Comments Section */}
            <div className="p-3 pt-0">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <span className="material-symbols-outlined text-lg text-primary">chat</span>
                Comments ({job.comments?.length || 0})
              </h3>

              {/* Add Comment */}
              <div className="mb-3 rounded-sm bg-[#261a32] p-3">
                <div className="flex gap-2">
                  <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-bold text-white">
                    {currentUser.initials}
                  </div>
                  <div className="flex-1">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                      rows={2}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleSubmitComment}
                        disabled={!newComment.trim() || isSubmitting}
                        className="rounded-sm bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {isSubmitting ? 'Posting...' : 'Post'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Comments List */}
              <div className="space-y-2">
                {(job.comments || []).map((comment) => {
                  const isOwnComment = comment.user === currentUser.id;
                  const canEdit = isOwnComment || currentUser.isAdmin;
                  const isEditingThis = editingCommentId === comment.id;

                  return (
                    <div key={comment.id} className="rounded-sm bg-[#261a32] p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-sm bg-slate-600 text-xs font-bold text-white">
                          {comment.userInitials || 'U'}
                        </div>
                        <div className="flex-1">
                          <div className="mb-1 flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">
                                {comment.userName || 'User'}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatCommentTime(comment.created || comment.timestamp)}
                              </p>
                            </div>
                            {canEdit && !isEditingThis && (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => {
                                    setEditingCommentId(comment.id);
                                    setEditingCommentText(comment.text);
                                  }}
                                  className="p-1 text-slate-400 hover:text-primary"
                                  title="Edit comment"
                                >
                                  <span className="material-symbols-outlined text-sm">edit</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteComment(comment.id)}
                                  className="p-1 text-slate-400 hover:text-red-500"
                                  title="Delete comment"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {isEditingThis ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingCommentText}
                                onChange={(e) => setEditingCommentText(e.target.value)}
                                className="w-full resize-none rounded border border-primary/30 bg-[#1a1122] p-2 text-sm text-white outline-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => {
                                    setEditingCommentId(null);
                                    setEditingCommentText('');
                                  }}
                                  className="rounded px-3 py-1 text-xs font-bold text-slate-400 hover:bg-slate-700"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleUpdateComment(comment.id)}
                                  disabled={!editingCommentText.trim()}
                                  className="rounded bg-primary px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-300">{comment.text}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(!job.comments || job.comments.length === 0) && (
                  <p className="py-4 text-center text-sm text-slate-500">No comments yet</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Add Inventory Modal */}
      {showAddInventory && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/80 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full flex-col rounded-t-md border-t border-white/10 bg-background-dark p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Add Material</h3>
              <button
                onClick={() => setShowAddInventory(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                search
              </span>
              <input
                type="text"
                placeholder="Search inventory..."
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                className="h-12 w-full rounded-sm border border-white/20 bg-white/10 pl-10 pr-4 text-white"
              />
            </div>

            {/* Inventory List */}
            <div className="mb-3 flex-1 space-y-2 overflow-y-auto">
              {filteredInventory.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedInventory(item.id)}
                  className={`w-full rounded-sm p-3 text-left transition-colors ${
                    selectedInventory === item.id
                      ? 'border border-primary bg-primary/20'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="text-xs text-slate-400">
                    Available: {item.available ?? calculateAvailable(item)} {item.unit} \u2022{' '}
                    {item.category}
                  </p>
                </button>
              ))}
            </div>

            {/* Quantity & Submit */}
            {selectedInventory && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-400">
                    Quantity Needed
                  </label>
                  <input
                    type="number"
                    value={inventoryQty}
                    onChange={(e) => setInventoryQty(e.target.value)}
                    className="mt-1 h-12 w-full rounded-sm border border-white/20 bg-white/10 px-4 text-white"
                    min="1"
                  />
                </div>
                <button
                  onClick={handleAddInventory}
                  disabled={isSubmitting}
                  className="w-full rounded-sm bg-primary py-3 font-bold text-white disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add to Job'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fixed Bottom Action Bar */}
      {!isEditing && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-background-dark/95 p-3 backdrop-blur-md">
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
            {currentUser.isAdmin && (
              <button
                onClick={() => setShowAddInventory(true)}
                className="rounded-sm border border-primary/30 bg-primary/20 px-4 py-3 font-bold text-primary transition-colors hover:bg-primary/30 active:scale-[0.98]"
              >
                <span className="material-symbols-outlined align-middle">add</span>
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
            } else {
              handleBinLocationUpdate(location);
              setShowBinLocationScanner(false);
            }
          }}
          onClose={() => setShowBinLocationScanner(false)}
        />
      )}
    </div>
  );
};

export default JobDetail;
