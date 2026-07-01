import { useLocation } from 'react-router-dom';
import { useApp } from './AppContext';
import { useAppNavigate } from './hooks/useAppNavigate';
import type { ViewState } from './core/types';

interface NavTab {
  label: string;
  icon: string;
  active: boolean;
  view: ViewState;
}

function BottomNavigation() {
  const { pathname } = useLocation();
  const { currentUser } = useApp();
  const appNavigate = useAppNavigate();
  const isAdmin = currentUser?.isAdmin === true;

  const isJobs = pathname.startsWith('/app/board/');
  const isStock = pathname.startsWith('/app/inventory');
  const isScanner = pathname.startsWith('/app/scanner');
  // Home is active for any /app route not claimed by another tab.
  const isHome = !isJobs && !isStock && !isScanner && pathname.startsWith('/app');

  const tabs: NavTab[] = [
    { label: 'Home', icon: 'grid_view', active: isHome, view: 'dashboard' },
    { label: 'Jobs', icon: 'assignment', active: isJobs, view: isAdmin ? 'board-admin' : 'board-shop' },
    { label: 'Stock', icon: 'inventory_2', active: isStock, view: 'inventory' },
    { label: 'Scan', icon: 'qr_code_scanner', active: isScanner, view: 'scanner' },
  ];

  return (
    <nav
      className="pb-safe fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-app-2/95 pt-2 backdrop-blur-lg md:hidden"
      aria-label="Bottom navigation"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-3">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => {
              if (!tab.active) appNavigate(tab.view);
            }}
            aria-current={tab.active ? 'page' : undefined}
            className={`flex min-h-[48px] min-w-[48px] touch-manipulation flex-col items-center justify-center gap-1 transition-colors active:opacity-70 ${
              tab.active ? 'text-primary' : 'text-muted'
            }`}
          >
            {/* Accent pill behind the active icon — a stronger "current location"
                cue than color alone (Material-3 style), accent only when active. */}
            <span
              className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
                tab.active ? 'bg-primary/15' : 'bg-transparent'
              }`}
            >
              <span className={`material-symbols-outlined ${tab.active ? 'fill-1' : ''}`}>
                {tab.icon}
              </span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export default BottomNavigation;
