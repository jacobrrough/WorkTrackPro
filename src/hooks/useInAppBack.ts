import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Returns a back-navigation function that stays within the app.
 *
 * When real history exists (history.state.idx > 0) it goes back one entry, so
 * the user lands on whatever page they actually came from.
 *
 * When there is no history to go back to (history.state.idx === 0 — e.g. PWA
 * cold start, reload-to-URL, or a deep link), it prefers an explicit origin
 * stamped into the entry's navigation state (`state.from`, set by useAppNavigate)
 * so back still returns to the true previous page even after the browser history
 * index is lost. Only if no origin was recorded does it use the static fallback.
 */
export function useInAppBack(fallback = '/app') {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? fallback, { replace: true });
  }, [navigate, fallback, location.state]);
}
