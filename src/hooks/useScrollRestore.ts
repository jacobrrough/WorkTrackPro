import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';

const Y_KEY = (k: string) => `${k}__y`;
const X_KEY = (k: string) => `${k}__x`;

type Axis = 'y' | 'x' | 'both';

/**
 * Persist & restore a scroll container's position across route navigations.
 *
 * Behavior:
 *   1. Restores the saved position in useLayoutEffect (before first paint) — no flash to top.
 *   2. Flushes the exact DOM position in useLayoutEffect cleanup on unmount —
 *      runs while refs are still valid (before React's safelyDetachRef).
 *   3. Throttles onScroll saves to 100ms so localStorage isn't hit on every scroll pixel.
 *
 * If the scrollable element mounts after data loads (conditional render), pass
 * `ready: <data-loaded>` so restore re-fires once the container is in the DOM.
 *
 * Usage:
 *   const { ref, onScroll } = useScrollRestore('inventory-list');
 *   return <div ref={ref} onScroll={onScroll} className="overflow-y-auto">...</div>;
 */
export function useScrollRestore<T extends HTMLElement = HTMLDivElement>(
  key: string,
  options: { axis?: Axis; ready?: boolean } = {}
) {
  const axis = options.axis ?? 'y';
  const ready = options.ready ?? true;
  const { state, updateState } = useNavigation();
  const ref = useRef<T | null>(null);
  const posRef = useRef(state.scrollPositions);
  const lastSaveRef = useRef(0);
  const restoredRef = useRef(false);

  useEffect(() => {
    posRef.current = state.scrollPositions;
  }, [state.scrollPositions]);

  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    const el = ref.current;
    if (!el) return;
    restoredRef.current = true;
    const top = axis !== 'x' ? posRef.current[Y_KEY(key)] : undefined;
    const left = axis !== 'y' ? posRef.current[X_KEY(key)] : undefined;
    if ((top !== undefined && top > 0) || (left !== undefined && left > 0)) {
      el.scrollTo({
        top: top ?? 0,
        left: left ?? 0,
        behavior: 'instant',
      });
    }
  }, [key, axis, ready]);

  useLayoutEffect(() => {
    return () => {
      const el = ref.current;
      if (!el) return;
      const next = { ...posRef.current };
      if (axis !== 'x') next[Y_KEY(key)] = el.scrollTop;
      if (axis !== 'y') next[X_KEY(key)] = el.scrollLeft;
      updateState({ scrollPositions: next });
    };
  }, [key, axis, updateState]);

  const onScroll = (e: React.UIEvent<T>) => {
    const now = Date.now();
    if (now - lastSaveRef.current < 100) return;
    lastSaveRef.current = now;
    const el = e.currentTarget;
    const next = { ...posRef.current };
    if (axis !== 'x') next[Y_KEY(key)] = el.scrollTop;
    if (axis !== 'y') next[X_KEY(key)] = el.scrollLeft;
    updateState({ scrollPositions: next });
  };

  return { ref, onScroll };
}
