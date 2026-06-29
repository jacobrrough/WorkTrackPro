import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

/**
 * Returns a ref whose `.current` is true while the component is mounted and false after unmount.
 * Use it to guard post-await state updates in async handlers — e.g. an upload whose `onChanged`
 * refresh removes (unmounts) the row before its `finally` runs:
 *
 *   const mounted = useMountedRef();
 *   ...
 *   } finally {
 *     if (mounted.current) setBusy(false);
 *   }
 */
export function useMountedRef(): MutableRefObject<boolean> {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
