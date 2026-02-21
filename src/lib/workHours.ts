/**
 * Work schedule and capacity calculations.
 * Default schedule: 9h Monday-Thursday, 4h Friday.
 */
export type WorkWeekSchedule = Record<number, number>;

export interface WorkCapacityOptions {
  employeeCount?: number;
  workWeekSchedule?: Partial<Record<number, number>> | null;
}

export interface DailyWorkAllocation {
  date: string; // YYYY-MM-DD
  scheduledHours: number;
  capacityHours: number;
}

export const DEFAULT_WORK_WEEK_SCHEDULE: WorkWeekSchedule = {
  0: 0, // Sunday
  1: 9, // Monday
  2: 9, // Tuesday
  3: 9, // Wednesday
  4: 9, // Thursday
  5: 4, // Friday
  6: 0, // Saturday
};

const MAX_ALLOCATION_LOOKBACK_DAYS = 3650;

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
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeEmployeeCount(employeeCount?: number): number {
  if (employeeCount == null || !Number.isFinite(employeeCount)) return 1;
  const rounded = Math.floor(employeeCount);
  return rounded > 0 ? rounded : 1;
}

export function normalizeWorkWeekSchedule(
  schedule?: Partial<Record<number, number>> | null
): WorkWeekSchedule {
  const normalized: WorkWeekSchedule = { ...DEFAULT_WORK_WEEK_SCHEDULE };
  if (!schedule || typeof schedule !== 'object') return normalized;

  for (let day = 0; day <= 6; day += 1) {
    const raw = schedule[day];
    if (raw == null) continue;
    const hours = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (Number.isFinite(hours) && hours >= 0) {
      normalized[day] = hours;
    }
  }
  return normalized;
}

export function getWeeklyWorkHours(schedule?: Partial<Record<number, number>> | null): number {
  const normalized = normalizeWorkWeekSchedule(schedule);
  return Object.values(normalized).reduce((sum, hours) => sum + hours, 0);
}

export function getWeeklyCapacityHours(
  employeeCount?: number,
  schedule?: Partial<Record<number, number>> | null
): number {
  return getWeeklyWorkHours(schedule) * normalizeEmployeeCount(employeeCount);
}

/**
 * Get base work hours for a specific date (per employee, no employee multiplier).
 */
export function getBaseWorkHoursForDate(
  date: string | Date,
  schedule?: Partial<Record<number, number>> | null
): number {
  const d = toLocalNoonDate(date);
  const normalized = normalizeWorkWeekSchedule(schedule);
  return normalized[d.getDay()] || 0;
}

/**
 * Get available capacity hours for a specific date.
 * Applies employee count multiplier to daily schedule hours.
 */
export function getWorkHoursForDate(date: string | Date, options: WorkCapacityOptions = {}): number {
  const perEmployeeHours = getBaseWorkHoursForDate(date, options.workWeekSchedule);
  return perEmployeeHours * normalizeEmployeeCount(options.employeeCount);
}

/**
 * Build per-day labor allocations from due date backward using available capacity.
 */
export function buildWorkAllocationFromDueDate(
  dueDate: string | Date,
  laborHours: number,
  options: WorkCapacityOptions = {}
): DailyWorkAllocation[] {
  if (!Number.isFinite(laborHours) || laborHours <= 0) return [];

  const due = toLocalNoonDate(dueDate);

  let remainingHours = laborHours;
  const currentDate = new Date(due);
  const allocations: DailyWorkAllocation[] = [];
  let lookedBack = 0;

  while (remainingHours > 0 && lookedBack < MAX_ALLOCATION_LOOKBACK_DAYS) {
    const capacityHours = getWorkHoursForDate(currentDate, options);
    if (capacityHours > 0) {
      const scheduledHours = Math.min(remainingHours, capacityHours);
      allocations.push({
        date: toDateOnlyString(currentDate),
        scheduledHours,
        capacityHours,
      });
      remainingHours -= scheduledHours;
    }
    currentDate.setDate(currentDate.getDate() - 1);
    lookedBack += 1;
  }

  return allocations.reverse();
}

/**
 * Calculate the start date for a job given due date and expected labor hours.
 * Works backward from due date using configured daily capacity.
 */
export function getStartDateFromDueDateAndHours(
  dueDate: string | Date,
  laborHours: number,
  options: WorkCapacityOptions = {}
): string {
  const due = toLocalNoonDate(dueDate);
  if (!Number.isFinite(laborHours) || laborHours <= 0) {
    return toDateOnlyString(due);
  }
  const allocations = buildWorkAllocationFromDueDate(due, laborHours, options);
  return allocations[0]?.date ?? toDateOnlyString(due);
}

/**
 * Check if a date is a work day (has capacity > 0).
 */
export function isWorkDay(date: string | Date, options: WorkCapacityOptions = {}): boolean {
  return getWorkHoursForDate(date, options) > 0;
}
