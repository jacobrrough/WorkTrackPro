import { ThemePicker } from '../../components/ThemePicker';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeMeta, type AppearanceMode } from '../../theme/themes';

interface AppearanceSettingsViewProps {
  onBack: () => void;
}

const MODES: { id: AppearanceMode; label: string; icon: string }[] = [
  { id: 'system', label: 'System', icon: 'brightness_auto' },
  { id: 'light', label: 'Light', icon: 'light_mode' },
  { id: 'dark', label: 'Dark', icon: 'dark_mode' },
];

export function AppearanceSettingsView({ onBack }: AppearanceSettingsViewProps) {
  const { theme, mode, setMode } = useTheme();
  const current = getThemeMeta(theme);

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="app-header px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="app-icon-btn border border-line bg-overlay/5 text-white"
            aria-label="Go back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="app-section-title text-white">Appearance</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-2xl space-y-8">
          <section>
            <h2 className="text-base font-bold text-white">Appearance mode</h2>
            <p className="mt-1 text-sm text-muted">
              Choose light or dark, or follow your device&apos;s system setting.
            </p>
            <div
              role="radiogroup"
              aria-label="Appearance mode"
              className="mt-3 grid grid-cols-3 gap-2"
            >
              {MODES.map((m) => {
                const active = m.id === mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(m.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'border-primary bg-primary/10 text-white'
                        : 'border-line bg-overlay/5 text-muted hover:text-white'
                    }`}
                  >
                    <span className={`material-symbols-outlined ${active ? 'text-primary' : ''}`}>
                      {m.icon}
                    </span>
                    <span className="text-xs font-semibold">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold text-white">Color theme</h2>
            <p className="mt-1 text-sm text-muted">
              Pick a color palette. Your choice is saved to your account and follows you across every
              device you sign in on.
            </p>
            <ThemePicker className="mt-3" />
          </section>

          <p className="text-xs text-subtle">
            Current: <span className="font-semibold text-muted">{current.label}</span> ·{' '}
            {mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
          </p>
        </div>
      </main>
    </div>
  );
}

export default AppearanceSettingsView;
