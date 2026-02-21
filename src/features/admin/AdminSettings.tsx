import React, { useState, useEffect, useMemo } from 'react';
import { ViewState } from '@/core/types';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/Toast';
import {
  WorkWeekSchedule,
  getDayScheduleHours,
  getWeeklyCapacityHours,
  getWeeklyWorkHours,
  normalizeWorkWeekSchedule,
} from '@/lib/workHours';

interface AdminSettingsProps {
  onNavigate: (view: ViewState) => void;
  onBack: () => void;
}

const WEEK_DAYS: Array<{ day: number; short: string; label: string }> = [
  { day: 1, short: 'Mon', label: 'Monday' },
  { day: 2, short: 'Tue', label: 'Tuesday' },
  { day: 3, short: 'Wed', label: 'Wednesday' },
  { day: 4, short: 'Thu', label: 'Thursday' },
  { day: 5, short: 'Fri', label: 'Friday' },
  { day: 6, short: 'Sat', label: 'Saturday' },
  { day: 0, short: 'Sun', label: 'Sunday' },
];

const AdminSettings: React.FC<AdminSettingsProps> = ({ onNavigate: _onNavigate, onBack }) => {
  const { settings, updateSettings, isSyncing } = useSettings();
  const { showToast } = useToast();
  const [laborRate, setLaborRate] = useState(String(settings.laborRate));
  const [materialUpcharge, setMaterialUpcharge] = useState(String(settings.materialUpcharge));
  const [cncRate, setCncRate] = useState(String(settings.cncRate));
  const [printer3DRate, setPrinter3DRate] = useState(String(settings.printer3DRate));
  const [employeeCount, setEmployeeCount] = useState(String(settings.employeeCount));
  const [overtimeMultiplier, setOvertimeMultiplier] = useState(String(settings.overtimeMultiplier));
  const [workWeekSchedule, setWorkWeekSchedule] = useState<WorkWeekSchedule>(() =>
    normalizeWorkWeekSchedule(settings.workWeekSchedule)
  );

  useEffect(() => {
    setLaborRate(String(settings.laborRate));
    setMaterialUpcharge(String(settings.materialUpcharge));
    setCncRate(String(settings.cncRate));
    setPrinter3DRate(String(settings.printer3DRate));
    setEmployeeCount(String(settings.employeeCount));
    setOvertimeMultiplier(String(settings.overtimeMultiplier));
    setWorkWeekSchedule(normalizeWorkWeekSchedule(settings.workWeekSchedule));
  }, [
    settings.laborRate,
    settings.materialUpcharge,
    settings.cncRate,
    settings.printer3DRate,
    settings.employeeCount,
    settings.overtimeMultiplier,
    settings.workWeekSchedule,
  ]);

  const regularHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(workWeekSchedule),
    [workWeekSchedule]
  );
  const maxHoursPerEmployee = useMemo(
    () => getWeeklyWorkHours(workWeekSchedule, { includeOvertime: true }),
    [workWeekSchedule]
  );
  const overtimeHoursPerEmployee = useMemo(
    () => Math.max(0, maxHoursPerEmployee - regularHoursPerEmployee),
    [maxHoursPerEmployee, regularHoursPerEmployee]
  );
  const weeklyCapacity = useMemo(() => {
    const count = parseInt(employeeCount, 10);
    if (!Number.isFinite(count) || count < 1) return regularHoursPerEmployee;
    return getWeeklyCapacityHours(count, workWeekSchedule);
  }, [employeeCount, regularHoursPerEmployee, workWeekSchedule]);
  const weeklyCapacityWithOt = useMemo(() => {
    const count = parseInt(employeeCount, 10);
    if (!Number.isFinite(count) || count < 1) return maxHoursPerEmployee;
    return getWeeklyCapacityHours(count, workWeekSchedule, { includeOvertime: true });
  }, [employeeCount, maxHoursPerEmployee, workWeekSchedule]);

  const updateDaySchedule = (
    day: number,
    patch:
      | Partial<WorkWeekSchedule[number]>
      | ((prev: WorkWeekSchedule[number]) => WorkWeekSchedule[number])
  ) => {
    setWorkWeekSchedule((prev) => {
      const current = prev[day];
      const nextDay = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      return { ...prev, [day]: nextDay };
    });
  };

  const handleSave = async () => {
    const lr = parseFloat(laborRate);
    const mu = parseFloat(materialUpcharge);
    const cr = parseFloat(cncRate);
    const p3r = parseFloat(printer3DRate);
    const ec = parseInt(employeeCount, 10);
    const otMultiplier = parseFloat(overtimeMultiplier);
    if (!Number.isFinite(ec) || ec < 1) {
      showToast('Enter a valid number of employees (≥ 1)', 'error');
      return;
    }

    if (!Number.isFinite(otMultiplier) || otMultiplier < 1) {
      showToast('Enter a valid overtime multiplier (≥ 1.0)', 'error');
      return;
    }

    const normalizedSchedule = normalizeWorkWeekSchedule(workWeekSchedule);
    for (const { day, short } of WEEK_DAYS) {
      const daySchedule = normalizedSchedule[day];
      if (!daySchedule.enabled) continue;

      const dayHours = getDayScheduleHours(daySchedule);
      if (dayHours.standardWindowHours <= 0) {
        showToast(`${short}: set a valid regular start/end window`, 'error');
        return;
      }
      if (daySchedule.unpaidBreakMinutes > dayHours.standardWindowHours * 60) {
        showToast(`${short}: unpaid break is longer than the regular shift`, 'error');
        return;
      }
      if (daySchedule.overtimeEnabled && dayHours.overtimeHoursPerEmployee <= 0) {
        showToast(`${short}: set a valid overtime start/end window`, 'error');
        return;
      }
    }

    if (Number.isNaN(lr) || lr < 0) {
      showToast('Enter a valid labor rate (≥ 0)', 'error');
      return;
    }
    if (Number.isNaN(mu) || mu <= 0) {
      showToast('Enter a valid material upcharge (> 0)', 'error');
      return;
    }
    if (Number.isNaN(cr) || cr < 0) {
      showToast('Enter a valid CNC rate (≥ 0)', 'error');
      return;
    }
    if (Number.isNaN(p3r) || p3r < 0) {
      showToast('Enter a valid 3D printer rate (≥ 0)', 'error');
      return;
    }
    const result = await updateSettings({
      laborRate: lr,
      materialUpcharge: mu,
      cncRate: cr,
      printer3DRate: p3r,
      employeeCount: ec,
      overtimeMultiplier: otMultiplier,
      workWeekSchedule: normalizedSchedule,
    });
    if (result.success) {
      showToast('Settings saved for organization', 'success');
      return;
    }
    showToast(
      result.error
        ? `Failed to save org settings: ${result.error}`
        : 'Failed to save organization settings',
      'error'
    );
  };

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex size-10 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">Admin Settings</h1>
              <p className="text-xs text-slate-400">
                Pricing, machine rates, and scheduling capacity
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-md space-y-6">
          <div className="rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-4 text-sm font-semibold text-white">Pricing</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Labor rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={laborRate}
                  onChange={(e) => setLaborRate(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="175"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Used to auto-calculate labor cost (hours × rate). Manual prices are not
                  overwritten.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Material upcharge (multiplier)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={materialUpcharge}
                  onChange={(e) => setMaterialUpcharge(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="1.25"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Material cost we pay × upcharge = selling price (e.g. 1.25 = 25% markup).
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  CNC rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={cncRate}
                  onChange={(e) => setCncRate(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="150"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Rate per hour for CNC machine time (used in part quotes).
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  3D Printer rate ($/hr)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={printer3DRate}
                  onChange={(e) => setPrinter3DRate(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="100"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Rate per hour for 3D printer time (used in part quotes).
                </p>
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={isSyncing}
              className="mt-4 w-full rounded-sm bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
            >
              {isSyncing ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className="rounded-sm border border-white/10 bg-white/5 p-4">
            <h2 className="mb-4 text-sm font-semibold text-white">Scheduling Capacity</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Employees on shop floor
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={employeeCount}
                  onChange={(e) => setEmployeeCount(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="5"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Used to calculate total schedulable hours each day/week.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Overtime multiplier
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.05"
                  value={overtimeMultiplier}
                  onChange={(e) => setOvertimeMultiplier(e.target.value)}
                  className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2.5 text-white focus:border-primary/50 focus:outline-none"
                  placeholder="1.50"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Used to estimate additional labor cost for overtime hours (e.g., 1.5 = time and a
                  half).
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">Work week schedule</p>
                <div className="space-y-3">
                  {WEEK_DAYS.map(({ day, short, label }) => {
                    const daySchedule = workWeekSchedule[day];
                    const dayHours = getDayScheduleHours(daySchedule);
                    return (
                      <div
                        key={day}
                        className="rounded-sm border border-white/10 bg-white/5 p-3 text-xs text-slate-300"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-white">{label}</p>
                            <p className="text-[10px] text-slate-500">
                              {dayHours.regularHoursPerEmployee.toFixed(1)}h regular
                              {daySchedule.overtimeEnabled &&
                                dayHours.overtimeHoursPerEmployee > 0 &&
                                ` + ${dayHours.overtimeHoursPerEmployee.toFixed(1)}h OT`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateDaySchedule(day, { enabled: !daySchedule.enabled })
                            }
                            className={`h-6 w-12 rounded-sm transition-colors ${daySchedule.enabled ? 'bg-primary' : 'bg-white/20'}`}
                            aria-label={`${short} enabled`}
                          >
                            <span
                              className={`block h-5 w-5 rounded-sm bg-white transition-transform ${daySchedule.enabled ? 'translate-x-6' : 'translate-x-0.5'}`}
                            />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="text-[10px] text-slate-400">
                            Start
                            <input
                              type="time"
                              value={daySchedule.standardStart}
                              onChange={(e) =>
                                updateDaySchedule(day, { standardStart: e.target.value })
                              }
                              disabled={!daySchedule.enabled}
                              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            End
                            <input
                              type="time"
                              value={daySchedule.standardEnd}
                              onChange={(e) =>
                                updateDaySchedule(day, { standardEnd: e.target.value })
                              }
                              disabled={!daySchedule.enabled}
                              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            Unpaid break (min)
                            <input
                              type="number"
                              min="0"
                              max="720"
                              step="5"
                              value={daySchedule.unpaidBreakMinutes}
                              onChange={(e) =>
                                updateDaySchedule(day, {
                                  unpaidBreakMinutes: Number(e.target.value || 0),
                                })
                              }
                              disabled={!daySchedule.enabled}
                              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                            />
                          </label>
                        </div>

                        <div className="mt-2 rounded border border-white/10 bg-black/20 p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-slate-300">
                              Overtime window
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateDaySchedule(day, {
                                  overtimeEnabled: !daySchedule.overtimeEnabled,
                                })
                              }
                              disabled={!daySchedule.enabled}
                              className={`h-5 w-10 rounded-sm transition-colors ${daySchedule.overtimeEnabled ? 'bg-amber-500' : 'bg-white/20'} disabled:opacity-40`}
                              aria-label={`${short} overtime enabled`}
                            >
                              <span
                                className={`block h-4 w-4 rounded-sm bg-white transition-transform ${daySchedule.overtimeEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                              />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="text-[10px] text-slate-400">
                              OT Start
                              <input
                                type="time"
                                value={daySchedule.overtimeStart}
                                onChange={(e) =>
                                  updateDaySchedule(day, { overtimeStart: e.target.value })
                                }
                                disabled={!daySchedule.enabled || !daySchedule.overtimeEnabled}
                                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                              />
                            </label>
                            <label className="text-[10px] text-slate-400">
                              OT End
                              <input
                                type="time"
                                value={daySchedule.overtimeEnd}
                                onChange={(e) =>
                                  updateDaySchedule(day, { overtimeEnd: e.target.value })
                                }
                                disabled={!daySchedule.enabled || !daySchedule.overtimeEnabled}
                                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white disabled:opacity-50"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-sm border border-primary/30 bg-primary/10 p-3 text-sm">
                <p className="text-slate-300">
                  Weekly regular hours per employee:{' '}
                  <span className="font-bold text-white">
                    {regularHoursPerEmployee.toFixed(1)}h
                  </span>
                </p>
                <p className="mt-1 text-slate-300">
                  Weekly possible overtime per employee:{' '}
                  <span className="font-bold text-amber-300">
                    {overtimeHoursPerEmployee.toFixed(1)}h
                  </span>
                </p>
                <p className="mt-1 text-slate-300">
                  Weekly regular shop capacity:{' '}
                  <span className="font-bold text-primary">{weeklyCapacity.toFixed(1)}h</span>
                </p>
                <p className="mt-1 text-slate-300">
                  Weekly max capacity with overtime:{' '}
                  <span className="font-bold text-amber-300">
                    {weeklyCapacityWithOt.toFixed(1)}h
                  </span>
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={isSyncing}
              className="mt-4 w-full rounded-sm bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
            >
              {isSyncing ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
