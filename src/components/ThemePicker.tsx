import { useTheme } from '../contexts/ThemeContext';
import { THEMES } from '../theme/themes';

/**
 * Swatch grid for choosing a color theme. The preview swatches use literal
 * colors from the theme registry (not the active tokens) so every option shows
 * its true palette regardless of the current theme.
 */
export function ThemePicker({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${className}`}
    >
      {THEMES.map((t) => {
        const selected = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(t.id)}
            title={t.description}
            className={`group flex flex-col overflow-hidden rounded-lg border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected
                ? 'border-primary ring-2 ring-primary/60'
                : 'border-line hover:border-line-strong'
            }`}
          >
            <span className="flex h-16 items-stretch gap-1 p-2" style={{ background: t.swatch.bg }}>
              <span className="w-2 rounded-lg" style={{ background: t.swatch.accent }} />
              <span className="flex-1 rounded-lg" style={{ background: t.swatch.surface }} />
              <span className="flex w-1/3 flex-col gap-1 py-0.5">
                <span
                  className="h-1.5 rounded-lg"
                  style={{ background: t.swatch.muted, opacity: 0.7 }}
                />
                <span
                  className="h-1.5 w-2/3 rounded-lg"
                  style={{ background: t.swatch.muted, opacity: 0.4 }}
                />
                <span
                  className="mt-auto h-3 w-10 rounded-lg"
                  style={{ background: t.swatch.accent }}
                />
              </span>
            </span>
            <span className="flex items-center justify-between gap-1 px-2.5 py-1.5">
              <span className="truncate text-xs font-medium text-white">{t.label}</span>
              {selected && (
                <span className="material-symbols-outlined shrink-0 text-base text-primary">
                  check_circle
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
