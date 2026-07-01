import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Job, JobStatus, ViewState, User, Shift } from '@/core/types';
import {
  buildCapacityAwareBackwardSchedules,
  buildCapacityAwareForwardSchedules,
  getDailyCapacityForDate,
  getWeeklyCapacityHours,
  getWeeklyWorkHours,
  planForwardFromDate,
} from '@/lib/workHours';
import { calculateJobHoursFromShifts } from '@/lib/laborSuggestion';
import { formatDateOnly } from '@/core/date';
import { getJobDisplayName } from '@/lib/formatJob';
import { useScrollRestore } from '@/hooks/useScrollRestore';
import { useSettings } from '@/contexts/SettingsContext';
import { getMachineTotalsFromJob } from '@/lib/machineHours';
import { computeJobCompletionProgress } from '@/lib/jobProgress';
import { requiresPastEcdApproval } from '@/lib/calendarDateGuard';
import { useToast } from '@/Toast';

interface CalendarProps {
  jobs: Job[];
  shifts: Shift[];
  currentUser: User;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  refreshJobs?: () => Promise<void>;
  refreshShifts?: () => Promise<void>;
  onUpdateJob?: (jobId: string, updates: Partial<Job>) => Promise<Job | null>;
}

interface JobTimeline {
  job: Job;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (planned completion = last allocation date)
  hours: number;
  overtimeHours: number;
  unscheduledHours: number;
  allocations: Array<{
    date: string;
    scheduledHours: number;
    regularHours: number;
    overtimeHours: number;
    capacityHours: number;
  }>;
  /** Overdue = due date has passed; At risk = due in future but plan will miss it; Behind = plan past ECD */
  scheduleRisk: 'overdue' | 'behind' | 'atRisk' | null;
}

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Strips any time component from a date string and returns a local-time Date object. */
const parseDateStringLocal = (s: string) => new Date(s.split('T')[0] + 'T00:00:00');

/**
 * Threshold (in hours) below which the difference between remainingLaborHours and
 * plannedLaborHours is considered insignificant — falls back to the scheduled hours
 * display. 0.05 h = 3 minutes.
 */
const REMAINING_DISPLAY_THRESHOLD_HOURS = 0.05;

const normalizeDateKey = (value: string) => {
  const datePart = value.split(/[T ]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return datePart;
  return toDateKey(parsed);
};

/** Calendar only includes jobs in pipeline from RFQ Sent through Quality Control. */
const CALENDAR_STATUSES: JobStatus[] = [
  'rfqSent',
  'pod',
  'pending',
  'inProgress',
  'qualityControl',
];

/**
 * Calendar - Admin-only view showing job timelines on a month calendar.
 * Uses due date + labor hours + employee schedule to create a capacity-aware timeline.
 * Includes what-if planning for soonest completion and due-date overtime requirements.
 */
const Calendar: React.FC<CalendarProps> = ({
  jobs: allJobs,
  shifts,
  currentUser,
  onNavigate,
  onBack,
  refreshJobs,
  refreshShifts,
  onUpdateJob,
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [includeOvertimeInSchedule, setIncludeOvertimeInSchedule] = useState(false);
  const [plannerLaborHours, setPlannerLaborHours] = useState('5');
  const [plannerCncHours, setPlannerCncHours] = useState('0');
  const [plannerPrinter3DHours, setPlannerPrinter3DHours] = useState('0');
  const [plannerDueDate, setPlannerDueDate] = useState('');
  const [plannerUseOvertime, setPlannerUseOvertime] = useState(true);
  const [applySchedulePending, setApplySchedulePending] = useState(false);
  const [pastEcdApprovalModal, setPastEcdApprovalModal] = useState<{
    job: Job;
    plannedDate: string;
    resolve: (approved: boolean) => void;
  } | null>(null);
  const { settings } = useSettings();
  const { showToast } = useToast();

  useEffect(() => {
    refreshJobs?.();
    refreshShifts?.();
  }, [refreshJobs, refreshShifts]);

  // Signals handleApplySchedule to stop its loop if the component unmounts
  // while waiting for user input on the past-ECD approval modal.
  const cancelledRef = useRef(false);
  // Stores the resolve of any in-flight modal approval promise so the cleanup
  // can resolve it to false on unmount, unblocking the suspended loop so that
  // the cancelledRef check fires and the loop exits cleanly.
  const pendingModalResolveRef = useRef<((v: boolean) => void) | null>(null);

  const { ref: scrollRef, onScroll: onScrollSave } = useScrollRestore('calendar');
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      // Unblock any pending modal await — without this the loop is permanently
      // suspended (the Promise never resolves) and the cancelledRef break never fires.
      pendingModalResolveRef.current?.(false);
      pendingModalResolveRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      // Only refresh when the tab becomes visible — not when it hides.
      // Without this guard the handler fires on both hide and show, triggering
      // an unnecessary refresh when the user switches away from the tab.
      if (document.visibilityState !== 'visible') return;
      refreshJobs?.();
      refreshShifts?.();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onFocus);
      return () => document.removeEventListener('visibilitychange', onFocus);
    }
  }, [refreshJobs, refreshShifts]);

  const jobs = useMemo(
    () => allJobs.filter((j) => j.active && CALENDAR_STATUSES.includes(j.status)),
    [allJobs]
  );
  const baseScheduleOptions = useMemo(
    () => ({
      employeeCount: settings.employeeCount,
      workWeekSchedule: settings.workWeekSchedule,
    }),
    [settings.employeeCount, settings.workWeekSchedule]
  );
  const weeklyRegularHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(settings.workWeekSchedule),
    [settings.workWeekSchedule]
  );
  const weeklyMaxHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(settings.workWeekSchedule, { includeOvertime: true }),
    [settings.workWeekSchedule]
  );
  const weeklyOvertimeHoursPerEmployee = useMemo(
    () => Math.max(0, weeklyMaxHoursPerEmployee - weeklyRegularHoursPerEmployee),
    [weeklyMaxHoursPerEmployee, weeklyRegularHoursPerEmployee]
  );
  const weeklyCapacityHours = useMemo(
    () => getWeeklyCapacityHours(settings.employeeCount, settings.workWeekSchedule),
    [settings.employeeCount, settings.workWeekSchedule]
  );
  const weeklyCapacityWithOvertime = useMemo(
    () =>
      getWeeklyCapacityHours(settings.employeeCount, settings.workWeekSchedule, {
        includeOvertime: true,
      }),
    [settings.employeeCount, settings.workWeekSchedule]
  );

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const cncScheduleInputs = useMemo(
    () =>
      jobs
        .filter((job) => job.dueDate && job.active)
        .map((job) => ({
          id: job.id,
          dueDate: job.dueDate!,
          requiredHours: getMachineTotalsFromJob(job).cncHours,
          isRush: job.isRush,
        }))
        .filter((job) => job.requiredHours > 0),
    [jobs]
  );
  const printer3DScheduleInputs = useMemo(
    () =>
      jobs
        .filter((job) => job.dueDate && job.active)
        .map((job) => ({
          id: job.id,
          dueDate: job.dueDate!,
          requiredHours: getMachineTotalsFromJob(job).printer3DHours,
          isRush: job.isRush,
        }))
        .filter((job) => job.requiredHours > 0),
    [jobs]
  );

  const cncCapacitySchedule = useMemo(
    () =>
      buildCapacityAwareBackwardSchedules(cncScheduleInputs, {
        ...baseScheduleOptions,
        includeOvertime: false,
      }),
    [cncScheduleInputs, baseScheduleOptions]
  );
  const printer3DCapacitySchedule = useMemo(
    () =>
      buildCapacityAwareBackwardSchedules(printer3DScheduleInputs, {
        ...baseScheduleOptions,
        includeOvertime: false,
      }),
    [printer3DScheduleInputs, baseScheduleOptions]
  );

  /** CNC must finish before labor; per-job last date of CNC work. */
  const cncCompletionByJobId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of cncCapacitySchedule.results) {
      const last = r.allocations[r.allocations.length - 1];
      if (last) map.set(r.id, last.date);
    }
    return map;
  }, [cncCapacitySchedule.results]);

  // Dev-only: warn once per render cycle (not inside useMemo) when a CNC completion date is malformed.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    for (const [jobId, date] of cncCompletionByJobId) {
      if (Number.isNaN(parseDateStringLocal(date).getTime())) {
        console.warn(`[Calendar] Invalid cncCompletion date for job ${jobId}: "${date}"`);
      }
    }
  }, [cncCompletionByJobId]);

  /** Single pass over shifts — jobProgressById and laborForwardInputs read from this map. */
  const loggedHoursByJobId = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of jobs) {
      map.set(job.id, calculateJobHoursFromShifts(job.id, shifts));
    }
    return map;
  }, [jobs, shifts]);

  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const jobProgressById = useMemo(() => {
    const next = new Map<string, ReturnType<typeof computeJobCompletionProgress>>();
    for (const job of jobs) {
      next.set(job.id, computeJobCompletionProgress(job, loggedHoursByJobId.get(job.id) ?? 0));
    }
    return next;
  }, [jobs, loggedHoursByJobId]);
  const jobMachineById = useMemo(() => {
    const next = new Map<string, ReturnType<typeof getMachineTotalsFromJob>>();
    for (const job of jobs) {
      next.set(job.id, getMachineTotalsFromJob(job));
    }
    return next;
  }, [jobs]);

  /** Labor inputs — remainingLaborHours from jobProgressById drives adaptive completion dates. */
  const laborForwardInputs = useMemo(
    () =>
      jobs
        .filter((job) => job.dueDate && job.active)
        .map((job) => {
          const requiredHours = jobProgressById.get(job.id)?.remainingLaborHours ?? 0;
          const cncHours = jobMachineById.get(job.id)?.cncHours ?? 0;
          const cncCompletion = cncHours > 0 ? cncCompletionByJobId.get(job.id) : null;
          // CNC must finish the day before labor starts
          let earliestStartDate = todayKey;
          if (cncCompletion) {
            // Strip any existing time component so a full ISO timestamp doesn't produce an invalid date.
            const cncDate = parseDateStringLocal(cncCompletion);
            const cncDateInvalid = Number.isNaN(cncDate.getTime());
            const laborStartDayAfterCnc = cncDateInvalid
              ? new Date(todayKey + 'T00:00:00')
              : new Date(cncDate.getFullYear(), cncDate.getMonth(), cncDate.getDate() + 1);
            const laborStartKey = `${laborStartDayAfterCnc.getFullYear()}-${String(laborStartDayAfterCnc.getMonth() + 1).padStart(2, '0')}-${String(laborStartDayAfterCnc.getDate()).padStart(2, '0')}`;
            earliestStartDate = laborStartKey > todayKey ? laborStartKey : todayKey;
          }
          return {
            id: job.id,
            earliestStartDate,
            dueDate: job.dueDate!,
            requiredHours,
            isRush: job.isRush,
          };
        })
        .filter((job) => job.requiredHours > 0),
    [jobs, jobProgressById, jobMachineById, todayKey, cncCompletionByJobId]
  );

  const capacityAwareSchedule = useMemo(
    () =>
      buildCapacityAwareForwardSchedules(laborForwardInputs, {
        ...baseScheduleOptions,
        includeOvertime: includeOvertimeInSchedule,
      }),
    [laborForwardInputs, baseScheduleOptions, includeOvertimeInSchedule]
  );

  const jobTimelines = useMemo((): JobTimeline[] => {
    const scheduledIds = new Set(capacityAwareSchedule.results.map((r) => r.id));
    const fromSchedule: JobTimeline[] = capacityAwareSchedule.results
      .map((result) => {
        const job = jobsById.get(result.id);
        if (!job) return null;
        const plannedEndDate =
          result.allocations.length > 0
            ? result.allocations[result.allocations.length - 1].date
            : result.startDate;
        const dueKey = normalizeDateKey(job.dueDate ?? '');
        const ecdKey = job.ecd ? normalizeDateKey(job.ecd) : null;
        let scheduleRisk: 'overdue' | 'behind' | 'atRisk' | null = null;
        if (dueKey && dueKey < todayKey) scheduleRisk = 'overdue';
        else if (dueKey && plannedEndDate > dueKey) scheduleRisk = 'atRisk';
        else if (ecdKey && plannedEndDate > ecdKey) scheduleRisk = 'behind';

        return {
          job,
          startDate: result.startDate,
          endDate: plannedEndDate,
          hours: result.requiredHours,
          overtimeHours: result.overtimeHours,
          unscheduledHours: result.unscheduledHours,
          allocations: result.allocations,
          scheduleRisk,
        } as JobTimeline;
      })
      .filter((timeline): timeline is JobTimeline => timeline != null);

    // Placeholder timelines for jobs with a due date but no labor (planning only) — show on due date in any month
    const placeholders: JobTimeline[] = jobs
      .filter((job) => job.dueDate && !scheduledIds.has(job.id))
      .map((job) => {
        const dueKey = normalizeDateKey(job.dueDate!);
        const scheduleRisk: 'overdue' | 'behind' | 'atRisk' | null =
          dueKey && dueKey < todayKey ? 'overdue' : null;
        return {
          job,
          startDate: dueKey,
          endDate: dueKey,
          hours: 0,
          overtimeHours: 0,
          unscheduledHours: 0,
          allocations: [
            {
              date: dueKey,
              scheduledHours: 0,
              regularHours: 0,
              overtimeHours: 0,
              capacityHours: 0,
            },
          ],
          scheduleRisk,
        } as JobTimeline;
      });

    const combined = [...fromSchedule, ...placeholders];
    return combined.sort((a, b) => {
      const riskOrder = { overdue: 0, behind: 1, atRisk: 2, null: 3 };
      const aRisk = riskOrder[a.scheduleRisk ?? 'null'] ?? 3;
      const bRisk = riskOrder[b.scheduleRisk ?? 'null'] ?? 3;
      if (aRisk !== bRisk) return aRisk - bRisk;
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    });
  }, [capacityAwareSchedule.results, jobs, jobsById, todayKey]);

  /** Pre-computed per-date lookup — replaces O(jobs × allocations) filter per calendar cell with O(1). */
  const jobsByDateKey = useMemo(() => {
    const map = new Map<string, JobTimeline[]>();
    for (const tl of jobTimelines) {
      // endDate is always the last allocation date (or the sole allocation for placeholders),
      // so it is already in the allocation set — no need to add it separately.
      const keys = new Set(tl.allocations.map((a) => a.date));
      for (const key of keys) {
        // Use spread to produce a new array reference on each insertion, preserving
        // referential stability for any downstream consumer that caches by reference.
        map.set(key, [...(map.get(key) ?? []), tl]);
      }
    }
    return map;
  }, [jobTimelines]);

  const handleApplySchedule = useCallback(async () => {
    if (!onUpdateJob || !refreshJobs) return;
    setApplySchedulePending(true);
    try {
      for (const tl of jobTimelines) {
        // Check cancellation at the top of every iteration — not just inside the
        // needsApproval block — so jobs that skip ECD approval also respect unmount.
        if (cancelledRef.current) break;

        // Re-validate against the live jobs list — the job may have moved out of
        // calendar scope (e.g. to 'finished') while waiting for a past-ECD approval
        // on an earlier entry. Applying a scheduled date to a terminal job would be
        // a stale write.
        const liveJob = jobs.find((j) => j.id === tl.job.id);
        if (!liveJob) continue;

        // Use liveJob for the ECD gate — tl.job is a snapshot from jobTimelines
        // and its ECD field may be stale after a concurrent update during the loop.
        const needsApproval = requiresPastEcdApproval(liveJob, tl.endDate);
        if (needsApproval) {
          const approved = await new Promise<boolean>((resolve) => {
            // Register the resolve so the cleanup effect can unblock this await
            // if the component unmounts while the modal is waiting for input.
            pendingModalResolveRef.current = resolve;
            setPastEcdApprovalModal({ job: liveJob, plannedDate: tl.endDate, resolve });
          });
          pendingModalResolveRef.current = null;
          // Component unmounted while awaiting user response — stop writing
          // planned dates on behalf of a destroyed calendar view.
          if (cancelledRef.current) break;
          if (!approved) continue;
        }
        await onUpdateJob(tl.job.id, { plannedCompletionDate: tl.endDate });
      }
      await refreshJobs();
      showToast('Schedule applied to planned completion dates', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to apply schedule', 'error');
    } finally {
      setApplySchedulePending(false);
      setPastEcdApprovalModal(null);
    }
  }, [jobs, jobTimelines, onUpdateJob, refreshJobs, showToast]);

  const handlePastEcdApproval = useCallback(
    (approved: boolean) => {
      if (!pastEcdApprovalModal) return;
      // Guard against double-invocation: if two clicks arrive before the React state
      // update clears pastEcdApprovalModal, only the first should call resolve().
      // pendingModalResolveRef.current is nulled out on the first call, so subsequent
      // calls from the same render cycle are no-ops before ever touching the Promise.
      if (pendingModalResolveRef.current === null) return;
      // Capture resolve before clearing the modal — then clear first to prevent a
      // second click during the async settle from calling resolve() a second time.
      const { resolve } = pastEcdApprovalModal;
      setPastEcdApprovalModal(null);
      // Also clear the pending ref so the cleanup effect doesn't fire it a second
      // time if the component unmounts before the next loop iteration runs.
      pendingModalResolveRef.current = null;
      resolve(approved);
    },
    [pastEcdApprovalModal]
  );

  // Get days in current month
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const firstDayOfWeek = monthStart.getDay();

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];

    // Previous month days
    const prevMonthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0);
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(
          prevMonthEnd.getFullYear(),
          prevMonthEnd.getMonth(),
          prevMonthEnd.getDate() - i
        ),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({
        date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day),
        isCurrentMonth: true,
      });
    }

    // Next month days to fill week
    const remaining = 42 - days.length; // 6 weeks × 7 days
    for (let day = 1; day <= remaining; day++) {
      days.push({
        date: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, day),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [currentMonth, daysInMonth, firstDayOfWeek]);

  const dayLoadMap = useMemo(() => {
    const loadByDate = new Map<
      string,
      {
        scheduledHours: number;
        regularHours: number;
        overtimeHours: number;
        capacityHours: number;
        regularCapacityHours: number;
        overtimeCapacityHours: number;
      }
    >();
    for (const [date, usage] of Object.entries(capacityAwareSchedule.dayUsage)) {
      const capacity = getDailyCapacityForDate(date, {
        ...baseScheduleOptions,
        includeOvertime: includeOvertimeInSchedule,
      });
      const overtimeCapacityHours = includeOvertimeInSchedule ? capacity.overtimeCapacityHours : 0;
      loadByDate.set(date, {
        scheduledHours: usage.totalHours,
        regularHours: usage.regularHours,
        overtimeHours: usage.overtimeHours,
        capacityHours: capacity.regularCapacityHours + overtimeCapacityHours,
        regularCapacityHours: capacity.regularCapacityHours,
        overtimeCapacityHours,
      });
    }
    return loadByDate;
  }, [capacityAwareSchedule.dayUsage, baseScheduleOptions, includeOvertimeInSchedule]);
  const cncDayLoadMap = useMemo(() => {
    const loadByDate = new Map<string, { scheduledHours: number; capacityHours: number }>();
    for (const [date, usage] of Object.entries(cncCapacitySchedule.dayUsage)) {
      const capacity = getDailyCapacityForDate(date, {
        ...baseScheduleOptions,
        includeOvertime: false,
      });
      loadByDate.set(date, {
        scheduledHours: usage.totalHours,
        capacityHours: capacity.regularCapacityHours,
      });
    }
    return loadByDate;
  }, [cncCapacitySchedule.dayUsage, baseScheduleOptions]);
  const printer3DDayLoadMap = useMemo(() => {
    const loadByDate = new Map<string, { scheduledHours: number; capacityHours: number }>();
    for (const [date, usage] of Object.entries(printer3DCapacitySchedule.dayUsage)) {
      const capacity = getDailyCapacityForDate(date, {
        ...baseScheduleOptions,
        includeOvertime: false,
      });
      loadByDate.set(date, {
        scheduledHours: usage.totalHours,
        capacityHours: capacity.regularCapacityHours,
      });
    }
    return loadByDate;
  }, [printer3DCapacitySchedule.dayUsage, baseScheduleOptions]);

  // Generate unique color for job based on ID
  const getJobColor = (jobId: string): string => {
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-purple-500',
      'bg-orange-500',
      'bg-pink-500',
      'bg-cyan-500',
      'bg-yellow-500',
      'bg-indigo-500',
      'bg-danger',
      'bg-teal-500',
    ];
    let hash = 0;
    for (let i = 0; i < jobId.length; i++) {
      hash = jobId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const weekDaysLong = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekDaysShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const changeMonth = (delta: number) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
  };

  const plannerLaborRequiredHours = useMemo(() => {
    const parsed = parseFloat(plannerLaborHours);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [plannerLaborHours]);
  const plannerCncRequiredHours = useMemo(() => {
    const parsed = parseFloat(plannerCncHours);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [plannerCncHours]);
  const plannerPrinter3DRequiredHours = useMemo(() => {
    const parsed = parseFloat(plannerPrinter3DHours);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [plannerPrinter3DHours]);
  const plannerAnyHours =
    plannerLaborRequiredHours > 0 ||
    plannerCncRequiredHours > 0 ||
    plannerPrinter3DRequiredHours > 0;

  const earliestLaborPlan = useMemo(() => {
    if (plannerLaborRequiredHours <= 0) return null;
    return planForwardFromDate(
      plannerLaborRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: plannerUseOvertime,
      },
      capacityAwareSchedule.dayUsage
    );
  }, [
    plannerLaborRequiredHours,
    todayKey,
    baseScheduleOptions,
    plannerUseOvertime,
    capacityAwareSchedule.dayUsage,
  ]);
  const earliestCncPlan = useMemo(() => {
    if (plannerCncRequiredHours <= 0) return null;
    return planForwardFromDate(
      plannerCncRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: false,
      },
      cncCapacitySchedule.dayUsage
    );
  }, [plannerCncRequiredHours, todayKey, baseScheduleOptions, cncCapacitySchedule.dayUsage]);
  const earliestPrinter3DPlan = useMemo(() => {
    if (plannerPrinter3DRequiredHours <= 0) return null;
    return planForwardFromDate(
      plannerPrinter3DRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: false,
      },
      printer3DCapacitySchedule.dayUsage
    );
  }, [
    plannerPrinter3DRequiredHours,
    todayKey,
    baseScheduleOptions,
    printer3DCapacitySchedule.dayUsage,
  ]);

  const laborDuePlanWithoutOvertime = useMemo(() => {
    if (plannerLaborRequiredHours <= 0 || !plannerDueDate) return null;
    return planForwardFromDate(
      plannerLaborRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: false,
      },
      capacityAwareSchedule.dayUsage,
      plannerDueDate
    );
  }, [
    plannerLaborRequiredHours,
    plannerDueDate,
    todayKey,
    baseScheduleOptions,
    capacityAwareSchedule.dayUsage,
  ]);
  const cncDuePlan = useMemo(() => {
    if (plannerCncRequiredHours <= 0 || !plannerDueDate) return null;
    return planForwardFromDate(
      plannerCncRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: false,
      },
      cncCapacitySchedule.dayUsage,
      plannerDueDate
    );
  }, [
    plannerCncRequiredHours,
    plannerDueDate,
    todayKey,
    baseScheduleOptions,
    cncCapacitySchedule.dayUsage,
  ]);
  const printer3DDuePlan = useMemo(() => {
    if (plannerPrinter3DRequiredHours <= 0 || !plannerDueDate) return null;
    return planForwardFromDate(
      plannerPrinter3DRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: false,
      },
      printer3DCapacitySchedule.dayUsage,
      plannerDueDate
    );
  }, [
    plannerPrinter3DRequiredHours,
    plannerDueDate,
    todayKey,
    baseScheduleOptions,
    printer3DCapacitySchedule.dayUsage,
  ]);

  const earliestCompletionDate = useMemo(() => {
    const dates = [earliestLaborPlan, earliestCncPlan, earliestPrinter3DPlan]
      .map((plan) => plan?.completionDate ?? null)
      .filter((value): value is string => Boolean(value));
    if (dates.length === 0) return null;
    return dates.sort()[dates.length - 1];
  }, [earliestLaborPlan, earliestCncPlan, earliestPrinter3DPlan]);

  return (
    <div className="flex h-full flex-col bg-background-dark">
      {/* Header - mobile-first: stack on narrow screens, safe area for iPhone notch */}
      <div className="safe-area-top shrink-0 border-b border-line bg-background-light px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {onBack && (
                <button
                  onClick={onBack}
                  className="flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-overlay/10 hover:text-white"
                  aria-label="Back"
                >
                  <span className="material-symbols-outlined text-xl">arrow_back</span>
                </button>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold text-white sm:text-xl">Calendar</h1>
                <p className="truncate text-xs text-muted">Job timelines and scheduling</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setIncludeOvertimeInSchedule((v) => !v)}
              className={`min-h-[44px] touch-manipulation rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:px-3 ${
                includeOvertimeInSchedule
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-overlay/5 text-muted hover:bg-overlay/10'
              }`}
            >
              <span className="hidden sm:inline">
                {includeOvertimeInSchedule ? 'Using OT Capacity' : 'Regular Capacity Only'}
              </span>
              <span className="sm:hidden">{includeOvertimeInSchedule ? 'OT on' : 'OT off'}</span>
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => changeMonth(-1)}
                className="flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-overlay/10 hover:text-white"
                aria-label="Previous month"
              >
                <span className="material-symbols-outlined text-xl">chevron_left</span>
              </button>
              <h2 className="min-w-[140px] text-center text-sm font-bold text-white sm:min-w-[180px] sm:text-base">
                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </h2>
              <button
                onClick={() => changeMonth(1)}
                className="flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-overlay/10 hover:text-white"
                aria-label="Next month"
              >
                <span className="material-symbols-outlined text-xl">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Grid - scrollable with safe area bottom for iPhone */}
      <div
        ref={scrollRef}
        onScroll={onScrollSave}
        className="flex-1 overflow-x-auto overflow-y-auto px-3 py-4 pb-[env(safe-area-inset-bottom)] sm:px-4"
      >
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-[11px] text-muted sm:p-3 sm:text-xs">
          <p>
            {settings.employeeCount} emp · {weeklyRegularHoursPerEmployee.toFixed(1)}h reg/wk
          </p>
          <p className="mt-0.5 sm:mt-1">
            OT/emp: {weeklyOvertimeHoursPerEmployee.toFixed(1)}h · Reg cap:{' '}
            <span className="font-medium text-primary">{weeklyCapacityHours.toFixed(1)}h</span> ·
            Max: <span className="text-amber-300">{weeklyCapacityWithOvertime.toFixed(1)}h</span>
          </p>
          {onUpdateJob && (
            <div className="mt-2">
              <button
                type="button"
                onClick={handleApplySchedule}
                disabled={applySchedulePending || jobTimelines.length === 0}
                className="min-h-[36px] touch-manipulation rounded border border-primary/50 bg-primary/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/30 disabled:opacity-50"
              >
                {applySchedulePending ? 'Applying…' : 'Apply schedule'}
              </button>
              <span className="ml-2 text-[10px] text-muted">
                Saves planned completion dates (ECD never changed by calendar).
              </span>
            </div>
          )}
        </div>

        <div className="app-list-row mb-4 p-2.5 sm:p-3">
          <h3 className="mb-2 text-sm font-bold text-white sm:mb-3">New Job Planner</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            <label className="col-span-2 text-xs text-muted sm:col-span-1">
              Labor hrs
              <input
                type="number"
                min="0.1"
                step="0.01"
                value={plannerLaborHours}
                onChange={(e) => setPlannerLaborHours(e.target.value)}
                className="mt-1 min-h-[44px] w-full touch-manipulation rounded border border-line bg-overlay/5 px-2 py-2 text-sm text-white focus:border-primary/50 focus:outline-none sm:min-h-0"
              />
            </label>
            <label className="text-xs text-muted">
              CNC hrs
              <input
                type="number"
                min="0"
                step="0.01"
                value={plannerCncHours}
                onChange={(e) => setPlannerCncHours(e.target.value)}
                className="mt-1 min-h-[44px] w-full touch-manipulation rounded border border-line bg-overlay/5 px-2 py-2 text-sm text-white focus:border-primary/50 focus:outline-none sm:min-h-0"
              />
            </label>
            <label className="text-xs text-muted">
              3D hrs
              <input
                type="number"
                min="0"
                step="0.01"
                value={plannerPrinter3DHours}
                onChange={(e) => setPlannerPrinter3DHours(e.target.value)}
                className="mt-1 min-h-[44px] w-full touch-manipulation rounded border border-line bg-overlay/5 px-2 py-2 text-sm text-white focus:border-primary/50 focus:outline-none sm:min-h-0"
              />
            </label>
            <label className="text-xs text-muted">
              Due date
              <input
                type="date"
                value={plannerDueDate}
                onChange={(e) => setPlannerDueDate(e.target.value)}
                className="mt-1 min-h-[44px] w-full touch-manipulation rounded border border-line bg-overlay/5 px-2 py-2 text-sm text-white focus:border-primary/50 focus:outline-none sm:min-h-0"
              />
            </label>
            <label className="col-span-2 text-xs text-muted sm:col-span-1">
              Use OT for soonest
              <button
                type="button"
                onClick={() => setPlannerUseOvertime((v) => !v)}
                className={`mt-1 flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded border px-2 text-sm font-medium transition-colors ${
                  plannerUseOvertime
                    ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                    : 'border-line bg-overlay/5 text-muted'
                }`}
              >
                {plannerUseOvertime ? 'Yes' : 'No'}
              </button>
            </label>
          </div>

          {plannerAnyHours && (
            <div className="mt-3 rounded border border-line bg-black/20 p-2.5 text-[11px] text-muted sm:p-3 sm:text-xs">
              <p>
                Soonest completion:{' '}
                <span className="font-semibold text-white">
                  {earliestCompletionDate
                    ? formatDateOnly(earliestCompletionDate)
                    : 'No capacity found'}
                </span>
              </p>
              <p className="mt-1">
                Labor lane:{' '}
                {earliestLaborPlan?.completionDate
                  ? formatDateOnly(earliestLaborPlan.completionDate)
                  : 'n/a'}
              </p>
              <p className="mt-1">
                CNC lane:{' '}
                {earliestCncPlan?.completionDate
                  ? formatDateOnly(earliestCncPlan.completionDate)
                  : 'n/a'}
              </p>
              <p className="mt-1">
                3D lane:{' '}
                {earliestPrinter3DPlan?.completionDate
                  ? formatDateOnly(earliestPrinter3DPlan.completionDate)
                  : 'n/a'}
              </p>
            </div>
          )}

          {plannerAnyHours && plannerDueDate && (
            <div className="mt-3 rounded border border-line bg-black/20 p-2.5 text-[11px] text-muted sm:p-3 sm:text-xs">
              <p className="mb-1">Due-date lane checks ({formatDateOnly(plannerDueDate)}):</p>
              {laborDuePlanWithoutOvertime && (
                <p className="mt-1">
                  Labor:{' '}
                  {laborDuePlanWithoutOvertime.remainingHours <= 0 ? (
                    <span className="font-semibold text-green-400">fits</span>
                  ) : (
                    <span className="font-semibold text-red-400">
                      short {laborDuePlanWithoutOvertime.remainingHours.toFixed(1)}h
                    </span>
                  )}
                </p>
              )}
              {cncDuePlan && (
                <p className="mt-1">
                  CNC:{' '}
                  {cncDuePlan.remainingHours <= 0 ? (
                    <span className="font-semibold text-green-400">fits</span>
                  ) : (
                    <span className="font-semibold text-red-400">
                      short {cncDuePlan.remainingHours.toFixed(1)}h
                    </span>
                  )}
                </p>
              )}
              {printer3DDuePlan && (
                <p className="mt-1">
                  3D:{' '}
                  {printer3DDuePlan.remainingHours <= 0 ? (
                    <span className="font-semibold text-green-400">fits</span>
                  ) : (
                    <span className="font-semibold text-red-400">
                      short {printer3DDuePlan.remainingHours.toFixed(1)}h
                    </span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid min-w-[280px] grid-cols-7 gap-0.5 sm:gap-1">
          {/* Week day headers - short on mobile for iPhone */}
          {weekDaysShort.map((day, i) => (
            <div
              key={weekDaysLong[i]}
              className="py-1.5 text-center text-[10px] font-bold text-muted sm:py-2 sm:text-xs"
            >
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {calendarDays.map((dayData, idx) => {
            const dateKey = toDateKey(dayData.date);
            const jobsForDay = jobsByDateKey.get(dateKey) ?? [];
            const isToday = dayData.date.toDateString() === new Date().toDateString();
            const dayLoad = dayLoadMap.get(dateKey);
            const cncDayLoad = cncDayLoadMap.get(dateKey);
            const printer3DDayLoad = printer3DDayLoadMap.get(dateKey);
            const dayCapacity = getDailyCapacityForDate(dateKey, {
              ...baseScheduleOptions,
              includeOvertime: includeOvertimeInSchedule,
            });
            const overtimeCapacity = includeOvertimeInSchedule
              ? dayCapacity.overtimeCapacityHours
              : 0;
            const totalCapacity = dayCapacity.regularCapacityHours + overtimeCapacity;
            const scheduledHours = dayLoad?.scheduledHours ?? 0;
            const overtimeHours = dayLoad?.overtimeHours ?? 0;
            const overCapacity = totalCapacity > 0 && scheduledHours > totalCapacity + 0.01;

            return (
              <div
                key={idx}
                className={`min-h-[72px] rounded border p-0.5 sm:min-h-[80px] sm:p-1 ${
                  dayData.isCurrentMonth
                    ? 'border-line bg-overlay/5'
                    : 'bg-overlay/2 border-line/60'
                } ${isToday ? 'ring-2 ring-primary' : ''}`}
              >
                <div
                  className={`text-[11px] font-medium sm:text-xs ${
                    dayData.isCurrentMonth ? 'text-muted' : 'text-subtle'
                  }`}
                >
                  {dayData.date.getDate()}
                  {totalCapacity > 0 && (
                    <span className="ml-0.5 text-[9px] text-subtle sm:ml-1 sm:text-[10px]">
                      ({totalCapacity.toFixed(1)}h)
                    </span>
                  )}
                </div>
                {totalCapacity > 0 && (
                  <div
                    className={`mt-0.5 text-[9px] sm:text-[10px] ${overCapacity ? 'font-bold text-red-400' : 'text-subtle'}`}
                  >
                    {scheduledHours.toFixed(1)}/{totalCapacity.toFixed(1)}h
                  </div>
                )}
                {overtimeHours > 0 && (
                  <div className="text-[9px] font-medium text-amber-300 sm:text-[10px]">
                    OT {overtimeHours.toFixed(1)}h
                  </div>
                )}
                {cncDayLoad && (
                  <div className="truncate text-[9px] text-cyan-300 sm:text-[10px]">
                    CNC {cncDayLoad.scheduledHours.toFixed(1)}/{cncDayLoad.capacityHours.toFixed(1)}
                    h
                  </div>
                )}
                {printer3DDayLoad && (
                  <div className="truncate text-[9px] text-purple-300 sm:text-[10px]">
                    3D {printer3DDayLoad.scheduledHours.toFixed(1)}/
                    {printer3DDayLoad.capacityHours.toFixed(1)}h
                  </div>
                )}
                <div className="mt-0.5 space-y-0.5 sm:mt-1">
                  {jobsForDay.slice(0, 3).map((tl) => {
                    const progress = jobProgressById.get(tl.job.id);
                    const isAtRisk =
                      tl.scheduleRisk === 'atRisk' || progress?.atRiskFromProgressEstimate;
                    return (
                      <button
                        key={tl.job.id}
                        onClick={() => onNavigate('job-detail', tl.job.id)}
                        className={`min-h-[28px] w-full touch-manipulation truncate rounded px-0.5 py-0.5 text-left text-[9px] font-medium text-white transition-colors hover:opacity-80 sm:min-h-0 sm:text-[10px] ${getJobColor(tl.job.id)}`}
                        title={`#${tl.job.jobCode} - ${getJobDisplayName(tl.job)}`}
                      >
                        {tl.job.isRush && '⚡ '}
                        {tl.job.cncCompletedAt && '✓ '}
                        {tl.job.printer3DCompletedAt && '🖨 '}
                        {tl.scheduleRisk === 'overdue' && '! '}
                        {isAtRisk && tl.scheduleRisk !== 'overdue' && '⚠ '}#{tl.job.jobCode}
                      </button>
                    );
                  })}
                  {jobsForDay.length > 3 && (
                    <div className="text-[9px] text-subtle sm:text-[10px]">
                      +{jobsForDay.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary: Upcoming jobs - mobile-friendly wrap and touch targets */}
        <div className="app-list-row mt-4 p-2.5 sm:p-3">
          <h3 className="mb-2 text-base font-bold text-white sm:mb-3 sm:text-lg">Upcoming Jobs</h3>
          {jobTimelines.length === 0 ? (
            <p className="text-sm text-muted">No jobs with due dates</p>
          ) : (
            <div className="space-y-2">
              {jobTimelines.slice(0, 10).map((tl) => {
                const progress = jobProgressById.get(tl.job.id);
                const machine = jobMachineById.get(tl.job.id);
                return (
                  <button
                    key={tl.job.id}
                    onClick={() => onNavigate('job-detail', tl.job.id)}
                    className="app-list-row w-full touch-manipulation p-2.5 text-left transition-colors active:bg-overlay/10 sm:p-3 sm:hover:bg-overlay/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 gap-y-0.5">
                          <span className="font-bold text-white">#{tl.job.jobCode}</span>
                          <span className="truncate text-sm text-muted">
                            {getJobDisplayName(tl.job)}
                          </span>
                          {tl.job.isRush && <span className="text-yellow-400">⚡</span>}
                          {tl.scheduleRisk === 'overdue' && (
                            <span className="rounded bg-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                              Overdue
                            </span>
                          )}
                          {tl.scheduleRisk === 'behind' && (
                            <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              Behind
                            </span>
                          )}
                          {(tl.scheduleRisk === 'atRisk' || progress?.atRiskFromProgressEstimate) &&
                            tl.scheduleRisk !== 'overdue' && (
                              <span className="rounded bg-orange-500/30 px-1.5 py-0.5 text-[10px] font-bold text-orange-300">
                                At risk
                              </span>
                            )}
                          {tl.job.cncCompletedAt ? (
                            <span className="text-[11px] font-semibold text-green-300">
                              CNC Done
                            </span>
                          ) : (
                            (machine?.cncHours ?? 0) > 0 && (
                              <span className="text-[11px] font-semibold text-amber-300">
                                CNC Pending
                              </span>
                            )
                          )}
                          {tl.job.printer3DCompletedAt ? (
                            <span className="text-[11px] font-semibold text-green-300">
                              3D Done
                            </span>
                          ) : (
                            (machine?.printer3DHours ?? 0) > 0 && (
                              <span className="text-[11px] font-semibold text-blue-300">
                                3D Pending
                              </span>
                            )
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted sm:text-xs">
                          <span>Start: {formatDateOnly(tl.startDate)}</span>
                          {tl.job.dueDate && <span>Due: {formatDateOnly(tl.job.dueDate)}</span>}
                          {tl.job.ecd && <span>ECD: {formatDateOnly(tl.job.ecd)}</span>}
                          <span>
                            Planned: {formatDateOnly(tl.job.plannedCompletionDate ?? tl.endDate)}
                          </span>
                          {/* Show true remaining vs plan when they diverge meaningfully;
                              fall back to planned hours when remaining ≈ plan or nothing left.
                              Uses plannedLaborHours (not tl.hours) so a scheduler-compressed
                              allocation doesn't show a different number than the plan. */}
                          {progress &&
                          progress.remainingLaborHours > 0 &&
                          progress.plannedLaborHours > 0 &&
                          Math.abs(progress.remainingLaborHours - progress.plannedLaborHours) >
                            REMAINING_DISPLAY_THRESHOLD_HOURS ? (
                            <span>
                              {progress.remainingLaborHours.toFixed(1)}h rem
                              <span className="ml-1 text-subtle">
                                / {progress.plannedLaborHours.toFixed(1)}h plan
                              </span>
                            </span>
                          ) : (
                            <span>{(progress?.plannedLaborHours ?? tl.hours).toFixed(1)}h</span>
                          )}
                          {tl.overtimeHours > 0 && (
                            <span className="text-amber-300">
                              OT {tl.overtimeHours.toFixed(1)}h
                            </span>
                          )}
                          {tl.unscheduledHours > 0 && (
                            <span className="text-red-400">
                              Short {tl.unscheduledHours.toFixed(1)}h
                            </span>
                          )}
                        </div>
                        {currentUser.isAdmin && progress && (
                          <div className="mt-2">
                            <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
                              <span>Completion</span>
                              <div className="flex items-center gap-1.5">
                                {progress.laborOverEstimate && (
                                  <span className="rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-semibold text-red-400">
                                    Review
                                  </span>
                                )}
                                <span>{progress.weightedPercent.toFixed(0)}%</span>
                              </div>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-overlay/10">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  progress.laborOverEstimate ? 'bg-danger' : 'bg-primary'
                                }`}
                                style={{ width: `${progress.weightedPercent}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {currentUser.isAdmin && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onNavigate('time-reports', tl.job.id);
                              }}
                              className="min-h-[44px] touch-manipulation rounded border border-line-strong bg-overlay/5 px-3 py-2 text-[10px] font-bold text-muted transition-colors active:bg-overlay/10 sm:hover:bg-overlay/10"
                            >
                              Time
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="material-symbols-outlined mt-0.5 shrink-0 text-muted">
                        chevron_right
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {pastEcdApprovalModal && (
        <div
          className="app-modal-backdrop z-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="past-ecd-title"
        >
          <div className="max-w-md rounded-lg border border-line-strong bg-surface-3 p-4 shadow-xl">
            <h2 id="past-ecd-title" className="text-base font-bold text-white">
              Planned date is after ECD (contract date)
            </h2>
            <p className="mt-2 text-sm text-muted">
              Job #{pastEcdApprovalModal.job.jobCode} — planned completion{' '}
              {formatDateOnly(pastEcdApprovalModal.plannedDate)} is after ECD{' '}
              {pastEcdApprovalModal.job.ecd && formatDateOnly(pastEcdApprovalModal.job.ecd)}.
              Confirm to save this planned date anyway?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handlePastEcdApproval(false)}
                className="min-h-[44px] touch-manipulation rounded border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-overlay/10"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => handlePastEcdApproval(true)}
                className="min-h-[44px] touch-manipulation rounded border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/30"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
