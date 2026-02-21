// TimeReports.tsx - Enhanced with Edit History
import React, { useMemo, useState } from 'react';
import { Shift, User, Job, ViewState, ShiftEdit } from '@/core/types';
import { useToast } from './Toast';
import { shiftService, shiftEditService } from './pocketbase';
import ConfirmDialog from './ConfirmDialog';
import { durationMs, formatDurationHours } from './lib/timeUtils';

type DateRange = 'today' | 'week' | 'month' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date: Date): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const diffToMonday = (day + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);
  return start;
}

function buildDateRangeWindow(dateRange: DateRange, periodOffset: number): {
  start: Date | null;
  end: Date | null;
  label: string;
} {
  const now = new Date();

  if (dateRange === 'all') {
    return { start: null, end: null, label: 'All time' };
  }

  if (dateRange === 'today') {
    const start = startOfLocalDay(now);
    start.setDate(start.getDate() - periodOffset);
    const end = new Date(start.getTime() + DAY_MS);
    return {
      start,
      end,
      label:
        periodOffset === 0
          ? 'Today'
          : start.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }),
    };
  }

  if (dateRange === 'week') {
    const start = startOfLocalWeek(now);
    start.setDate(start.getDate() - periodOffset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const endDisplay = new Date(end.getTime() - 1);
    return {
      start,
      end,
      label: `${start.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })} - ${endDisplay.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`,
    };
  }

  const start = new Date(now.getFullYear(), now.getMonth() - periodOffset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return {
    start,
    end,
    label: start.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    }),
  };
}

interface TimeReportsProps {
  shifts: Shift[];
  users: User[];
  jobs: Job[];
  onNavigate: (view: ViewState) => void;
  onBack?: () => void;
  currentUser: User;
  onRefreshShifts?: () => Promise<void>;
}

const TimeReports: React.FC<TimeReportsProps> = ({
  shifts,
  users,
  jobs,
  onNavigate: _onNavigate,
  onBack,
  currentUser,
  onRefreshShifts,
}) => {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<'all' | 'mine'>('mine');
  const [dateRange, setDateRange] = useState<DateRange>('week');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [viewMode, setViewMode] = useState<'shifts' | 'users' | 'jobs'>('shifts');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  // Edit shift state
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [editingShiftData, setEditingShiftData] = useState<{
    clockInTime: string;
    clockOutTime: string;
    reason: string;
  }>({ clockInTime: '', clockOutTime: '', reason: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Edit history state
  const [viewingHistoryFor, setViewingHistoryFor] = useState<string | null>(null);
  const [shiftEdits, setShiftEdits] = useState<Record<string, ShiftEdit[]>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Admin: Add shift modal
  const [showAddShift, setShowAddShift] = useState(false);
  const [newShiftData, setNewShiftData] = useState<{
    user: string;
    job: string;
    clockInTime: string;
    clockOutTime: string;
  }>({ user: '', job: '', clockInTime: '', clockOutTime: '' });
  const [addingShift, setAddingShift] = useState(false);

  // Admin: Delete shift confirmation
  const [shiftToDeleteId, setShiftToDeleteId] = useState<string | null>(null);
  const [deletingShift, setDeletingShift] = useState(false);

  /** Format an ISO date string for datetime-local input (local timezone). */
  const toDateTimeLocal = (isoString: string): string => {
    const d = new Date(isoString);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };

  const getJobName = (id: string) => jobs.find((j) => j.id === id)?.name || 'Unknown Job';
  const getJobCode = (id: string) => jobs.find((j) => j.id === id)?.jobCode?.toString() || 'N/A';
  const getJobPO = (id: string) => jobs.find((j) => j.id === id)?.po || null;
  const getUserName = (id: string) => users.find((u) => u.id === id)?.name || 'Unknown User';
  const getUserInitials = (id: string) => {
    const user = users.find((u) => u.id === id);
    return (
      user?.initials ||
      user?.name
        ?.split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase() ||
      '??'
    );
  };

  const getHoursAsNumber = (s: Shift): number =>
    durationMs(s.clockInTime, s.clockOutTime) / 3600000;

  const formatShiftHours = (s: Shift): string =>
    formatDurationHours(durationMs(s.clockInTime, s.clockOutTime));

  const periodWindow = useMemo(
    () => buildDateRangeWindow(dateRange, periodOffset),
    [dateRange, periodOffset]
  );

  const filteredShifts = useMemo(() => {
    let result = shifts;

    if (filter === 'mine') {
      result = result.filter((s) => s.user === currentUser.id);
    } else if (selectedUser) {
      result = result.filter((s) => s.user === selectedUser);
    }

    const rangeStart = periodWindow.start;
    const rangeEnd = periodWindow.end;
    if (rangeStart && rangeEnd) {
      result = result.filter((s) => {
        const shiftStart = new Date(s.clockInTime);
        return shiftStart >= rangeStart && shiftStart < rangeEnd;
      });
    }

    return result.sort(
      (a, b) => new Date(b.clockInTime).getTime() - new Date(a.clockInTime).getTime()
    );
  }, [shifts, filter, periodWindow, currentUser.id, selectedUser]);

  const totalsByJob = useMemo(() => {
    const map: Record<string, number> = {};
    filteredShifts.forEach((s) => {
      const h = getHoursAsNumber(s);
      map[s.job] = (map[s.job] || 0) + h;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredShifts]);

  const totalsByUser = useMemo(() => {
    const map: Record<string, { hours: number; shifts: number; active: boolean }> = {};
    filteredShifts.forEach((s) => {
      const h = getHoursAsNumber(s);
      if (!map[s.user]) {
        map[s.user] = { hours: 0, shifts: 0, active: false };
      }
      map[s.user].hours += h;
      map[s.user].shifts += 1;
      if (!s.clockOutTime) map[s.user].active = true;
    });
    return Object.entries(map).sort((a, b) => b[1].hours - a[1].hours);
  }, [filteredShifts]);

  const totalHours = useMemo(() => {
    return filteredShifts.reduce((sum, s) => sum + getHoursAsNumber(s), 0);
  }, [filteredShifts]);

  const activeShifts = filteredShifts.filter((s) => !s.clockOutTime);
  const completedShifts = filteredShifts.filter((s) => s.clockOutTime);

  const dailyBreakdown = useMemo(() => {
    const days: { date: string; hours: number; shifts: number }[] = [];
    const chartEndBase =
      periodWindow.end !== null ? new Date(periodWindow.end.getTime() - 1) : new Date();
    const chartEndDay = startOfLocalDay(chartEndBase);

    for (let i = 6; i >= 0; i--) {
      const date = new Date(chartEndDay);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayShifts = filteredShifts.filter((s) => {
        const shiftDate = new Date(s.clockInTime).toISOString().split('T')[0];
        return shiftDate === dateStr;
      });

      const hours = dayShifts.reduce((sum, s) => sum + getHoursAsNumber(s), 0);
      days.push({
        date: date.toLocaleDateString('en-US', { weekday: 'short' }),
        hours,
        shifts: dayShifts.length,
      });
    }
    return days;
  }, [filteredShifts, periodWindow.end]);

  const maxDailyHours = Math.max(...dailyBreakdown.map((d) => d.hours), 1);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Load edit history for a shift
  const loadShiftHistory = async (shiftId: string) => {
    if (shiftEdits[shiftId]) {
      setViewingHistoryFor(shiftId);
      return;
    }

    setLoadingHistory(true);
    try {
      const history = await shiftEditService.getByShift(shiftId);
      setShiftEdits((prev) => ({ ...prev, [shiftId]: history }));
      setViewingHistoryFor(shiftId);
    } catch (error) {
      console.error('Failed to load shift history:', error);
      showToast('Failed to load edit history', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Export to CSV with UTF-8 BOM
  const exportToCSV = () => {
    const headers = ['Date', 'Employee', 'Job', 'PO', 'Clock In', 'Clock Out', 'Hours', 'Edited'];
    const rows = completedShifts.map((s) => {
      const hasEdits = shiftEdits[s.id] && shiftEdits[s.id].length > 0;
      return [
        formatDate(s.clockInTime),
        getUserName(s.user),
        `#${getJobCode(s.job)} - ${getJobName(s.job)}`,
        getJobPO(s.job) || 'N/A',
        formatTime(s.clockInTime),
        formatTime(s.clockOutTime!),
        getHoursAsNumber(s).toFixed(2),
        hasEdits ? 'Yes' : 'No',
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `time-report-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showToast('Exported to CSV', 'success');
  };

  // Edit shift – prefill with current shift values (in local time for datetime-local inputs)
  const handleEditShift = (shift: Shift) => {
    setEditingShiftId(shift.id);
    setEditingShiftData({
      clockInTime: toDateTimeLocal(shift.clockInTime),
      clockOutTime: shift.clockOutTime ? toDateTimeLocal(shift.clockOutTime) : '',
      reason: '',
    });
  };

  const openAddShiftModal = () => {
    const now = new Date();
    setNewShiftData({
      user: users.length === 1 ? users[0].id : '',
      job: jobs.length === 1 ? jobs[0].id : '',
      clockInTime: toDateTimeLocal(now.toISOString()),
      clockOutTime: '',
    });
    setShowAddShift(true);
  };

  const handleAddShift = async () => {
    if (!newShiftData.user || !newShiftData.job || !newShiftData.clockInTime.trim()) {
      showToast('Please select user, job, and clock-in time', 'error');
      return;
    }
    setAddingShift(true);
    try {
      const clockInISO = new Date(newShiftData.clockInTime).toISOString();
      const clockOutISO = newShiftData.clockOutTime.trim()
        ? new Date(newShiftData.clockOutTime).toISOString()
        : undefined;
      const created = await shiftService.createShiftManual({
        user: newShiftData.user,
        job: newShiftData.job,
        clockInTime: clockInISO,
        clockOutTime: clockOutISO,
      });
      if (created) {
        showToast('Shift added', 'success');
        setShowAddShift(false);
        onRefreshShifts?.();
      } else {
        showToast('Failed to add shift', 'error');
      }
    } catch {
      showToast('Failed to add shift', 'error');
    } finally {
      setAddingShift(false);
    }
  };

  const handleConfirmDeleteShift = async () => {
    if (!shiftToDeleteId || !onRefreshShifts) return;
    setDeletingShift(true);
    try {
      const ok = await shiftService.deleteShift(shiftToDeleteId);
      if (ok) {
        showToast('Shift deleted', 'success');
        setShiftToDeleteId(null);
        onRefreshShifts();
      } else {
        showToast('Failed to delete shift', 'error');
      }
    } catch {
      showToast('Failed to delete shift', 'error');
    } finally {
      setDeletingShift(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingShiftId || !onRefreshShifts) return;

    const shift = shifts.find((s) => s.id === editingShiftId);
    if (!shift) return;

    if (!editingShiftData.reason.trim()) {
      showToast('Please provide a reason for the edit', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const newClockIn = new Date(editingShiftData.clockInTime).toISOString();
      const newClockOut = editingShiftData.clockOutTime
        ? new Date(editingShiftData.clockOutTime).toISOString()
        : null;

      await shiftEditService.create({
        shift_id: editingShiftId,
        edited_by: currentUser.id,
        previous_clock_in: shift.clockInTime,
        new_clock_in: newClockIn,
        previous_clock_out: shift.clockOutTime ?? undefined,
        new_clock_out: newClockOut,
        reason: editingShiftData.reason,
      });
      await shiftService.updateShiftTimes(editingShiftId, newClockIn, newClockOut);

      showToast('Shift times updated successfully', 'success');
      setEditingShiftId(null);
      setEditingShiftData({ clockInTime: '', clockOutTime: '', reason: '' });

      // Clear cached history for this shift
      setShiftEdits((prev) => {
        const updated = { ...prev };
        delete updated[editingShiftId];
        return updated;
      });

      await onRefreshShifts();
    } catch (error) {
      console.error('Failed to update shift:', error);
      showToast('Failed to update shift', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-[#1a1122] to-[#2d1f3d] pb-20">
      <header className="sticky top-0 z-50 flex-shrink-0 border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <button
            onClick={() => onBack?.()}
            className="text-white transition-colors hover:text-primary"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-xl font-bold uppercase tracking-wider text-white">Time Reports</h1>
          <button
            onClick={exportToCSV}
            className="text-primary transition-colors hover:text-primary/80"
            title="Export to CSV"
          >
            <span className="material-symbols-outlined">download</span>
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
        {/* Filters */}
        <div className="space-y-4 rounded-sm border border-white/5 bg-card-dark p-3">
          {currentUser.isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setFilter('mine');
                  setSelectedUser(null);
                }}
                className={`flex-1 rounded-sm px-4 py-2 text-sm font-bold transition-all ${
                  filter === 'mine' ? 'bg-primary text-white' : 'bg-white/10 text-slate-400'
                }`}
              >
                My Time
              </button>
              <button
                onClick={() => {
                  setFilter('all');
                  setSelectedUser(null);
                  setViewMode('users');
                }}
                className={`flex-1 rounded-sm px-4 py-2 text-sm font-bold transition-all ${
                  filter === 'all' ? 'bg-primary text-white' : 'bg-white/10 text-slate-400'
                }`}
              >
                All Users
              </button>
            </div>
          )}

          <div className="flex gap-2">
            {(['today', 'week', 'month', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => {
                  setDateRange(range);
                  setPeriodOffset(0);
                }}
                className={`flex-1 rounded-sm px-3 py-2 text-xs font-bold uppercase transition-all ${
                  dateRange === range
                    ? 'border border-primary bg-primary/20 text-primary'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          {dateRange !== 'all' && (
            <div className="flex items-center justify-between gap-2 rounded-sm border border-white/10 bg-white/5 p-2">
              <button
                onClick={() => setPeriodOffset((prev) => prev + 1)}
                className="flex min-h-10 touch-manipulation items-center gap-1 rounded-sm border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-200 transition-colors hover:bg-white/20"
              >
                <span className="material-symbols-outlined text-sm">chevron_left</span>
                Older
              </button>
              <p className="text-center text-xs font-bold uppercase tracking-wide text-primary">
                {periodWindow.label}
              </p>
              <button
                onClick={() => setPeriodOffset((prev) => Math.max(0, prev - 1))}
                disabled={periodOffset === 0}
                className="flex min-h-10 touch-manipulation items-center gap-1 rounded-sm border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-200 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Newer
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            </div>
          )}

          {filter === 'all' && (
            <div className="flex gap-2">
              {(['shifts', 'users', 'jobs'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex-1 rounded-sm px-3 py-2 text-xs font-bold uppercase transition-all ${
                    viewMode === mode
                      ? 'border border-primary bg-primary/20 text-primary'
                      : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-sm border border-white/5 bg-card-dark p-3">
            <p className="mb-1 text-xs font-bold uppercase text-slate-400">Total Hours</p>
            <p className="text-2xl font-bold text-white">{totalHours.toFixed(1)}h</p>
          </div>
          <div className="rounded-sm border border-white/5 bg-card-dark p-3">
            <p className="mb-1 text-xs font-bold uppercase text-slate-400">Shifts</p>
            <p className="text-2xl font-bold text-white">{completedShifts.length}</p>
          </div>
          <div className="rounded-sm border border-white/5 bg-card-dark p-3">
            <p className="mb-1 text-xs font-bold uppercase text-slate-400">Active</p>
            <p className="text-2xl font-bold text-green-400">{activeShifts.length}</p>
          </div>
        </div>

        {/* 7-Day Chart */}
        <div className="rounded-sm border border-white/5 bg-card-dark p-3">
          <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">
            Daily Breakdown
          </h3>
          <p className="-mt-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {dateRange === 'all' ? 'Recent 7 days' : periodWindow.label}
          </p>
          <div className="flex h-32 items-end justify-between gap-2">
            {dailyBreakdown.map((day, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-primary transition-all duration-500"
                    style={{ height: `${(day.hours / maxDailyHours) * 100}%` }}
                    title={`${day.hours.toFixed(1)}h`}
                  ></div>
                </div>
                <p className="text-[10px] font-bold text-slate-500">{day.date}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Users Summary (Admin) */}
        {filter === 'all' && viewMode === 'users' && (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white">Users</h3>
            {totalsByUser.map(([userId, data]) => (
              <button
                key={userId}
                onClick={() => {
                  setSelectedUser(userId);
                  setViewMode('shifts');
                }}
                className="w-full rounded-sm border border-white/5 bg-card-dark p-3 text-left transition-all hover:border-primary/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-primary/20 text-sm font-bold text-primary">
                      {getUserInitials(userId)}
                    </div>
                    <div>
                      <p className="font-bold text-white">{getUserName(userId)}</p>
                      <p className="text-xs text-slate-400">
                        {data.shifts} shifts
                        {data.active && <span className="ml-2 text-green-400">● Active</span>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-white">{data.hours.toFixed(1)}h</p>
                  </div>
                </div>
              </button>
            ))}
            {totalsByUser.length === 0 && (
              <p className="py-8 text-center text-slate-500">No shifts recorded</p>
            )}
          </div>
        )}

        {/* Hours by Job */}
        {(viewMode === 'jobs' || filter === 'mine') && totalsByJob.length > 0 && (
          <div className="mb-4 rounded-sm border border-white/5 bg-card-dark p-3">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">
              Hours by Project
            </h3>
            <div className="space-y-4">
              {totalsByJob.slice(0, 8).map(([jobId, hours]) => {
                const percentage = totalHours > 0 ? (hours / totalHours) * 100 : 0;
                const po = getJobPO(jobId);
                return (
                  <div key={jobId} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-tight">
                      <span className="flex-1 truncate text-slate-300">
                        #{getJobCode(jobId)} {po && `• PO: ${po}`} • {getJobName(jobId)}
                      </span>
                      <span className="ml-2 text-white">{hours.toFixed(1)}h</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-sm bg-slate-800">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.min(100, percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Active Shifts (Admin) */}
        {currentUser.isAdmin && activeShifts.length > 0 && viewMode === 'shifts' && (
          <div className="mb-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-green-400">
              <span className="h-2 w-2 animate-pulse rounded-sm bg-green-500"></span>
              Currently Working ({activeShifts.length})
            </h3>
            <div className="space-y-2">
              {activeShifts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-sm border border-green-500/20 bg-green-500/10 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-green-500/20 text-xs font-bold text-green-400">
                      {getUserInitials(s.user)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">
                        {s.userName || getUserName(s.user)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        #{s.jobCode || getJobCode(s.job)} • {s.jobName || getJobName(s.job)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-400">{formatShiftHours(s)}</p>
                    <p className="text-[9px] text-slate-500">since {formatTime(s.clockInTime)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shift History */}
        {viewMode === 'shifts' && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white">
                {selectedUser ? `${getUserName(selectedUser)}'s Shifts` : 'Shift History'}
                {selectedUser && (
                  <button
                    onClick={() => setSelectedUser(null)}
                    className="ml-2 text-xs text-primary transition-colors hover:text-primary/80"
                  >
                    (clear)
                  </button>
                )}
              </h3>
              {currentUser.isAdmin && onRefreshShifts && (
                <button
                  onClick={openAddShiftModal}
                  className="flex shrink-0 items-center gap-2 rounded-sm border border-primary/50 bg-primary/20 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/30"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  Add shift
                </button>
              )}
            </div>
            <div className="space-y-3">
              {filteredShifts.length === 0 ? (
                <div className="py-12 text-center">
                  <span className="material-symbols-outlined mb-3 block text-5xl text-slate-600">
                    schedule
                  </span>
                  <p className="text-slate-400">No shifts recorded</p>
                </div>
              ) : (
                completedShifts.map((s) => (
                  <div
                    key={s.id}
                    className="relative rounded-sm border border-white/5 bg-card-dark p-3"
                  >
                    {editingShiftId === s.id ? (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                            Clock In
                          </label>
                          <input
                            type="datetime-local"
                            value={editingShiftData.clockInTime}
                            onChange={(e) =>
                              setEditingShiftData({
                                ...editingShiftData,
                                clockInTime: e.target.value,
                              })
                            }
                            className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-white outline-none focus:border-primary"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                            Clock Out
                          </label>
                          <input
                            type="datetime-local"
                            value={editingShiftData.clockOutTime}
                            onChange={(e) =>
                              setEditingShiftData({
                                ...editingShiftData,
                                clockOutTime: e.target.value,
                              })
                            }
                            className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-white outline-none focus:border-primary"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                            Reason for Edit *
                          </label>
                          <textarea
                            value={editingShiftData.reason}
                            onChange={(e) =>
                              setEditingShiftData({ ...editingShiftData, reason: e.target.value })
                            }
                            placeholder="Required: explain why you're editing this shift..."
                            className="w-full resize-none rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-white outline-none focus:border-primary"
                            rows={2}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingShiftId(null);
                              setEditingShiftData({
                                clockInTime: '',
                                clockOutTime: '',
                                reason: '',
                              });
                            }}
                            disabled={isSaving}
                            className="flex-1 rounded bg-white/10 py-2 text-xs font-bold text-white disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={isSaving || !editingShiftData.reason.trim()}
                            className="flex-1 rounded bg-primary py-2 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {isSaving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between">
                          <div className="flex min-w-0 flex-1 gap-3">
                            {filter === 'all' && !selectedUser && (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary/20 text-[10px] font-bold text-primary">
                                {getUserInitials(s.user)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-white">
                                #{s.jobCode || getJobCode(s.job)} • {s.jobName || getJobName(s.job)}
                              </p>
                              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                {filter === 'all' &&
                                  !selectedUser &&
                                  `${s.userName || getUserName(s.user)} • `}
                                {formatDate(s.clockInTime)}
                              </p>
                            </div>
                          </div>
                          <div className="ml-2 shrink-0 text-right">
                            <p className="font-bold text-white">{formatShiftHours(s)}</p>
                            <p className="whitespace-nowrap text-[9px] font-bold uppercase text-slate-500">
                              {formatTime(s.clockInTime)} - {formatTime(s.clockOutTime!)}
                            </p>
                          </div>
                        </div>

                        {/* Admin action buttons - separate row */}
                        {currentUser.isAdmin && onRefreshShifts && (
                          <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                loadShiftHistory(s.id);
                              }}
                              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-400 transition-colors hover:bg-blue-500/20"
                            >
                              <span className="material-symbols-outlined text-sm">history</span>
                              History
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditShift(s);
                              }}
                              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                              Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShiftToDeleteId(s.id);
                              }}
                              className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/20"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                              Delete
                            </button>
                          </div>
                        )}

                        {/* Edit indicator */}
                        {shiftEdits[s.id] && shiftEdits[s.id].length > 0 && (
                          <div className="mt-2 border-t border-white/10 pt-2">
                            <p className="text-[9px] font-bold uppercase text-yellow-400">
                              ⚠ Edited {shiftEdits[s.id].length} time
                              {shiftEdits[s.id].length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </main>

      {/* Edit History Modal */}
      {viewingHistoryFor && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3"
          onClick={() => setViewingHistoryFor(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-sm border border-white/10 bg-card-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <h3 className="font-bold text-white">Edit History</h3>
              <button
                onClick={() => setViewingHistoryFor(null)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="max-h-[calc(80vh-80px)] overflow-y-auto p-3">
              {loadingHistory ? (
                <p className="py-8 text-center text-slate-400">Loading...</p>
              ) : shiftEdits[viewingHistoryFor] && shiftEdits[viewingHistoryFor].length > 0 ? (
                <div className="space-y-4">
                  {shiftEdits[viewingHistoryFor].map((edit) => (
                    <div key={edit.id} className="rounded-sm border border-white/10 bg-white/5 p-3">
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">{edit.editedByName}</p>
                          <p className="text-xs text-slate-400">
                            {formatDateTime(edit.editTimestamp)}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <p className="mb-1 font-bold uppercase text-slate-500">
                              Previous Clock In
                            </p>
                            <p className="text-red-400">{formatDateTime(edit.previousClockIn)}</p>
                          </div>
                          <div className="flex-1">
                            <p className="mb-1 font-bold uppercase text-slate-500">New Clock In</p>
                            <p className="text-green-400">{formatDateTime(edit.newClockIn)}</p>
                          </div>
                        </div>
                        {(edit.previousClockOut || edit.newClockOut) && (
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <p className="mb-1 font-bold uppercase text-slate-500">
                                Previous Clock Out
                              </p>
                              <p className="text-red-400">
                                {edit.previousClockOut
                                  ? formatDateTime(edit.previousClockOut)
                                  : 'N/A'}
                              </p>
                            </div>
                            <div className="flex-1">
                              <p className="mb-1 font-bold uppercase text-slate-500">
                                New Clock Out
                              </p>
                              <p className="text-green-400">
                                {edit.newClockOut ? formatDateTime(edit.newClockOut) : 'N/A'}
                              </p>
                            </div>
                          </div>
                        )}
                        {edit.reason && (
                          <div>
                            <p className="mb-1 font-bold uppercase text-slate-500">Reason</p>
                            <p className="text-slate-300">{edit.reason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-slate-400">No edit history</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Shift Modal (Admin) */}
      {showAddShift && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3"
          onClick={() => !addingShift && setShowAddShift(false)}
        >
          <div
            className="w-full max-w-md rounded-sm border border-white/10 bg-card-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <h3 className="font-bold text-white">Add Shift</h3>
              <button
                onClick={() => !addingShift && setShowAddShift(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-4 p-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                  User *
                </label>
                <select
                  value={newShiftData.user}
                  onChange={(e) => setNewShiftData({ ...newShiftData, user: e.target.value })}
                  className="w-full rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select user</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                  Job *
                </label>
                <select
                  value={newShiftData.job}
                  onChange={(e) => setNewShiftData({ ...newShiftData, job: e.target.value })}
                  className="w-full rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select job</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      #{j.jobCode} {j.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                  Clock In *
                </label>
                <input
                  type="datetime-local"
                  value={newShiftData.clockInTime}
                  onChange={(e) =>
                    setNewShiftData({ ...newShiftData, clockInTime: e.target.value })
                  }
                  className="w-full rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                  Clock Out (optional)
                </label>
                <input
                  type="datetime-local"
                  value={newShiftData.clockOutTime}
                  onChange={(e) =>
                    setNewShiftData({ ...newShiftData, clockOutTime: e.target.value })
                  }
                  className="w-full rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave empty for an active (open) shift.
                </p>
              </div>
            </div>
            <div className="flex gap-2 border-t border-white/10 px-4 py-3">
              <button
                onClick={() => !addingShift && setShowAddShift(false)}
                disabled={addingShift}
                className="flex-1 rounded-sm bg-white/10 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddShift}
                disabled={
                  addingShift ||
                  !newShiftData.user ||
                  !newShiftData.job ||
                  !newShiftData.clockInTime.trim()
                }
                className="flex-1 rounded-sm bg-primary py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {addingShift ? 'Adding...' : 'Add Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Shift Confirmation */}
      <ConfirmDialog
        isOpen={!!shiftToDeleteId}
        title="Delete shift?"
        message="This shift will be permanently removed. This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        destructive
        onConfirm={handleConfirmDeleteShift}
        onCancel={() => !deletingShift && setShiftToDeleteId(null)}
      />
    </div>
  );
};

export default TimeReports;
