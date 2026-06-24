import { useLocation } from 'react-router-dom';
import { useApp } from './AppContext';
import { useAppNavigate } from './hooks/useAppNavigate';

function BottomNavigation() {
  const { pathname } = useLocation();
  const { currentUser } = useApp();
  const appNavigate = useAppNavigate();
  const isAdmin = currentUser?.isAdmin === true;

  const isJobs = pathname.startsWith('/app/board/');
  const isStock = pathname.startsWith('/app/inventory') || pathname.startsWith('/app/allparts');
  const isScanner = pathname.startsWith('/app/scanner');
  // Home is active for any /app route not claimed by another tab
  const isHome = !isJobs && !isStock && !isScanner && pathname.startsWith('/app');

  return (
    <nav
      className="pb-safe fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-app-2/95 pt-2 backdrop-blur-lg md:hidden"
      aria-label="Bottom navigation"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-3">
        <button
          type="button"
          onClick={() => {
            if (isHome) return;
            appNavigate('dashboard');
          }}
          aria-current={isHome ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-[48px] touch-manipulation flex-col items-center justify-center gap-1 transition-colors active:opacity-70 ${isHome ? 'text-primary' : 'text-muted'}`}
        >
          <span className={`material-symbols-outlined ${isHome ? 'fill-1' : ''}`}>grid_view</span>
          <span className="text-[10px] font-bold uppercase">Home</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (isJobs) return;
            appNavigate(isAdmin ? 'board-admin' : 'board-shop');
          }}
          aria-current={isJobs ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-[48px] touch-manipulation flex-col items-center justify-center gap-1 transition-colors active:opacity-70 ${isJobs ? 'text-primary' : 'text-muted'}`}
        >
          <span className={`material-symbols-outlined ${isJobs ? 'fill-1' : ''}`}>assignment</span>
          <span className="text-[10px] font-bold uppercase">Jobs</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (isStock) return;
            appNavigate('inventory');
          }}
          aria-current={isStock ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-[48px] touch-manipulation flex-col items-center justify-center gap-1 transition-colors active:opacity-70 ${isStock ? 'text-primary' : 'text-muted'}`}
        >
          <span className={`material-symbols-outlined ${isStock ? 'fill-1' : ''}`}>
            inventory_2
          </span>
          <span className="text-[10px] font-bold uppercase">Stock</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (isScanner) return;
            appNavigate('scanner');
          }}
          aria-current={isScanner ? 'page' : undefined}
          className={`flex min-h-[48px] min-w-[48px] touch-manipulation flex-col items-center justify-center gap-1 transition-colors active:opacity-70 ${isScanner ? 'text-primary' : 'text-muted'}`}
        >
          <span className={`material-symbols-outlined ${isScanner ? 'fill-1' : ''}`}>
            qr_code_scanner
          </span>
          <span className="text-[10px] font-bold uppercase">Scan</span>
        </button>
      </div>
    </nav>
  );
}

export default BottomNavigation;
