import { describe, expect, it } from 'vitest';
import {
  buildCapacityAwareBackwardSchedules,
  buildWorkAllocationFromDueDate,
  getStartDateFromDueDateAndHours,
  getWeeklyCapacityHours,
  planForwardFromDate,
  normalizeWorkWeekSchedule,
} from './workHours';

describe('workHours scheduling', () => {
  it('normalizes partial work-week schedules', () => {
    const schedule = normalizeWorkWeekSchedule({ 1: 8, 2: 8, 5: 4 });
    expect(schedule[1].enabled).toBe(true);
    expect(schedule[1].standardStart).toBe('08:00');
    expect(schedule[1].standardEnd).toBe('16:00');
    expect(schedule[1].unpaidBreakMinutes).toBe(0);
    expect(schedule[5].standardEnd).toBe('12:00');
    expect(schedule[0].enabled).toBe(false);
    expect(schedule[6].enabled).toBe(false);
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
    expect(allocations).toHaveLength(2);
    expect(allocations[0]).toMatchObject({
      date: '2026-02-20',
      scheduledHours: 40,
      capacityHours: 40,
      regularHours: 40,
      overtimeHours: 0,
    });
    expect(allocations[1]).toMatchObject({
      date: '2026-02-21',
      scheduledHours: 40,
      capacityHours: 40,
      regularHours: 40,
      overtimeHours: 0,
    });
  });

  it('builds capacity-aware schedules across multiple jobs', () => {
    const scheduleAllDays = { 0: 8, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 };
    const result = buildCapacityAwareBackwardSchedules(
      [
        { id: 'job-a', dueDate: '2026-02-21', requiredHours: 40 },
        { id: 'job-b', dueDate: '2026-02-21', requiredHours: 40 },
      ],
      { employeeCount: 5, workWeekSchedule: scheduleAllDays }
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0].startDate).toBe('2026-02-21');
    expect(result.results[1].startDate).toBe('2026-02-20');
    expect(result.dayUsage['2026-02-21'].totalHours).toBe(40);
    expect(result.dayUsage['2026-02-20'].totalHours).toBe(40);
  });

  it('plans forward from today considering existing usage', () => {
    const scheduleAllDays = { 0: 8, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 8 };
    const plan = planForwardFromDate(
      20,
      '2026-02-21',
      { employeeCount: 5, workWeekSchedule: scheduleAllDays },
      {
        '2026-02-21': { regularHours: 40, overtimeHours: 0, totalHours: 40 },
      }
    );
    expect(plan.completionDate).toBe('2026-02-22');
    expect(plan.remainingHours).toBe(0);
    expect(plan.allocations[0]).toMatchObject({
      date: '2026-02-22',
      scheduledHours: 20,
    });
  });
});
