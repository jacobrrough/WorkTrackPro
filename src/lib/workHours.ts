/**
 * Work schedule and capacity calculations.
 * Default schedule (per employee):
 * Mon-Thu 06:30-16:30 with 60m unpaid break, Fri 07:00-11:00 no break.
 */
export interface WorkDaySchedule {
  enabled: boolean;
  standardStart: string; // HH:mm
  standardEnd: string; // HH:mm
  unpaidBreakMinutes: number;
  overtimeEnabled: boolean;
  overtimeStart: string; // HH:mm
  overtimeEnd: string; // HH:mm
}

export type WorkWeekSchedule = Record<number, WorkDaySchedule>;

export interface WorkCapacityOptions {
  employeeCount?: number;
  workWeekSchedule?:
    | WorkWeekSchedule
    | Partial<Record<number, Partial<WorkDaySchedule> | number>>
    | null;
  includeOvertime?: boolean;
}

export interface DailyCapacityBreakdown {
  date: string; // YYYY-MM-DD
  regularCapacityHours: number;
  overtimeCapacityHours: number;
  totalCapacityHours: number;
  regularHoursPerEmployee: number;
  overtimeHoursPerEmployee: number;
}

export interface DailyWorkAllocation {
  date: string; // YYYY-MM-DD
  scheduledHours: number;
  regularHours: number;
  overtimeHours: number;
  regularCapacityHours: number;
  overtimeCapacityHours: number;
  capacityHours: number;
}

export interface DayUsageEntry {
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
}

export interface CapacityScheduleInput {
  id: string;
  dueDate: string | Date;
  requiredHours: number;
  isRush?: boolean;
  priority?: number;
}

export interface CapacityScheduleResult {
  id: string;
  dueDate: string;
  startDate: string;
  requiredHours: number;
  scheduledHours: number;
  overtimeHours: number;
  unscheduledHours: number;
  allocations: DailyWorkAllocation[];
}

export interface CapacityAwareScheduleOutput {
  results: CapacityScheduleResult[];
  dayUsage: Record<string, DayUsageEntry>;
}

export interface ForwardPlanResult {
  completionDate: string | null;
  allocations: DailyWorkAllocation[];
  remainingHours: number;
  overtimeHours: number;
}

const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6] as const;
const MAX_ALLOCATION_LOOKBACK_DAYS = 3650;
const MAX_ALLOCATION_LOOKAHEAD_DAYS = 3650;

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutesToTime(totalMinutes: number): string {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = Math.floor(minutes % 60)
    .toString()
    .padStart(2, '0');
  return `${h}:${m}`;
}

function durationHours(start: string, end: string): number {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes == null || endMinutes == null) return 0;
  const adjustedEnd = endMinutes <= startMinutes ? endMinutes + 1440 : endMinutes;
  return Math.max(0, adjustedEnd - startMinutes) / 60;
}

function sanitizeTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return parseTimeToMinutes(value) == null ? fallback : value;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeEmployeeCount(employeeCount?: number): number {
  if (employeeCount == null || !Number.isFinite(employeeCount)) return 1;
  const rounded = Math.floor(employeeCount);
  return rounded > 0 ? rounded : 1;
}

function toLocalNoonDate(date: string | Date): Date {
  if (date instanceof Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  }
  const trimmed = date.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDueDateKey(value: string | Date): string {
  if (value instanceof Date) return toDateOnlyString(value);
  const datePart = value.split(/[T ]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  return toDateOnlyString(toLocalNoonDate(value));
}

function cloneDefaultSchedule(): WorkWeekSchedule {
  return {
    0: {
      enabled: false,
      standardStart: '00:00',
      standardEnd: '00:00',
      unpaidBreakMinutes: 0,
      overtimeEnabled: false,
      overtimeStart: '00:00',
      overtimeEnd: '00:00',
    },
    1: {
      enabled: true,
      standardStart: '06:30',
      standardEnd: '16:30',
      unpaidBreakMinutes: 60,
      overtimeEnabled: false,
      overtimeStart: '16:30',
      overtimeEnd: '18:30',
    },
    2: {
      enabled: true,
      standardStart: '06:30',
      standardEnd: '16:30',
      unpaidBreakMinutes: 60,
      overtimeEnabled: false,
      overtimeStart: '16:30',
      overtimeEnd: '18:30',
    },
    3: {
      enabled: true,
      standardStart: '06:30',
      standardEnd: '16:30',
      unpaidBreakMinutes: 60,
      overtimeEnabled: false,
      overtimeStart: '16:30',
      overtimeEnd: '18:30',
    },
    4: {
      enabled: true,
      standardStart: '06:30',
      standardEnd: '16:30',
      unpaidBreakMinutes: 60,
      overtimeEnabled: false,
      overtimeStart: '16:30',
      overtimeEnd: '18:30',
    },
    5: {
      enabled: true,
      standardStart: '07:00',
      standardEnd: '11:00',
      unpaidBreakMinutes: 0,
      overtimeEnabled: false,
      overtimeStart: '11:00',
      overtimeEnd: '13:00',
    },
    6: {
      enabled: false,
      standardStart: '00:00',
      standardEnd: '00:00',
      unpaidBreakMinutes: 0,
      overtimeEnabled: false,
      overtimeStart: '00:00',
      overtimeEnd: '00:00',
    },
  };
}

export const DEFAULT_WORK_WEEK_SCHEDULE: WorkWeekSchedule = cloneDefaultSchedule();

export function normalizeWorkWeekSchedule(
  schedule?:
    | WorkWeekSchedule
    | Partial<Record<number, Partial<WorkDaySchedule> | number>>
    | null
): WorkWeekSchedule {
  const normalized = cloneDefaultSchedule();
  if (!schedule || typeof schedule !== 'object') return normalized;

  const asRecord = schedule as Record<number, unknown>;
  for (const day of DAY_INDICES) {
    const raw = asRecord[day];
    if (raw == null) continue;

    if (typeof raw === 'number') {
      const hours = Math.max(0, raw);
      if (hours <= 0) {
        normalized[day] = { ...normalized[day], enabled: false, unpaidBreakMinutes: 0 };
      } else {
        const endMinutes = parseTimeToMinutes('08:00')! + Math.round(hours * 60);
        normalized[day] = {
          ...normalized[day],
          enabled: true,
          standardStart: '08:00',
          standardEnd: formatMinutesToTime(endMinutes),
          unpaidBreakMinutes: 0,
        };
      }
      continue;
    }

    if (typeof raw !== 'object') continue;
    const value = raw as Partial<WorkDaySchedule>;
    const base = normalized[day];
    normalized[day] = {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : base.enabled,
      standardStart: sanitizeTime(value.standardStart, base.standardStart),
      standardEnd: sanitizeTime(value.standardEnd, base.standardEnd),
      unpaidBreakMinutes: clampNumber(
        value.unpaidBreakMinutes,
        base.unpaidBreakMinutes,
        0,
        720
      ),
      overtimeEnabled:
        typeof value.overtimeEnabled === 'boolean' ? value.overtimeEnabled : base.overtimeEnabled,
      overtimeStart: sanitizeTime(value.overtimeStart, base.overtimeStart),
      overtimeEnd: sanitizeTime(value.overtimeEnd, base.overtimeEnd),
    };
  }
  return normalized;
}

export function getDayScheduleHours(day: WorkDaySchedule): {
  standardWindowHours: number;
  regularHoursPerEmployee: number;
  overtimeHoursPerEmployee: number;
} {
  if (!day.enabled) {
    return { standardWindowHours: 0, regularHoursPerEmployee: 0, overtimeHoursPerEmployee: 0 };
  }
  const standardWindowHours = durationHours(day.standardStart, day.standardEnd);
  const regularHoursPerEmployee = Math.max(0, standardWindowHours - day.unpaidBreakMinutes / 60);
  const overtimeHoursPerEmployee = day.overtimeEnabled
    ? Math.max(0, durationHours(day.overtimeStart, day.overtimeEnd))
    : 0;
  return {
    standardWindowHours,
    regularHoursPerEmployee,
    overtimeHoursPerEmployee,
  };
}

export function getDailyCapacityForDate(
  date: string | Date,
  options: WorkCapacityOptions = {}
): DailyCapacityBreakdown {
  const d = toLocalNoonDate(date);
  const schedule = normalizeWorkWeekSchedule(options.workWeekSchedule);
  const daySchedule = schedule[d.getDay()];
  const perEmployee = getDayScheduleHours(daySchedule);
  const employeeCount = normalizeEmployeeCount(options.employeeCount);
  const regularCapacityHours = perEmployee.regularHoursPerEmployee * employeeCount;
  const overtimeCapacityHours = perEmployee.overtimeHoursPerEmployee * employeeCount;
  const totalCapacityHours =
    regularCapacityHours + (options.includeOvertime ? overtimeCapacityHours : 0);
  return {
    date: toDateOnlyString(d),
    regularCapacityHours,
    overtimeCapacityHours,
    totalCapacityHours,
    regularHoursPerEmployee: perEmployee.regularHoursPerEmployee,
    overtimeHoursPerEmployee: perEmployee.overtimeHoursPerEmployee,
  };
}

export function getBaseWorkHoursForDate(
  date: string | Date,
  schedule?:
    | WorkWeekSchedule
    | Partial<Record<number, Partial<WorkDaySchedule> | number>>
    | null
): number {
  const d = toLocalNoonDate(date);
  const normalized = normalizeWorkWeekSchedule(schedule);
  return getDayScheduleHours(normalized[d.getDay()]).regularHoursPerEmployee;
}

export function getWorkHoursForDate(date: string | Date, options: WorkCapacityOptions = {}): number {
  return getDailyCapacityForDate(date, options).totalCapacityHours;
}

export function getWeeklyWorkHours(
  schedule?:
    | WorkWeekSchedule
    | Partial<Record<number, Partial<WorkDaySchedule> | number>>
    | null,
  options: { includeOvertime?: boolean } = {}
): number {
  const normalized = normalizeWorkWeekSchedule(schedule);
  return DAY_INDICES.reduce((sum, day) => {
    const dayHours = getDayScheduleHours(normalized[day]);
    return (
      sum +
      dayHours.regularHoursPerEmployee +
      (options.includeOvertime ? dayHours.overtimeHoursPerEmployee : 0)
    );
  }, 0);
}

export function getWeeklyCapacityHours(
  employeeCount?: number,
  schedule?:
    | WorkWeekSchedule
    | Partial<Record<number, Partial<WorkDaySchedule> | number>>
    | null,
  options: { includeOvertime?: boolean } = {}
): number {
  return getWeeklyWorkHours(schedule, options) * normalizeEmployeeCount(employeeCount);
}

export function buildWorkAllocationFromDueDate(
  dueDate: string | Date,
  laborHours: number,
  options: WorkCapacityOptions = {}
): DailyWorkAllocation[] {
  if (!Number.isFinite(laborHours) || laborHours <= 0) return [];

  const due = toLocalNoonDate(dueDate);
  const allowOvertime = options.includeOvertime === true;
  let remainingHours = laborHours;
  const currentDate = new Date(due);
  const allocations: DailyWorkAllocation[] = [];
  let lookedBack = 0;

  while (remainingHours > 0 && lookedBack < MAX_ALLOCATION_LOOKBACK_DAYS) {
    const capacity = getDailyCapacityForDate(currentDate, options);
    const overtimeCapacityHours = allowOvertime ? capacity.overtimeCapacityHours : 0;
    const capacityHours = capacity.regularCapacityHours + overtimeCapacityHours;
    if (capacityHours > 0) {
      const regularHours = Math.min(remainingHours, capacity.regularCapacityHours);
      remainingHours -= regularHours;

      const overtimeHours =
        allowOvertime && remainingHours > 0
          ? Math.min(remainingHours, overtimeCapacityHours)
          : 0;
      remainingHours -= overtimeHours;

      const scheduledHours = regularHours + overtimeHours;
      if (scheduledHours > 0) {
        allocations.push({
          date: capacity.date,
          scheduledHours,
          regularHours,
          overtimeHours,
          regularCapacityHours: capacity.regularCapacityHours,
          overtimeCapacityHours,
          capacityHours,
        });
      }
    }
    currentDate.setDate(currentDate.getDate() - 1);
    lookedBack += 1;
  }

  return allocations.reverse();
}

export function getStartDateFromDueDateAndHours(
  dueDate: string | Date,
  laborHours: number,
  options: WorkCapacityOptions = {}
): string {
  const due = toLocalNoonDate(dueDate);
  if (!Number.isFinite(laborHours) || laborHours <= 0) return toDateOnlyString(due);
  const allocations = buildWorkAllocationFromDueDate(due, laborHours, options);
  return allocations[0]?.date ?? toDateOnlyString(due);
}

export function isWorkDay(date: string | Date, options: WorkCapacityOptions = {}): boolean {
  return getWorkHoursForDate(date, options) > 0;
}

export function buildCapacityAwareBackwardSchedules(
  inputs: CapacityScheduleInput[],
  options: WorkCapacityOptions = {}
): CapacityAwareScheduleOutput {
  const allowOvertime = options.includeOvertime === true;
  const usageMap = new Map<string, DayUsageEntry>();
  const results: CapacityScheduleResult[] = [];

  const ordered = inputs
    .filter((input) => Number.isFinite(input.requiredHours) && input.requiredHours > 0)
    .map((input) => ({
      ...input,
      dueDateKey: normalizeDueDateKey(input.dueDate),
    }))
    .sort((a, b) => {
      if (a.dueDateKey !== b.dueDateKey) return a.dueDateKey.localeCompare(b.dueDateKey);
      if (!!a.isRush !== !!b.isRush) return a.isRush ? -1 : 1;
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      return pa - pb;
    });

  for (const item of ordered) {
    let remainingHours = item.requiredHours;
    const currentDate = toLocalNoonDate(item.dueDateKey);
    const allocationsBackward: DailyWorkAllocation[] = [];
    let lookedBack = 0;

    while (remainingHours > 0 && lookedBack < MAX_ALLOCATION_LOOKBACK_DAYS) {
      const dateKey = toDateOnlyString(currentDate);
      const capacity = getDailyCapacityForDate(currentDate, options);
      const overtimeCapacityHours = allowOvertime ? capacity.overtimeCapacityHours : 0;
      const capacityHours = capacity.regularCapacityHours + overtimeCapacityHours;

      if (capacityHours > 0) {
        const usage = usageMap.get(dateKey) ?? { regularHours: 0, overtimeHours: 0, totalHours: 0 };

        const availableRegular = Math.max(0, capacity.regularCapacityHours - usage.regularHours);
        const regularHours = Math.min(remainingHours, availableRegular);
        remainingHours -= regularHours;

        const availableOvertime = Math.max(0, overtimeCapacityHours - usage.overtimeHours);
        const overtimeHours =
          allowOvertime && remainingHours > 0 ? Math.min(remainingHours, availableOvertime) : 0;
        remainingHours -= overtimeHours;

        const scheduledHours = regularHours + overtimeHours;
        if (scheduledHours > 0) {
          usage.regularHours += regularHours;
          usage.overtimeHours += overtimeHours;
          usage.totalHours = usage.regularHours + usage.overtimeHours;
          usageMap.set(dateKey, usage);

          allocationsBackward.push({
            date: dateKey,
            scheduledHours,
            regularHours,
            overtimeHours,
            regularCapacityHours: capacity.regularCapacityHours,
            overtimeCapacityHours,
            capacityHours,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() - 1);
      lookedBack += 1;
    }

    const allocations = allocationsBackward.reverse();
    const scheduledHours = Math.max(0, item.requiredHours - remainingHours);
    const overtimeHours = allocations.reduce((sum, allocation) => sum + allocation.overtimeHours, 0);

    results.push({
      id: item.id,
      dueDate: item.dueDateKey,
      startDate: allocations[0]?.date ?? item.dueDateKey,
      requiredHours: item.requiredHours,
      scheduledHours,
      overtimeHours,
      unscheduledHours: Math.max(0, remainingHours),
      allocations,
    });
  }

  const dayUsage = Object.fromEntries(usageMap.entries());
  return { results, dayUsage };
}

export function planForwardFromDate(
  requiredHours: number,
  startDate: string | Date,
  options: WorkCapacityOptions = {},
  existingDayUsage: Record<string, Partial<DayUsageEntry>> = {},
  endDate?: string | Date
): ForwardPlanResult {
  if (!Number.isFinite(requiredHours) || requiredHours <= 0) {
    return {
      completionDate: normalizeDueDateKey(startDate),
      allocations: [],
      remainingHours: 0,
      overtimeHours: 0,
    };
  }

  const allowOvertime = options.includeOvertime === true;
  const usageMap = new Map<string, DayUsageEntry>(
    Object.entries(existingDayUsage).map(([date, usage]) => [
      date,
      {
        regularHours: Number(usage.regularHours) || 0,
        overtimeHours: Number(usage.overtimeHours) || 0,
        totalHours:
          Number(usage.totalHours) ||
          (Number(usage.regularHours) || 0) + (Number(usage.overtimeHours) || 0),
      },
    ])
  );

  let remainingHours = requiredHours;
  const currentDate = toLocalNoonDate(startDate);
  const finalDate = endDate ? toLocalNoonDate(endDate) : null;
  const allocations: DailyWorkAllocation[] = [];
  let lookedAhead = 0;

  while (remainingHours > 0 && lookedAhead < MAX_ALLOCATION_LOOKAHEAD_DAYS) {
    if (finalDate && currentDate > finalDate) break;

    const dateKey = toDateOnlyString(currentDate);
    const capacity = getDailyCapacityForDate(currentDate, options);
    const overtimeCapacityHours = allowOvertime ? capacity.overtimeCapacityHours : 0;
    const capacityHours = capacity.regularCapacityHours + overtimeCapacityHours;

    if (capacityHours > 0) {
      const usage = usageMap.get(dateKey) ?? { regularHours: 0, overtimeHours: 0, totalHours: 0 };
      const availableRegular = Math.max(0, capacity.regularCapacityHours - usage.regularHours);
      const regularHours = Math.min(remainingHours, availableRegular);
      remainingHours -= regularHours;

      const availableOvertime = Math.max(0, overtimeCapacityHours - usage.overtimeHours);
      const overtimeHours =
        allowOvertime && remainingHours > 0 ? Math.min(remainingHours, availableOvertime) : 0;
      remainingHours -= overtimeHours;

      const scheduledHours = regularHours + overtimeHours;
      if (scheduledHours > 0) {
        usage.regularHours += regularHours;
        usage.overtimeHours += overtimeHours;
        usage.totalHours = usage.regularHours + usage.overtimeHours;
        usageMap.set(dateKey, usage);

        allocations.push({
          date: dateKey,
          scheduledHours,
          regularHours,
          overtimeHours,
          regularCapacityHours: capacity.regularCapacityHours,
          overtimeCapacityHours,
          capacityHours,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
    lookedAhead += 1;
  }

  return {
    completionDate: remainingHours <= 0 ? allocations[allocations.length - 1]?.date ?? null : null,
    allocations,
    remainingHours: Math.max(0, remainingHours),
    overtimeHours: allocations.reduce((sum, allocation) => sum + allocation.overtimeHours, 0),
  };
}
