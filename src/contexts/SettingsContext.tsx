import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  DEFAULT_WORK_WEEK_SCHEDULE,
  WorkWeekSchedule,
  normalizeWorkWeekSchedule,
} from '@/lib/workHours';

const STORAGE_KEY = 'worktrack-admin-settings';

export interface AdminSettings {
  laborRate: number;
  materialUpcharge: number; // e.g. 1.25 = 25% markup on material cost
  cncRate: number; // Rate per hour for CNC machine time
  printer3DRate: number; // Rate per hour for 3D printer time
  employeeCount: number; // Number of employees available for scheduling
  workWeekSchedule: WorkWeekSchedule; // Start/end/break/overtime by day (0-6 => Sun-Sat)
  overtimeMultiplier: number; // e.g. 1.5 => time-and-a-half
}

const defaults: AdminSettings = {
  laborRate: 175,
  materialUpcharge: 1.25,
  cncRate: 150, // Typically lower than labor rate
  printer3DRate: 100, // Typically lower than CNC rate
  employeeCount: 5,
  workWeekSchedule: normalizeWorkWeekSchedule(DEFAULT_WORK_WEEK_SCHEDULE),
  overtimeMultiplier: 1.5,
};

function loadSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const laborRate = Number(parsed.laborRate);
      const materialUpcharge = Number(parsed.materialUpcharge);
      const cncRate = Number(parsed.cncRate);
      const printer3DRate = Number(parsed.printer3DRate);
      const employeeCount = Number(parsed.employeeCount);
      const overtimeMultiplier = Number(parsed.overtimeMultiplier);
      return {
        laborRate: Number.isFinite(laborRate) && laborRate >= 0 ? laborRate : defaults.laborRate,
        materialUpcharge:
          Number.isFinite(materialUpcharge) && materialUpcharge > 0
            ? materialUpcharge
            : defaults.materialUpcharge,
        cncRate: Number.isFinite(cncRate) && cncRate >= 0 ? cncRate : defaults.cncRate,
        printer3DRate:
          Number.isFinite(printer3DRate) && printer3DRate >= 0
            ? printer3DRate
            : defaults.printer3DRate,
        employeeCount:
          Number.isFinite(employeeCount) && employeeCount >= 1
            ? Math.floor(employeeCount)
            : defaults.employeeCount,
        workWeekSchedule: normalizeWorkWeekSchedule(parsed.workWeekSchedule),
        overtimeMultiplier:
          Number.isFinite(overtimeMultiplier) && overtimeMultiplier >= 1
            ? overtimeMultiplier
            : defaults.overtimeMultiplier,
      };
    }
  } catch {
    /* ignore parse errors */
  }
  return { ...defaults };
}

function saveSettings(s: AdminSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.error('Failed to save admin settings', e);
  }
}

const SettingsContext = createContext<{
  settings: AdminSettings;
  updateSettings: (partial: Partial<AdminSettings>) => void;
}>({
  settings: defaults,
  updateSettings: () => {},
});

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AdminSettings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((partial: Partial<AdminSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      if (typeof next.laborRate !== 'number' || next.laborRate < 0) next.laborRate = prev.laborRate;
      if (typeof next.materialUpcharge !== 'number' || next.materialUpcharge <= 0)
        next.materialUpcharge = prev.materialUpcharge;
      if (typeof next.cncRate !== 'number' || next.cncRate < 0) next.cncRate = prev.cncRate;
      if (typeof next.printer3DRate !== 'number' || next.printer3DRate < 0)
        next.printer3DRate = prev.printer3DRate;
      if (
        typeof next.employeeCount !== 'number' ||
        !Number.isFinite(next.employeeCount) ||
        next.employeeCount < 1
      ) {
        next.employeeCount = prev.employeeCount;
      } else {
        next.employeeCount = Math.floor(next.employeeCount);
      }
      if (
        typeof next.overtimeMultiplier !== 'number' ||
        !Number.isFinite(next.overtimeMultiplier) ||
        next.overtimeMultiplier < 1
      ) {
        next.overtimeMultiplier = prev.overtimeMultiplier;
      }

      const schedulePatch = partial.workWeekSchedule as
        | Record<number, unknown>
        | undefined
        | null;
      const mergedScheduleRaw: Record<number, unknown> = {
        ...prev.workWeekSchedule,
      };
      if (schedulePatch && typeof schedulePatch === 'object') {
        for (let day = 0; day <= 6; day += 1) {
          if (schedulePatch[day] === undefined) continue;
          const incoming = schedulePatch[day];
          const existing = mergedScheduleRaw[day];
          if (
            incoming &&
            typeof incoming === 'object' &&
            existing &&
            typeof existing === 'object'
          ) {
            mergedScheduleRaw[day] = { ...(existing as object), ...(incoming as object) };
          } else {
            mergedScheduleRaw[day] = incoming;
          }
        }
      } else if (next.workWeekSchedule) {
        Object.assign(mergedScheduleRaw, next.workWeekSchedule);
      }

      next.workWeekSchedule = normalizeWorkWeekSchedule(mergedScheduleRaw);
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook is the primary API
export const useSettings = () => useContext(SettingsContext);
