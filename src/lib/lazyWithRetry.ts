import { ComponentType, lazy, LazyExoticComponent } from 'react';

const LAZY_RELOAD_GUARD_MS = 15_000;
const LAZY_RELOAD_KEY_PREFIX = 'worktrack-lazy-reload-at:';

function isRecoverableLazyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(
    message
  );
}

function getLazyReloadKey(moduleName: string): string {
  return `${LAZY_RELOAD_KEY_PREFIX}${moduleName}`;
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
  moduleName: string
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const loaded = await importer();
      try {
        sessionStorage.removeItem(getLazyReloadKey(moduleName));
      } catch {
        // Ignore storage failures (private mode / quota)
      }
      return loaded;
    } catch (error) {
      if (typeof window !== 'undefined' && isRecoverableLazyError(error)) {
        const key = getLazyReloadKey(moduleName);
        const now = Date.now();
        let lastReloadAt = 0;

        try {
          lastReloadAt = Number(sessionStorage.getItem(key) ?? '0');
        } catch {
          lastReloadAt = 0;
        }

        if (!Number.isFinite(lastReloadAt) || now - lastReloadAt > LAZY_RELOAD_GUARD_MS) {
          try {
            sessionStorage.setItem(key, String(now));
          } catch {
            // Ignore storage failures (private mode / quota)
          }
          window.location.reload();
          await new Promise(() => {
            // Keep lazy promise pending while browser reloads.
          });
        }
      }

      throw error;
    }
  });
}
