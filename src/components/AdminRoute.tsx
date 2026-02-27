import { type ReactNode, useEffect } from 'react';
import { useApp } from '../AppContext';

/**
 * Renders children only when the current user is an admin.
 * When the user is not an admin, calls onRedirectToDashboard (e.g. to navigate to dashboard view).
 * Use for admin-only views (settings, time reports, parts, create-job, quotes, trello-import).
 */
export function AdminRoute({
  children,
  onRedirectToDashboard,
}: {
  children: ReactNode;
  onRedirectToDashboard: () => void;
}) {
  const { currentUser } = useApp();

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin) {
      onRedirectToDashboard();
    }
  }, [currentUser, onRedirectToDashboard]);

  if (!currentUser) return null;
  if (!currentUser.isAdmin) return null;
  return <>{children}</>;
}
