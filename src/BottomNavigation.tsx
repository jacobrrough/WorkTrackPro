import React from 'react';
import { ViewState } from '@/core/types';

interface BottomNavigationProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
}

/** Persistent bottom tab bar for shop floor: Home | Jobs | Stock | Scanner */
const BottomNavigation: React.FC<BottomNavigationProps> = ({ currentView, onNavigate }) => {
  const isHome = currentView === 'dashboard';
  const isJobs = currentView === 'board-shop';
  const isStock = currentView === 'inventory' || currentView === 'inventory-detail';
  const isScanner = currentView === 'scanner';

  const navToJobs = () => onNavigate('board-shop');

  return (
    <nav
      className="pb-safe fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#1a1122]/95 pt-2 backdrop-blur-lg md:hidden"
      aria-label="Bottom navigation"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-3">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className={`flex flex-col items-center gap-1 transition-colors ${isHome ? 'text-primary' : 'text-slate-400'}`}
        >
          <span className={`material-symbols-outlined ${isHome ? 'fill-1' : ''}`}>grid_view</span>
          <span className="text-[10px] font-bold uppercase">Home</span>
        </button>
        <button
          type="button"
          onClick={navToJobs}
          className={`flex flex-col items-center gap-1 transition-colors ${isJobs ? 'text-primary' : 'text-slate-400'}`}
        >
          <span className={`material-symbols-outlined ${isJobs ? 'fill-1' : ''}`}>assignment</span>
          <span className="text-[10px] font-bold uppercase">Jobs</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className={`flex flex-col items-center gap-1 transition-colors ${isStock ? 'text-primary' : 'text-slate-400'}`}
        >
          <span className={`material-symbols-outlined ${isStock ? 'fill-1' : ''}`}>
            inventory_2
          </span>
          <span className="text-[10px] font-bold uppercase">Stock</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('scanner')}
          className={`flex flex-col items-center gap-1 transition-colors ${isScanner ? 'text-primary' : 'text-slate-400'}`}
        >
          <span className={`material-symbols-outlined ${isScanner ? 'fill-1' : ''}`}>
            qr_code_scanner
          </span>
          <span className="text-[10px] font-bold uppercase">Scan</span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNavigation;
