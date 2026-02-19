import React, { useState } from 'react';
import { useApp } from './AppContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { ViewState } from '@/core/types';
import QRScanner from './components/QRScanner';
import { useToast } from './Toast';

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

  return (
    <div className="flex min-h-screen h-[100dvh] min-h-0 flex-col bg-background-dark">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/20">
            <span className="material-symbols-outlined text-primary">person</span>
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
          className="flex size-10 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Log out"
        >
          <span className="material-symbols-outlined">logout</span>
        </button>
      </header>

      <main
        className="min-h-0 flex-1 overflow-y-auto p-4"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'max(6rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <form onSubmit={handleSearchSubmit} className="mb-4">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              search
            </span>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search jobs, PO, description, bin, status..."
              className="w-full rounded-sm border border-white/10 bg-[#261a32] py-2.5 pl-10 pr-3 text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search"
            />
          </div>
        </form>

        <h3 className="mb-4 text-lg font-bold tracking-tight text-white">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onNavigate('board-shop')}
            className="flex flex-col items-start gap-3 rounded-sm border border-blue-500/30 bg-gradient-to-br from-blue-600/20 to-cyan-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-blue-500">view_kanban</span>
            <div>
              <p className="font-bold text-white">Shop Floor</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                {activeCount} active · {pendingCount} pending
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="flex flex-col items-start gap-3 rounded-sm border border-primary/30 bg-gradient-to-br from-primary/20 to-purple-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-primary">inventory_2</span>
            <div>
              <p className="font-bold text-white">Inventory</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Stock & ordering
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setShowScanner(true)}
            className="flex flex-col items-start gap-3 rounded-sm border border-amber-500/30 bg-gradient-to-br from-amber-600/20 to-orange-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-amber-500">
              qr_code_scanner
            </span>
            <div>
              <p className="font-bold text-white">Scan</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                QR Code
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('create-job')}
            className="flex flex-col items-start gap-3 rounded-sm border border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-green-500">add_circle</span>
            <div>
              <p className="font-bold text-white">New Job</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Create job
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('calendar')}
            className="flex flex-col items-start gap-3 rounded-sm border border-cyan-500/30 bg-gradient-to-br from-cyan-600/20 to-blue-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-cyan-500">calendar_month</span>
            <div>
              <p className="font-bold text-white">Calendar</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Job timeline
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('parts')}
            className="flex flex-col items-start gap-3 rounded-sm border border-emerald-500/30 bg-gradient-to-br from-emerald-600/20 to-teal-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-emerald-500">
              precision_manufacturing
            </span>
            <div>
              <p className="font-bold text-white">Parts</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Parts repository
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('board-admin')}
            className="flex flex-col items-start gap-3 rounded-sm border border-orange-500/30 bg-gradient-to-br from-orange-600/20 to-red-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-orange-500">view_kanban</span>
            <div>
              <p className="font-bold text-white">Admin Board</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Kanban view
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('time-reports')}
            className="flex flex-col items-start gap-3 rounded-sm border border-green-500/30 bg-gradient-to-br from-green-600/20 to-emerald-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-green-500">analytics</span>
            <div>
              <p className="font-bold text-white">Time Reports</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                View hours
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('admin-settings')}
            className="flex flex-col items-start gap-3 rounded-sm border border-slate-500/30 bg-gradient-to-br from-slate-600/20 to-slate-700/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-slate-400">settings</span>
            <div>
              <p className="font-bold text-white">Settings</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Labor rate & upcharge
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('trello-import')}
            className="flex flex-col items-start gap-3 rounded-sm border border-purple-500/30 bg-gradient-to-br from-purple-600/20 to-pink-600/20 p-3 text-left transition-colors active:opacity-90"
          >
            <span className="material-symbols-outlined text-3xl text-purple-500">upload_file</span>
            <div>
              <p className="font-bold text-white">Import Trello</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                From JSON
              </p>
            </div>
          </button>
        </div>
      </main>

      {/* QR Scanner Modal */}
      {showScanner && (
        <QRScanner
          scanType="any"
          onScanComplete={handleScanComplete}
          onClose={() => setShowScanner(false)}
          title="Scan QR Code"
          description="Scan inventory, job, or bin location QR code"
        />
      )}
    </div>
  );
};

export default Dashboard;
