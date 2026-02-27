import React from 'react';
import { ViewState } from '@/core/types';
import { useToast } from './Toast';
import QRScanner from './components/QRScanner';
import type { Job } from '@/core/types';
import type { InventoryItem } from '@/core/types';

interface ScannerScreenProps {
  jobs: Job[];
  inventory: InventoryItem[];
  onNavigate: (view: ViewState, id?: string) => void;
}

/**
 * Full-screen scanner tab: scan job codes, inventory, or bin locations.
 * Same scan behavior as Dashboard quick action.
 */
const ScannerScreen: React.FC<ScannerScreenProps> = ({ jobs, inventory, onNavigate }) => {
  const { showToast } = useToast();

  const handleScanComplete = (scannedData: string) => {
    const inventoryItem = inventory.find(
      (item) => item.id === scannedData || item.barcode === scannedData
    );
    const job = jobs.find((j) => j.id === scannedData || j.jobCode?.toString() === scannedData);

    if (inventoryItem) {
      showToast(`Found inventory: ${inventoryItem.name}`, 'success');
      onNavigate('inventory-detail', inventoryItem.id);
    } else if (job) {
      showToast(`Found job: ${job.jobCode}`, 'success');
      onNavigate('job-detail', job.id);
    } else {
      const binMatch = /^[A-Z]\d+[a-z]$/.test(scannedData);
      if (binMatch) {
        showToast(`Scanned bin location: ${scannedData}`, 'info');
      } else {
        showToast(`Scanned: ${scannedData} (not found)`, 'warning');
      }
    }
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <header className="safe-area-top flex shrink-0 items-center justify-between border-b border-white/10 bg-background-dark/95 px-3 py-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="flex size-11 min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Back to home"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="text-lg font-bold text-white">Scan</h1>
        <div className="size-11" aria-hidden />
      </header>
      <div className="min-h-0 flex-1">
        <QRScanner
          scanType="any"
          onScanComplete={handleScanComplete}
          onClose={() => onNavigate('dashboard')}
          title="Scan QR Code"
          description="Scan job, inventory, or bin location"
        />
      </div>
    </div>
  );
};

export default ScannerScreen;
