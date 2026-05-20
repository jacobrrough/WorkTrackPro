import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Returns a back-navigation function that stays within the app.
 * On direct deep-link entry (history.state.idx === 0), navigates to fallback
 * instead of calling navigate(-1) which would exit the app entirely.
 */
export function useInAppBack(fallback = '/app') {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, fallback]);
}
