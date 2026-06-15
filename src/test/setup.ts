import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView; components that auto-scroll (e.g. MessageList)
// call it on mount, so stub it to a no-op to keep those component tests from throwing.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
}

// Node 22+ ships a built-in `localStorage` global that shadows jsdom's Storage in
// the test environment; without a --localstorage-file path it is a broken object
// with no setItem/getItem. Replace it (and sessionStorage, same issue) with an
// in-memory implementation. Defined configurable so vi.stubGlobal still works.
function installMemoryStorage(name: 'localStorage' | 'sessionStorage') {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (existing && typeof existing.setItem === 'function') return;
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}
installMemoryStorage('localStorage');
installMemoryStorage('sessionStorage');

afterEach(() => {
  cleanup();
});
