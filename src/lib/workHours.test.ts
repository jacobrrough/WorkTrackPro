import { describe, expect, it } from 'vitest';
import {
  buildWorkAllocationFromDueDate,
  getStartDateFromDueDateAndHours,
  getWeeklyCapacityHours,
  normalizeWorkWeekSchedule,
} from './workHours';

describe('workHours scheduling', () => {
  it('normalizes partial work-week schedules', () => {
    const schedule = normalizeWorkWeekSchedule({ 1: 8, 2: 8, 5: 4 });
    expect(schedule[1]).toBe(8);
    expect(schedule[2]).toBe(8);
    expect(schedule[5]).toBe(4);
    expect(schedule[0]).toBe(0);
    expect(schedule[6]).toBe(0);
  });

  it('calculates weekly capacity from employees and schedule', () => {
    expect(getWeeklyCapacityHours(5)).toBe(200); // 40h schedule × 5 employees
  });

  it('works backward from due date using employee capacity', () => {
    const scheduleAllDays = { 0: 8, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 };
    const dueDate = '2026-02-21';

    const startDate = getStartDateFromDueDateAndHours(dueDate, 80, {
      employeeCount: 5,
      workWeekSchedule: scheduleAllDays,
    });
    expect(startDate).toBe('2026-02-20'); // 80h at 40h/day => due day + previous day

    const allocations = buildWorkAllocationFromDueDate(dueDate, 80, {
      employeeCount: 5,
      workWeekSchedule: scheduleAllDays,
    });
    expect(allocations).toEqual([
      { date: '2026-02-20', scheduledHours: 40, capacityHours: 40 },
      { date: '2026-02-21', scheduledHours: 40, capacityHours: 40 },
    ]);
  });
});
