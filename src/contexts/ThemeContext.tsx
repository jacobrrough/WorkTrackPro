import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  readStoredMode,
  readStoredTheme,
  storeMode,
  storeTheme,
  watchSystemMode,
} from '../theme/applyTheme';
import { type AppearanceMode, type ThemeId } from '../theme/themes';
import { userThemePreferencesService } from '../services/api/userThemePreferences';
import { supabase } from '../services/api/supabaseClient';

interface ThemeContextValue {
  /** The color palette (signal-red, crimson, …). */
  theme: ThemeId;
  /** Light/dark choice: system (default), light, or dark. */
  mode: AppearanceMode;
  setTheme: (id: ThemeId) => void;
  setMode: (mode: AppearanceMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage synchronously so the first render matches the
  // pre-paint script (no flash). The Supabase copy reconciles right after.
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());
  const [mode, setModeState] = useState<AppearanceMode>(() => readStoredMode());
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    applyTheme(theme, mode);
  }, [theme, mode]);

  // While following the OS, re-resolve when the system flips light/dark.
  useEffect(() => {
    if (mode !== 'system') return;
    return watchSystemMode(() => applyTheme(themeRef.current, 'system'));
  }, [mode]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    storeTheme(id);
    void userThemePreferencesService.setTheme(id);
  }, []);

  const setMode = useCallback((next: AppearanceMode) => {
    setModeState(next);
    storeMode(next);
  }, []);

  // Cross-device sync: on sign-in, adopt the server's saved palette. If the user
  // has no saved row yet, persist whatever they're currently using locally. (Mode
  // is a device-level preference — `system` follows each device's own OS — so it
  // is not synced across devices.)
  useEffect(() => {
    let active = true;

    const sync = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || !active) return;

      const remote = await userThemePreferencesService.getTheme();
      if (!active) return;

      if (remote && remote !== themeRef.current) {
        setThemeState(remote);
        storeTheme(remote);
      } else if (!remote) {
        void userThemePreferencesService.setTheme(themeRef.current);
      }
    };

    void sync();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void sync();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
