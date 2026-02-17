import React, { memo } from 'react';
import { ViewState } from '@/core/types';

interface BottomNavigationProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  isAdmin?: boolean;
}

interface NavItem {
  view: ViewState;
  icon: string;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'dashboard', icon: 'home', label: 'Home' },
  { view: 'board-shop', icon: 'view_kanban', label: 'Jobs' },
  { view: 'inventory', icon: 'inventory_2', label: 'Inventory' },
  { view: 'time-reports', icon: 'schedule', label: 'Time' },
];

// Memoize to prevent re-renders when parent state changes
export const BottomNavigation: React.FC<BottomNavigationProps> = memo(
  ({ currentView, onNavigate, isAdmin = false }) => {
    // Determine which view is "active" for highlighting
    const getActiveView = (): ViewState => {
      // Map related views to their parent nav item
      const viewMappings: Partial<Record<ViewState, ViewState>> = {
        'job-detail': 'board-shop',
        'board-admin': 'board-shop',
        'admin-create-job': 'board-shop',
        'inventory-detail': 'inventory',
        'add-inventory': 'inventory',
        'needs-ordering': 'inventory',
        'clock-in': 'dashboard',
        'admin-console': 'dashboard',
      };
      return viewMappings[currentView] || currentView;
    };

    const activeView = getActiveView();

    return (
      <nav
        className="safe-area-pb border-t border-white/10 bg-background-dark px-2 py-3"
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Responsive max-width to match app container */}
        <div className="mx-auto flex max-w-md items-center justify-around md:max-w-2xl lg:max-w-4xl xl:max-w-6xl">
          {NAV_ITEMS.map((item) => {
            if (item.adminOnly && !isAdmin) return null;

            const isActive = activeView === item.view;

            return (
              <button
                key={item.view}
                onClick={() => onNavigate(item.view)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate(item.view);
                  }
                }}
                className={`flex flex-col items-center gap-1 rounded-lg px-3 py-1 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background-dark md:px-6 ${
                  isActive ? 'text-primary' : 'text-slate-400 hover:text-white active:scale-95'
                } `}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="material-symbols-outlined text-2xl">{item.icon}</span>
                <span className="text-[10px] font-medium md:text-xs">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }
);

BottomNavigation.displayName = 'BottomNavigation';

export default BottomNavigation;
