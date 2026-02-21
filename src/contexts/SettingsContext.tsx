import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import {
  DEFAULT_WORK_WEEK_SCHEDULE,
  WorkWeekSchedule,
  normalizeWorkWeekSchedule,
} from '@/lib/workHours';
import { adminSettingsService } from '@/services/api/adminSettings';

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

export interface UpdateSettingsResult {
  success: boolean;
  error?: string;
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

function sanitizeSettings(base: AdminSettings, partial: Partial<AdminSettings>): AdminSettings {
  const next = { ...base, ...partial };

  if (typeof next.laborRate !== 'number' || next.laborRate < 0) next.laborRate = base.laborRate;
  if (typeof next.materialUpcharge !== 'number' || next.materialUpcharge <= 0)
    next.materialUpcharge = base.materialUpcharge;
  if (typeof next.cncRate !== 'number' || next.cncRate < 0) next.cncRate = base.cncRate;
  if (typeof next.printer3DRate !== 'number' || next.printer3DRate < 0)
    next.printer3DRate = base.printer3DRate;
  if (
    typeof next.employeeCount !== 'number' ||
    !Number.isFinite(next.employeeCount) ||
    next.employeeCount < 1
  ) {
    next.employeeCount = base.employeeCount;
  } else {
    next.employeeCount = Math.floor(next.employeeCount);
  }
  if (
    typeof next.overtimeMultiplier !== 'number' ||
    !Number.isFinite(next.overtimeMultiplier) ||
    next.overtimeMultiplier < 1
  ) {
    next.overtimeMultiplier = base.overtimeMultiplier;
  }

  const schedulePatch = partial.workWeekSchedule as Record<number, unknown> | undefined | null;
  const mergedScheduleRaw: Record<number, unknown> = { ...base.workWeekSchedule };
  if (schedulePatch && typeof schedulePatch === 'object') {
    for (let day = 0; day <= 6; day += 1) {
      if (schedulePatch[day] === undefined) continue;
      const incoming = schedulePatch[day];
      const existing = mergedScheduleRaw[day];
      if (incoming && typeof incoming === 'object' && existing && typeof existing === 'object') {
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
}

const SettingsContext = createContext<{
  settings: AdminSettings;
  updateSettings: (partial: Partial<AdminSettings>) => Promise<UpdateSettingsResult>;
  isSyncing: boolean;
}>({
  settings: defaults,
  updateSettings: async () => ({ success: false, error: 'Settings context not initialized' }),
  isSyncing: false,
});

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AdminSettings>(loadSettings);
  const [isSyncing, setIsSyncing] = useState(false);
  const settingsRef = useRef<AdminSettings>(settings);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const hydrateSharedSettings = async () => {
      setIsSyncing(true);
      const shared = await adminSettingsService.getOrganizationSettings();
      if (!cancelled && shared) {
        setSettings((prev) =>
          sanitizeSettings(prev, {
            laborRate: shared.laborRate,
            materialUpcharge: shared.materialUpcharge,
            cncRate: shared.cncRate,
            printer3DRate: shared.printer3DRate,
            employeeCount: shared.employeeCount,
            overtimeMultiplier: shared.overtimeMultiplier,
            workWeekSchedule: shared.workWeekSchedule as WorkWeekSchedule,
          })
        );
      }
      if (!cancelled) {
        setIsSyncing(false);
      }
    };

    hydrateSharedSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AdminSettings>) => {
    const optimistic = sanitizeSettings(settingsRef.current, partial);
    setSettings(optimistic);
    setIsSyncing(true);

    const { data, error } = await adminSettingsService.upsertOrganizationSettings({
      laborRate: optimistic.laborRate,
      materialUpcharge: optimistic.materialUpcharge,
      cncRate: optimistic.cncRate,
      printer3DRate: optimistic.printer3DRate,
      employeeCount: optimistic.employeeCount,
      overtimeMultiplier: optimistic.overtimeMultiplier,
      workWeekSchedule: optimistic.workWeekSchedule as Record<number, unknown>,
    });

    setIsSyncing(false);

    if (error) {
      return { success: false, error };
    }

    if (data) {
      setSettings((prev) =>
        sanitizeSettings(prev, {
          laborRate: data.laborRate,
          materialUpcharge: data.materialUpcharge,
          cncRate: data.cncRate,
          printer3DRate: data.printer3DRate,
          employeeCount: data.employeeCount,
          overtimeMultiplier: data.overtimeMultiplier,
          workWeekSchedule: data.workWeekSchedule as WorkWeekSchedule,
        })
      );
    }

    return { success: true };
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, isSyncing }}>
      {children}
    </SettingsContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook is the primary API
export const useSettings = () => useContext(SettingsContext);
