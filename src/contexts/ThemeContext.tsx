import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyTheme, readStoredTheme, storeTheme } from '../theme/applyTheme';
import { type ThemeId } from '../theme/themes';
import { userThemePreferencesService } from '../services/api/userThemePreferences';
import { supabase } from '../services/api/supabaseClient';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage synchronously so the first render matches the
  // pre-paint script (no flash). The Supabase copy reconciles right after.
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    storeTheme(id);
    void userThemePreferencesService.setTheme(id);
  }, []);

  // Cross-device sync: on sign-in, adopt the server's saved theme. If the user
  // has no saved row yet, persist whatever they're currently using locally.
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

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
