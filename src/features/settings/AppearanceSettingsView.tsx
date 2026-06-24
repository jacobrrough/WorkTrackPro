import { ThemePicker } from '../../components/ThemePicker';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeMeta } from '../../theme/themes';

interface AppearanceSettingsViewProps {
  onBack: () => void;
}

export function AppearanceSettingsView({ onBack }: AppearanceSettingsViewProps) {
  const { theme } = useTheme();
  const current = getThemeMeta(theme);

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-app/95 px-4 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex size-10 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
            aria-label="Go back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">Appearance</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4">
            <h2 className="text-base font-bold text-white">Color theme</h2>
            <p className="mt-1 text-sm text-muted">
              Pick a theme for the app. Your choice is saved to your account and follows you across
              every device you sign in on.
            </p>
          </div>

          <ThemePicker />

          <p className="mt-4 text-xs text-subtle">
            Current theme: <span className="font-semibold text-muted">{current.label}</span> ·{' '}
            {current.mode === 'light' ? 'Light' : 'Dark'}
          </p>
        </div>
      </main>
    </div>
  );
}

export default AppearanceSettingsView;
