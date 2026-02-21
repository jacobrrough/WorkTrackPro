import React, { useMemo, useState } from 'react';
import { Job, ViewState, User, Shift } from '@/core/types';
import {
  buildCapacityAwareBackwardSchedules,
  getDailyCapacityForDate,
  getWeeklyCapacityHours,
  getWeeklyWorkHours,
  planForwardFromDate,
} from '@/lib/workHours';
import { calculateJobHoursFromShifts } from '@/lib/laborSuggestion';
import { formatDateOnly } from '@/core/date';
import { getJobDisplayName } from '@/lib/formatJob';
import { useSettings } from '@/contexts/SettingsContext';

interface CalendarProps {
  jobs: Job[];
  shifts: Shift[];
  currentUser: User;
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
}

interface JobTimeline {
  job: Job;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
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
}

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeDateKey = (value: string) => {
  const datePart = value.split(/[T ]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return datePart;
  return toDateKey(parsed);
};

/**
 * Calendar - Admin-only view showing job timelines on a month calendar.
 * Uses due date + labor hours + employee schedule to create a capacity-aware timeline.
 * Includes what-if planning for soonest completion and due-date overtime requirements.
 */
const Calendar: React.FC<CalendarProps> = ({
  jobs: allJobs,
  shifts,
  currentUser: _currentUser,
  onNavigate,
  onBack,
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [includeOvertimeInSchedule, setIncludeOvertimeInSchedule] = useState(false);
  const [plannerHours, setPlannerHours] = useState('5');
  const [plannerDueDate, setPlannerDueDate] = useState('');
  const [plannerUseOvertime, setPlannerUseOvertime] = useState(true);
  const { settings } = useSettings();
  const jobs = useMemo(
    () =>
      allJobs.filter(
        (j) =>
          j.status !== 'paid' &&
          j.status !== 'projectCompleted' &&
          j.status !== 'delivered' &&
          j.active
      ),
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

  const scheduleInputs = useMemo(
    () =>
      jobs
      .filter((job) => job.dueDate && job.active)
      .map((job) => {
        const fallbackHours = calculateJobHoursFromShifts(job.id, shifts);
        const requiredHours = job.laborHours && job.laborHours > 0 ? job.laborHours : fallbackHours;
        return {
          id: job.id,
          dueDate: job.dueDate!,
          requiredHours,
          isRush: job.isRush,
        };
      })
      .filter((job) => job.requiredHours > 0),
    [jobs, shifts]
  );

  const capacityAwareSchedule = useMemo(
    () =>
      buildCapacityAwareBackwardSchedules(scheduleInputs, {
        ...baseScheduleOptions,
        includeOvertime: includeOvertimeInSchedule,
      }),
    [scheduleInputs, baseScheduleOptions, includeOvertimeInSchedule]
  );

  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  const jobTimelines = useMemo((): JobTimeline[] => {
    return capacityAwareSchedule.results
      .map((result) => {
        const job = jobsById.get(result.id);
        if (!job) return null;
        return {
          job,
          startDate: result.startDate,
          endDate: normalizeDateKey(result.dueDate),
          hours: result.requiredHours,
          overtimeHours: result.overtimeHours,
          unscheduledHours: result.unscheduledHours,
          allocations: result.allocations,
        } as JobTimeline;
      })
      .filter((timeline): timeline is JobTimeline => timeline != null)
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [capacityAwareSchedule.results, jobsById]);

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

  // Get jobs for a specific date
  const getJobsForDate = (date: Date): JobTimeline[] => {
    const dateKey = toDateKey(date);
    return jobTimelines.filter((tl) => {
      const hasAllocation = tl.allocations.some((allocation) => allocation.date === dateKey);
      return hasAllocation || tl.endDate === dateKey;
    });
  };

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
  }, [
    capacityAwareSchedule.dayUsage,
    baseScheduleOptions,
    includeOvertimeInSchedule,
  ]);

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
      'bg-red-500',
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

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const changeMonth = (delta: number) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
  };

  const plannerRequiredHours = useMemo(() => {
    const parsed = parseFloat(plannerHours);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [plannerHours]);

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const earliestPlan = useMemo(() => {
    if (plannerRequiredHours <= 0) return null;
    return planForwardFromDate(
      plannerRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: plannerUseOvertime,
      },
      capacityAwareSchedule.dayUsage
    );
  }, [plannerRequiredHours, todayKey, baseScheduleOptions, plannerUseOvertime, capacityAwareSchedule.dayUsage]);

  const duePlanWithoutOvertime = useMemo(() => {
    if (plannerRequiredHours <= 0 || !plannerDueDate) return null;
    return planForwardFromDate(
      plannerRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: false,
      },
      capacityAwareSchedule.dayUsage,
      plannerDueDate
    );
  }, [plannerRequiredHours, plannerDueDate, todayKey, baseScheduleOptions, capacityAwareSchedule.dayUsage]);

  const duePlanWithOvertime = useMemo(() => {
    if (plannerRequiredHours <= 0 || !plannerDueDate) return null;
    return planForwardFromDate(
      plannerRequiredHours,
      todayKey,
      {
        ...baseScheduleOptions,
        includeOvertime: true,
      },
      capacityAwareSchedule.dayUsage,
      plannerDueDate
    );
  }, [plannerRequiredHours, plannerDueDate, todayKey, baseScheduleOptions, capacityAwareSchedule.dayUsage]);

  const overtimeNeededForDue = useMemo(() => {
    if (!duePlanWithoutOvertime) return 0;
    return Math.max(0, duePlanWithoutOvertime.remainingHours);
  }, [duePlanWithoutOvertime]);

  const overtimePremiumCost = useMemo(
    () =>
      overtimeNeededForDue *
      settings.laborRate *
      Math.max(0, settings.overtimeMultiplier - 1),
    [overtimeNeededForDue, settings.laborRate, settings.overtimeMultiplier]
  );

  return (
    <div className="flex h-full flex-col bg-background-dark">
      {/* Header */}
      <div className="border-b border-white/10 bg-background-light px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="flex size-10 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Back"
              >
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-white">Calendar</h1>
              <p className="text-xs text-slate-400">Job timelines and scheduling</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIncludeOvertimeInSchedule((v) => !v)}
              className={`rounded-sm px-3 py-2 text-xs font-semibold transition-colors ${
                includeOvertimeInSchedule
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {includeOvertimeInSchedule ? 'Using OT Capacity' : 'Regular Capacity Only'}
            </button>
            <button
              onClick={() => changeMonth(-1)}
              className="flex size-10 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Previous month"
            >
              <span className="material-symbols-outlined text-xl">chevron_left</span>
            </button>
            <h2 className="min-w-[180px] text-center font-bold text-white">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h2>
            <button
              onClick={() => changeMonth(1)}
              className="flex size-10 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Next month"
            >
              <span className="material-symbols-outlined text-xl">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 rounded-sm border border-primary/30 bg-primary/10 p-3 text-xs text-slate-300">
          <p>
            {settings.employeeCount} employee{settings.employeeCount !== 1 ? 's' : ''} ·{' '}
            {weeklyRegularHoursPerEmployee.toFixed(1)}h regular/employee/week
          </p>
          <p className="mt-1 text-slate-300">
            Overtime possible/employee/week: {weeklyOvertimeHoursPerEmployee.toFixed(1)}h
          </p>
          <p className="mt-1 font-medium text-primary">
            Weekly regular capacity: {weeklyCapacityHours.toFixed(1)}h
          </p>
          <p className="mt-1 text-amber-300">
            Weekly max capacity with overtime: {weeklyCapacityWithOvertime.toFixed(1)}h
          </p>
        </div>

        <div className="mb-4 rounded-sm border border-white/10 bg-white/5 p-3">
          <h3 className="mb-3 text-sm font-bold text-white">What-if Planner</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-400">
              New job labor hours
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={plannerHours}
                onChange={(e) => setPlannerHours(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Due date (optional)
              <input
                type="date"
                value={plannerDueDate}
                onChange={(e) => setPlannerDueDate(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-2 text-sm text-white focus:border-primary/50 focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Soonest-date uses overtime
              <button
                type="button"
                onClick={() => setPlannerUseOvertime((v) => !v)}
                className={`mt-1 flex h-[42px] w-full items-center justify-center rounded border px-2 text-sm font-medium transition-colors ${
                  plannerUseOvertime
                    ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                    : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                {plannerUseOvertime ? 'Yes (OT allowed)' : 'No (regular hours only)'}
              </button>
            </label>
          </div>
          {plannerRequiredHours > 0 && earliestPlan && (
            <div className="mt-3 rounded border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
              <p>
                Soonest completion:{' '}
                <span className="font-semibold text-white">
                  {earliestPlan.completionDate ? formatDateOnly(earliestPlan.completionDate) : 'No capacity found'}
                </span>
              </p>
              <p className="mt-1">
                Scheduled hours: {plannerRequiredHours.toFixed(1)}h
                {earliestPlan.overtimeHours > 0 && (
                  <>
                    {' '}
                    (
                    <span className="font-semibold text-amber-300">
                      {earliestPlan.overtimeHours.toFixed(1)}h overtime
                    </span>
                    )
                  </>
                )}
              </p>
            </div>
          )}

          {plannerRequiredHours > 0 && plannerDueDate && duePlanWithoutOvertime && duePlanWithOvertime && (
            <div className="mt-3 rounded border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
              <p>
                Due-date check ({formatDateOnly(plannerDueDate)}):{' '}
                {duePlanWithoutOvertime.remainingHours <= 0 ? (
                  <span className="font-semibold text-green-400">Fits with regular hours</span>
                ) : (
                  <span className="font-semibold text-amber-300">
                    Needs {overtimeNeededForDue.toFixed(1)}h overtime
                  </span>
                )}
              </p>
              <p className="mt-1">
                Additional OT labor premium @ {settings.overtimeMultiplier.toFixed(2)}x:{' '}
                <span className="font-semibold text-amber-300">
                  ${overtimePremiumCost.toFixed(2)}
                </span>
              </p>
              <p className="mt-1">
                Total labor with required overtime:{' '}
                <span className="font-semibold text-white">
                  $
                  {(
                    plannerRequiredHours * settings.laborRate +
                    overtimePremiumCost
                  ).toFixed(2)}
                </span>
              </p>
              {duePlanWithOvertime.remainingHours > 0 && (
                <p className="mt-1 font-semibold text-red-400">
                  Even with configured overtime, short by {duePlanWithOvertime.remainingHours.toFixed(1)}h.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {/* Week day headers */}
          {weekDays.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-bold text-slate-400">
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {calendarDays.map((dayData, idx) => {
            const jobsForDay = getJobsForDate(dayData.date);
            const isToday = dayData.date.toDateString() === new Date().toDateString();
            const dateKey = toDateKey(dayData.date);
            const dayLoad = dayLoadMap.get(dateKey);
            const dayCapacity = getDailyCapacityForDate(dayData.date, {
              ...baseScheduleOptions,
              includeOvertime: includeOvertimeInSchedule,
            });
            const overtimeCapacity = includeOvertimeInSchedule ? dayCapacity.overtimeCapacityHours : 0;
            const totalCapacity = dayCapacity.regularCapacityHours + overtimeCapacity;
            const scheduledHours = dayLoad?.scheduledHours ?? 0;
            const overtimeHours = dayLoad?.overtimeHours ?? 0;
            const overCapacity = totalCapacity > 0 && scheduledHours > totalCapacity + 0.01;

            return (
              <div
                key={idx}
                className={`min-h-[80px] rounded border p-1 ${
                  dayData.isCurrentMonth
                    ? 'border-white/10 bg-white/5'
                    : 'bg-white/2 border-white/5'
                } ${isToday ? 'ring-2 ring-primary' : ''}`}
              >
                <div
                  className={`text-xs font-medium ${
                    dayData.isCurrentMonth ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  {dayData.date.getDate()}
                  {totalCapacity > 0 && (
                    <span className="ml-1 text-[10px] text-slate-500">({totalCapacity.toFixed(1)}h)</span>
                  )}
                </div>
                {totalCapacity > 0 && (
                  <div
                    className={`mt-0.5 text-[10px] ${overCapacity ? 'font-bold text-red-400' : 'text-slate-500'}`}
                  >
                    {scheduledHours.toFixed(1)}/{totalCapacity.toFixed(1)}h
                  </div>
                )}
                {overtimeHours > 0 && (
                  <div className="text-[10px] font-medium text-amber-300">OT {overtimeHours.toFixed(1)}h</div>
                )}
                <div className="mt-1 space-y-0.5">
                  {jobsForDay.slice(0, 3).map((tl) => (
                    <button
                      key={tl.job.id}
                      onClick={() => onNavigate('job-detail', tl.job.id)}
                      className={`w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium text-white transition-colors hover:opacity-80 ${getJobColor(tl.job.id)}`}
                      title={`#${tl.job.jobCode} - ${getJobDisplayName(tl.job)}`}
                    >
                      {tl.job.isRush && '⚡ '}#{tl.job.jobCode}
                    </button>
                  ))}
                  {jobsForDay.length > 3 && (
                    <div className="text-[10px] text-slate-500">+{jobsForDay.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary: Upcoming jobs */}
        <div className="mt-4 rounded-sm border border-white/10 bg-white/5 p-3">
          <h3 className="mb-3 text-lg font-bold text-white">Upcoming Jobs</h3>
          {jobTimelines.length === 0 ? (
            <p className="text-sm text-slate-400">No jobs with due dates</p>
          ) : (
            <div className="space-y-2">
              {jobTimelines.slice(0, 10).map((tl) => (
                <button
                  key={tl.job.id}
                  onClick={() => onNavigate('job-detail', tl.job.id)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">#{tl.job.jobCode}</span>
                        <span className="text-sm text-slate-300">{getJobDisplayName(tl.job)}</span>
                        {tl.job.isRush && <span className="text-yellow-400">⚡</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                        <span>Start: {formatDateOnly(tl.startDate)}</span>
                        <span>Due: {formatDateOnly(tl.endDate)}</span>
                        <span>{tl.hours.toFixed(1)}h</span>
                        {tl.overtimeHours > 0 && (
                          <span className="text-amber-300">OT {tl.overtimeHours.toFixed(1)}h</span>
                        )}
                        {tl.unscheduledHours > 0 && (
                          <span className="text-red-400">
                            Short {tl.unscheduledHours.toFixed(1)}h
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="material-symbols-outlined text-slate-400">chevron_right</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Calendar;
