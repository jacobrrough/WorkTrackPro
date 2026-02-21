import React, { useState, useEffect, useMemo } from 'react';
import { ViewState } from '@/core/types';
import { useSettings } from '@/contexts/SettingsContext';
import { useToast } from '@/Toast';

interface AdminSettingsProps {
  onNavigate: (view: ViewState) => void;
  onBack: () => void;
}

const WEEK_DAYS: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

const AdminSettings: React.FC<AdminSettingsProps> = ({ onNavigate: _onNavigate, onBack }) => {
  const { settings, updateSettings } = useSettings();
  const { showToast } = useToast();
  const [laborRate, setLaborRate] = useState(String(settings.laborRate));
  const [materialUpcharge, setMaterialUpcharge] = useState(String(settings.materialUpcharge));
  const [cncRate, setCncRate] = useState(String(settings.cncRate));
  const [printer3DRate, setPrinter3DRate] = useState(String(settings.printer3DRate));
  const [employeeCount, setEmployeeCount] = useState(String(settings.employeeCount));
  const [workWeekSchedule, setWorkWeekSchedule] = useState<Record<number, string>>(() =>
    WEEK_DAYS.reduce(
      (acc, { day }) => {
        acc[day] = String(settings.workWeekSchedule?.[day] ?? 0);
        return acc;
      },
      {} as Record<number, string>
    )
  );

  useEffect(() => {
    setLaborRate(String(settings.laborRate));
    setMaterialUpcharge(String(settings.materialUpcharge));
    setCncRate(String(settings.cncRate));
    setPrinter3DRate(String(settings.printer3DRate));
    setEmployeeCount(String(settings.employeeCount));
    setWorkWeekSchedule(
      WEEK_DAYS.reduce(
        (acc, { day }) => {
          acc[day] = String(settings.workWeekSchedule?.[day] ?? 0);
          return acc;
        },
        {} as Record<number, string>
      )
    );
  }, [
    settings.laborRate,
    settings.materialUpcharge,
    settings.cncRate,
    settings.printer3DRate,
    settings.employeeCount,
    settings.workWeekSchedule,
  ]);

  const weeklyHoursPerEmployee = useMemo(
    () =>
      WEEK_DAYS.reduce((sum, { day }) => {
        const value = parseFloat(workWeekSchedule[day] || '0');
        return Number.isFinite(value) && value > 0 ? sum + value : sum;
      }, 0),
    [workWeekSchedule]
  );
  const weeklyCapacity = useMemo(() => {
    const count = parseInt(employeeCount, 10);
    if (!Number.isFinite(count) || count < 1) return weeklyHoursPerEmployee;
    return weeklyHoursPerEmployee * count;
  }, [employeeCount, weeklyHoursPerEmployee]);

  const handleSave = () => {
    const lr = parseFloat(laborRate);
    const mu = parseFloat(materialUpcharge);
    const cr = parseFloat(cncRate);
    const p3r = parseFloat(printer3DRate);
    const ec = parseInt(employeeCount, 10);
    if (!Number.isFinite(ec) || ec < 1) {
      showToast('Enter a valid number of employees (≥ 1)', 'error');
      return;
    }

    const parsedSchedule: Record<number, number> = {};
    for (const { day, label } of WEEK_DAYS) {
      const value = workWeekSchedule[day] ?? '0';
      const parsed = value.trim() === '' ? 0 : parseFloat(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
        showToast(`Enter valid hours for ${label} (0-24)`, 'error');
        return;
      }
      parsedSchedule[day] = Number(parsed.toFixed(2));
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
    updateSettings({
      laborRate: lr,
      materialUpcharge: mu,
      cncRate: cr,
      printer3DRate: p3r,
      employeeCount: ec,
      workWeekSchedule: parsedSchedule,
    });
    showToast('Settings saved', 'success');
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
              <p className="text-xs text-slate-400">Pricing, machine rates, and scheduling capacity</p>
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
                  onBlur={handleSave}
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
                  onBlur={handleSave}
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
                  onBlur={handleSave}
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
                  onBlur={handleSave}
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
              className="mt-4 w-full rounded-sm bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
            >
              Save
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
                <p className="mb-2 text-xs font-medium text-slate-400">Work week schedule (hours/day)</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {WEEK_DAYS.map(({ day, label }) => (
                    <label
                      key={day}
                      className="rounded-sm border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-300"
                    >
                      <span className="mb-1 block font-medium text-slate-400">{label}</span>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={workWeekSchedule[day] ?? '0'}
                        onChange={(e) =>
                          setWorkWeekSchedule((prev) => ({
                            ...prev,
                            [day]: e.target.value,
                          }))
                        }
                        className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-sm border border-primary/30 bg-primary/10 p-3 text-sm">
                <p className="text-slate-300">
                  Weekly hours per employee:{' '}
                  <span className="font-bold text-white">{weeklyHoursPerEmployee.toFixed(1)}h</span>
                </p>
                <p className="mt-1 text-slate-300">
                  Total weekly shop capacity:{' '}
                  <span className="font-bold text-primary">{weeklyCapacity.toFixed(1)}h</span>
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              className="mt-4 w-full rounded-sm bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
