import type { ReactNode } from 'react';
import { useApp } from '../AppContext';

/**
 * Renders children only when the user is authenticated.
 * When not authenticated, renders null; the parent (App) should show the Login screen.
 * Used to guard app content after the top-level auth check.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { currentUser } = useApp();
  if (!currentUser) return null;
  return <>{children}</>;
}
