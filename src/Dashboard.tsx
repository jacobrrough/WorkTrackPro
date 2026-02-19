import React, { lazy, Suspense, useState } from 'react';
import { useApp } from './AppContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { ViewState } from '@/core/types';
import { useToast } from './Toast';
import { SkipLink } from './components/SkipLink';

const QRScanner = lazy(() => import('./components/QRScanner'));

interface DashboardQuickAction {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  iconClassName: string;
  cardClassName: string;
  ariaLabel: string;
  onClick: () => void;
  adminOnly?: boolean;
}

interface DashboardProps {
  onNavigate: (view: ViewState, id?: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const { currentUser, jobs, inventory, logout } = useApp();
  const { showToast } = useToast();
  const isAdmin = currentUser?.isAdmin ?? false;
  const { state: navState, updateState } = useNavigation();
  const [searchInput, setSearchInput] = useState(navState.searchTerm);
  const [showScanner, setShowScanner] = useState(false);

  const activeCount = jobs.filter((j) => j.status === 'inProgress').length;
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateState({ searchTerm: searchInput.trim() });
    onNavigate('board-shop');
  };

  const handleScanComplete = (scannedData: string) => {
    setShowScanner(false);

    // Try to match scanned code to inventory or job
    const inventoryItem = inventory.find(
      (item) => item.id === scannedData || item.barcode === scannedData
    );
    const job = jobs.find((j) => j.id === scannedData || j.jobCode.toString() === scannedData);

    if (inventoryItem) {
      showToast(`Found inventory: ${inventoryItem.name}`, 'success');
      onNavigate('inventory-detail', inventoryItem.id);
    } else if (job) {
      showToast(`Found job: ${job.jobCode}`, 'success');
      onNavigate('job-detail', job.id);
    } else {
      // Check if it's a bin location format
      const binMatch = /^[A-Z]\d+[a-z]$/.test(scannedData);
      if (binMatch) {
        showToast(`Scanned bin location: ${scannedData}`, 'info');
        // Could navigate to a bin location search view or show items at that bin
        // For now, just show toast
      } else {
        showToast(`Scanned: ${scannedData} (not found)`, 'warning');
      }
    }
  };

  const quickActionButtonBaseClassName =
    'flex min-h-[7.25rem] w-full touch-manipulation flex-col items-start gap-3 rounded-sm border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:opacity-90';

  const quickActions: DashboardQuickAction[] = [
    {
      key: 'board-shop',
      title: 'Shop Floor',
      subtitle: `${activeCount} active · ${pendingCount} pending`,
      icon: 'view_kanban',
      iconClassName: 'text-blue-500',
      cardClassName: 'border-blue-500/30 bg-gradient-to-br from-blue-600/20 to-cyan-600/20',
      ariaLabel: 'Open shop floor board',
      onClick: () => onNavigate('board-shop'),
    },
    {
      key: 'inventory',
      title: 'Inventory',
      subtitle: 'Stock & ordering',
      icon: 'inventory_2',
      iconClassName: 'text-primary',
      cardClassName: 'border-primary/30 bg-gradient-to-br from-primary/20 to-purple-600/20',
      ariaLabel: 'Open inventory',
      onClick: () => onNavigate('inventory'),
    },
    {
      key: 'scan',
      title: 'Scan',
      subtitle: 'QR Code',
      icon: 'qr_code_scanner',
      iconClassName: 'text-amber-500',
      cardClassName: 'border-amber-500/30 bg-gradient-to-br from-amber-600/20 to-orange-600/20',
      ariaLabel: 'Open QR scanner',
      onClick: () => setShowScanner(true),
    },
    {
      key: 'create-job',
      title: 'New Job',
      subtitle: 'Create job',
      icon: 'add_circle',
      iconClassName: 'text-green-500',
      cardClassName: 'border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20',
      ariaLabel: 'Create a new job',
      onClick: () => onNavigate('create-job'),
      adminOnly: true,
    },
    {
      key: 'calendar',
      title: 'Calendar',
      subtitle: 'Job timeline',
      icon: 'calendar_month',
      iconClassName: 'text-cyan-500',
      cardClassName: 'border-cyan-500/30 bg-gradient-to-br from-cyan-600/20 to-blue-600/20',
      ariaLabel: 'Open calendar',
      onClick: () => onNavigate('calendar'),
    },
    {
      key: 'parts',
      title: 'Parts',
      subtitle: 'Parts repository',
      icon: 'precision_manufacturing',
      iconClassName: 'text-emerald-500',
      cardClassName: 'border-emerald-500/30 bg-gradient-to-br from-emerald-600/20 to-teal-600/20',
      ariaLabel: 'Open parts repository',
      onClick: () => onNavigate('parts'),
    },
    {
      key: 'board-admin',
      title: 'Admin Board',
      subtitle: 'Kanban view',
      icon: 'view_kanban',
      iconClassName: 'text-orange-500',
      cardClassName: 'border-orange-500/30 bg-gradient-to-br from-orange-600/20 to-red-600/20',
      ariaLabel: 'Open admin board',
      onClick: () => onNavigate('board-admin'),
      adminOnly: true,
    },
    {
      key: 'time-reports',
      title: 'Time Reports',
      subtitle: 'View hours',
      icon: 'analytics',
      iconClassName: 'text-green-500',
      cardClassName: 'border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20',
      ariaLabel: 'Open time reports',
      onClick: () => onNavigate('time-reports'),
      adminOnly: true,
    },
    {
      key: 'admin-settings',
      title: 'Settings',
      subtitle: 'Labor rate & upcharge',
      icon: 'settings',
      iconClassName: 'text-slate-400',
      cardClassName: 'border-slate-500/30 bg-gradient-to-br from-slate-600/20 to-slate-700/20',
      ariaLabel: 'Open admin settings',
      onClick: () => onNavigate('admin-settings'),
      adminOnly: true,
    },
    {
      key: 'trello-import',
      title: 'Import Trello',
      subtitle: 'From JSON',
      icon: 'upload_file',
      iconClassName: 'text-purple-500',
      cardClassName: 'border-purple-500/30 bg-gradient-to-br from-purple-600/20 to-pink-600/20',
      ariaLabel: 'Open Trello import',
      onClick: () => onNavigate('trello-import'),
      adminOnly: true,
    },
  ];

  const visibleQuickActions = quickActions.filter((action) => isAdmin || !action.adminOnly);

  return (
    <div className="flex h-[100dvh] min-h-0 min-h-screen flex-col bg-background-dark">
      <SkipLink />
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/20">
            <span aria-hidden="true" className="material-symbols-outlined text-primary">
              person
            </span>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {isAdmin ? 'Administrator' : 'User'}
            </p>
            <p className="text-sm font-semibold text-white">
              {currentUser?.name || currentUser?.email || '—'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex size-11 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Log out"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            logout
          </span>
        </button>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="dashboard-heading"
        className="min-h-0 flex-1 overflow-y-auto p-4"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'max(6rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <h1 id="dashboard-heading" className="sr-only">
          Dashboard
        </h1>

        <form onSubmit={handleSearchSubmit} className="mb-4" role="search" aria-label="Search jobs">
          <label htmlFor="dashboard-search" className="sr-only">
            Search jobs, PO, description, bin location, or status
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            >
              search
            </span>
            <input
              id="dashboard-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search jobs, PO, description, bin, status..."
              className="w-full rounded-sm border border-white/10 bg-[#261a32] py-2.5 pl-10 pr-3 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search"
            />
          </div>
        </form>

        <section aria-labelledby="quick-actions-heading">
          <h2
            id="quick-actions-heading"
            className="mb-4 text-lg font-bold tracking-tight text-white"
          >
            Quick Actions
          </h2>
          <ul className="grid grid-cols-2 gap-3" role="list">
            {visibleQuickActions.map((action) => (
              <li key={action.key} className="min-w-0">
                <button
                  type="button"
                  onClick={action.onClick}
                  className={`${quickActionButtonBaseClassName} ${action.cardClassName}`}
                  aria-label={action.ariaLabel}
                >
                  <span
                    aria-hidden="true"
                    className={`material-symbols-outlined text-3xl ${action.iconClassName}`}
                  >
                    {action.icon}
                  </span>
                  <div>
                    <p className="font-bold text-white">{action.title}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                      {action.subtitle}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* QR Scanner Modal */}
      {showScanner && (
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black"
            >
              <p className="text-sm text-slate-200">Opening scanner...</p>
            </div>
          }
        >
          <QRScanner
            scanType="any"
            onScanComplete={handleScanComplete}
            onClose={() => setShowScanner(false)}
            title="Scan QR Code"
            description="Scan inventory, job, or bin location QR code"
          />
        </Suspense>
      )}
    </div>
  );
};

export default Dashboard;
