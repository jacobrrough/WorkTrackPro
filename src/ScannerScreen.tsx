import React, { useState } from 'react';
import { ViewState } from '@/core/types';
import { useToast } from './Toast';
import QRScanner from './components/QRScanner';
import BinResultsView from './components/BinResultsView';
import type { Job } from '@/core/types';
import type { InventoryItem } from '@/core/types';

interface ScannerScreenProps {
  jobs: Job[];
  inventory: InventoryItem[];
  onNavigate: (view: ViewState, id?: string) => void;
  onUpdateJob: (jobId: string, data: Partial<Job>) => Promise<Job | null>;
  onUpdateInventoryItem: (
    id: string,
    data: Partial<InventoryItem>
  ) => Promise<InventoryItem | null>;
  onRefreshJobs: () => Promise<void>;
  onRefreshInventory: () => Promise<void>;
}

/**
 * Full-screen scanner tab: scan job codes, inventory, or bin locations.
 * When a bin is scanned, shows full bin results (list, remove, add job to bin) like Dashboard.
 */
const ScannerScreen: React.FC<ScannerScreenProps> = ({
  jobs,
  inventory,
  onNavigate,
  onUpdateJob,
  onUpdateInventoryItem,
  onRefreshJobs,
  onRefreshInventory,
}) => {
  const { showToast } = useToast();
  const [scannedBinLocation, setScannedBinLocation] = useState<string | null>(null);
  const [addingJobToBin, setAddingJobToBin] = useState(false);

  const handleScanComplete = (scannedData: string) => {
    const trimmed = scannedData.trim();

    if (addingJobToBin && scannedBinLocation) {
      const job = jobs.find((j) => j.id === trimmed || j.jobCode?.toString() === trimmed);
      if (job) {
        onUpdateJob(job.id, { binLocation: scannedBinLocation })
          .then(() => {
            showToast(`Job #${job.jobCode} added to bin ${scannedBinLocation}`, 'success');
            return onRefreshJobs();
          })
          .then(() => setAddingJobToBin(false))
          .catch(() => showToast('Failed to add job to bin', 'error'));
      } else {
        showToast('Scan a job code to add to this bin', 'warning');
      }
      return;
    }

    const inventoryItem = inventory.find((item) => item.id === trimmed || item.barcode === trimmed);
    const job = jobs.find((j) => j.id === trimmed || j.jobCode?.toString() === trimmed);

    if (inventoryItem) {
      showToast(`Found inventory: ${inventoryItem.name}`, 'success');
      onNavigate('inventory-detail', inventoryItem.id);
    } else if (job) {
      showToast(`Found job: ${job.jobCode}`, 'success');
      onNavigate('job-detail', job.id);
    } else {
      const binMatch = /^[A-Z]\d+[a-z]$/.test(trimmed);
      if (binMatch) {
        setScannedBinLocation(trimmed);
      } else {
        showToast(`Scanned: ${trimmed} (not found)`, 'warning');
      }
    }
  };

  if (scannedBinLocation && !addingJobToBin) {
    return (
      <BinResultsView
        binLocation={scannedBinLocation}
        jobs={jobs}
        inventory={inventory}
        onUpdateJob={onUpdateJob}
        onUpdateInventoryItem={onUpdateInventoryItem}
        onRefreshJobs={onRefreshJobs}
        onRefreshInventory={onRefreshInventory}
        onNavigate={onNavigate}
        onClose={() => setScannedBinLocation(null)}
        onAddJobToBin={() => setAddingJobToBin(true)}
      />
    );
  }

  if (addingJobToBin && scannedBinLocation) {
    return (
      <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
        <header className="safe-area-top flex shrink-0 items-center justify-between border-b border-white/10 bg-background-dark/95 px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setAddingJobToBin(false)}
            className="flex size-11 min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Back to bin"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-white">Add job to bin {scannedBinLocation}</h1>
          <div className="size-11" aria-hidden />
        </header>
        <div className="min-h-0 flex-1">
          <QRScanner
            scanType="any"
            onScanComplete={handleScanComplete}
            onClose={() => setAddingJobToBin(false)}
            title="Scan job to add to bin"
            description="Scan a job code to assign to this bin"
          />
        </div>
      </div>
    );
  }

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
