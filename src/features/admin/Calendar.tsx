import React, { useMemo, useState } from 'react';
import { Job, ViewState, User, Shift } from '@/core/types';
import {
  buildWorkAllocationFromDueDate,
  getStartDateFromDueDateAndHours,
  getWeeklyCapacityHours,
  getWeeklyWorkHours,
  getWorkHoursForDate,
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
  allocations: Array<{ date: string; scheduledHours: number; capacityHours: number }>;
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
 * Uses due date and expected labor hours (or recorded shift hours) to calculate timelines.
 * Capacity comes from Admin Settings: employee count + work-week schedule.
 */
const Calendar: React.FC<CalendarProps> = ({
  jobs: allJobs,
  shifts,
  currentUser: _currentUser,
  onNavigate,
  onBack,
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { settings } = useSettings();
  const jobs = useMemo(() => allJobs.filter((j) => j.status !== 'paid'), [allJobs]);
  const scheduleOptions = useMemo(
    () => ({
      employeeCount: settings.employeeCount,
      workWeekSchedule: settings.workWeekSchedule,
    }),
    [settings.employeeCount, settings.workWeekSchedule]
  );
  const weeklyHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(settings.workWeekSchedule),
    [settings.workWeekSchedule]
  );
  const weeklyCapacityHours = useMemo(
    () => getWeeklyCapacityHours(settings.employeeCount, settings.workWeekSchedule),
    [settings.employeeCount, settings.workWeekSchedule]
  );

  // Get jobs with timelines
  const jobTimelines = useMemo((): JobTimeline[] => {
    return jobs
      .filter((job) => job.dueDate && job.active)
      .map((job) => {
        // Use laborHours if set, otherwise calculate from shifts
        const hours = job.laborHours || calculateJobHoursFromShifts(job.id, shifts);
        const allocations = buildWorkAllocationFromDueDate(job.dueDate!, hours, scheduleOptions);
        const startDate = getStartDateFromDueDateAndHours(job.dueDate!, hours, scheduleOptions);
        return {
          job,
          startDate,
          endDate: normalizeDateKey(job.dueDate!),
          hours,
          allocations,
        };
      })
      .filter((tl) => tl.hours > 0)
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [jobs, shifts, scheduleOptions]);

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
    const loadByDate = new Map<string, { scheduledHours: number; capacityHours: number }>();
    for (const timeline of jobTimelines) {
      for (const allocation of timeline.allocations) {
        const existing = loadByDate.get(allocation.date) ?? {
          scheduledHours: 0,
          capacityHours: allocation.capacityHours,
        };
        loadByDate.set(allocation.date, {
          scheduledHours: existing.scheduledHours + allocation.scheduledHours,
          capacityHours: allocation.capacityHours,
        });
      }
    }
    return loadByDate;
  }, [jobTimelines]);

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
            {weeklyHoursPerEmployee.toFixed(1)}h per employee/week
          </p>
          <p className="mt-1 font-medium text-primary">
            Weekly scheduling capacity: {weeklyCapacityHours.toFixed(1)}h
          </p>
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
            const workHours = getWorkHoursForDate(dayData.date, scheduleOptions);
            const dayLoad = dayLoadMap.get(dateKey);
            const scheduledHours = dayLoad?.scheduledHours ?? 0;
            const overCapacity = workHours > 0 && scheduledHours > workHours + 0.01;

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
                  {workHours > 0 && (
                    <span className="ml-1 text-[10px] text-slate-500">({workHours}h)</span>
                  )}
                </div>
                {workHours > 0 && (
                  <div
                    className={`mt-0.5 text-[10px] ${overCapacity ? 'font-bold text-red-400' : 'text-slate-500'}`}
                  >
                    {scheduledHours.toFixed(1)}/{workHours.toFixed(1)}h
                  </div>
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
