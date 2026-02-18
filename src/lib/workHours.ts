/**
 * Work schedule and calendar calculations.
 * Work week: 9 hours Monday–Thursday, 4 hours Friday.
 */

export const WORK_HOURS_PER_DAY: Record<number, number> = {
  0: 0, // Sunday
  1: 9, // Monday
  2: 9, // Tuesday
  3: 9, // Wednesday
  4: 9, // Thursday
  5: 4, // Friday
  6: 0, // Saturday
};

/**
 * Calculate the start date for a job given its due date and expected labor hours.
 * Works backward from the due date, accounting for the work schedule (9h Mon-Thu, 4h Fri).
 * @param dueDate ISO date string (YYYY-MM-DD) or Date object
 * @param laborHours Expected labor hours for the job
 * @returns Start date as ISO string (YYYY-MM-DD)
 */
export function getStartDateFromDueDateAndHours(
  dueDate: string | Date,
  laborHours: number
): string {
  if (laborHours <= 0) {
    const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
    return due.toISOString().split('T')[0];
  }

  const due = typeof dueDate === 'string' ? new Date(dueDate + 'T12:00:00') : dueDate;
  let remainingHours = laborHours;
  const currentDate = new Date(due);

  // Work backward from due date
  while (remainingHours > 0) {
    const dayOfWeek = currentDate.getDay();
    const hoursToday = WORK_HOURS_PER_DAY[dayOfWeek];

    if (hoursToday > 0) {
      if (remainingHours <= hoursToday) {
        // This day has enough hours; we're done
        break;
      }
      remainingHours -= hoursToday;
    }

    // Move to previous day
    currentDate.setDate(currentDate.getDate() - 1);
  }

  return currentDate.toISOString().split('T')[0];
}

/**
 * Get work hours for a specific date.
 * @param date Date object or ISO string
 * @returns Hours available on that day
 */
export function getWorkHoursForDate(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return WORK_HOURS_PER_DAY[d.getDay()] || 0;
}

/**
 * Check if a date is a work day (has hours > 0).
 */
export function isWorkDay(date: string | Date): boolean {
  return getWorkHoursForDate(date) > 0;
}
