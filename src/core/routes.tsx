import type { ViewState } from './types';

/** Map (view, id?) to path for use with React Router */
export function getPath(view: ViewState, id?: string): string {
  switch (view) {
    case 'landing':
      return '/';
    case 'login':
      return '/login';
    case 'dashboard':
      return '/dashboard';
    case 'board-shop':
      return '/jobs';
    case 'board-admin':
      return '/admin/board';
    case 'job-detail':
      return id ? `/jobs/${id}` : '/jobs';
    case 'inventory':
      return '/inventory';
    case 'inventory-detail':
      return id ? `/inventory/${id}` : '/inventory';
    case 'needs-ordering':
      return '/inventory/ordering';
    case 'time-reports':
      return '/time';
    case 'clock-in':
      return '/clock-in';
    case 'admin-create-job':
      return '/admin/jobs/new';
    case 'admin-console':
      return '/admin';
    case 'quotes':
      return '/admin/quotes';
    default:
      return '/dashboard';
  }
}

/** Derive view and ids from pathname (for use in App) */
export function getViewFromPath(pathname: string): {
  view: ViewState;
  jobId?: string;
  inventoryId?: string;
} {
  if (pathname === '/') return { view: 'landing' };
  if (pathname === '/login') return { view: 'login' };
  if (pathname === '/dashboard') return { view: 'dashboard' };
  if (pathname === '/jobs') return { view: 'board-shop' };
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
  if (jobMatch) return { view: 'job-detail', jobId: jobMatch[1] };
  if (pathname === '/inventory') return { view: 'inventory' };
  if (pathname === '/inventory/ordering') return { view: 'needs-ordering' };
  const invMatch = pathname.match(/^\/inventory\/([^/]+)$/);
  if (invMatch) return { view: 'inventory-detail', inventoryId: invMatch[1] };
  if (pathname === '/time') return { view: 'time-reports' };
  if (pathname === '/clock-in') return { view: 'clock-in' };
  if (pathname === '/admin/jobs/new') return { view: 'admin-create-job' };
  if (pathname === '/admin/board') return { view: 'board-admin' };
  if (pathname === '/admin/quotes') return { view: 'quotes' };
  if (pathname === '/admin') return { view: 'admin-console' };
  return { view: 'dashboard' };
}
