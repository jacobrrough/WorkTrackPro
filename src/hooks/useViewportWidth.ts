import { useEffect, useState } from 'react';

/**
 * Tracks the viewport width, updating on resize. SSR-safe fallback of 1280px
 * (matches the desktop-first assumption used across the board layouts).
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
