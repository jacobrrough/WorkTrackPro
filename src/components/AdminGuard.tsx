import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../AppContext';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { currentUser } = useApp();
  if (!currentUser?.isAdmin) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
