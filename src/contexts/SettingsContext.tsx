import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';

const STORAGE_KEY = 'worktrack-admin-settings';

export interface AdminSettings {
  laborRate: number;
  materialUpcharge: number; // e.g. 1.25 = 25% markup on material cost
}

const defaults: AdminSettings = {
  laborRate: 175,
  materialUpcharge: 1.25,
};

function loadSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        laborRate: Number(parsed.laborRate) || defaults.laborRate,
        materialUpcharge: Number(parsed.materialUpcharge) || defaults.materialUpcharge,
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
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
