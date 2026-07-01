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
  onBack?: () => void;
  onUpdateJob: (jobId: string, data: Partial<Job>) => Promise<Job | null>;
  onUpdateInventoryItem: (
    id: string,
    data: Partial<InventoryItem>
  ) => Promise<InventoryItem | null>;
  onCreateInventory: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onRefreshJobs: () => Promise<void>;
  onRefreshInventory: () => Promise<void>;
  isAdmin?: boolean;
}

/**
 * Full-screen scanner tab: scan job codes, inventory, or bin locations.
 * When a bin is scanned, shows full bin results (list, remove, add job to bin) like Dashboard.
 */
const ScannerScreen: React.FC<ScannerScreenProps> = ({
  jobs,
  inventory,
  onNavigate,
  onBack,
  onUpdateJob,
  onUpdateInventoryItem,
  onCreateInventory,
  onRefreshJobs,
  onRefreshInventory,
  isAdmin = false,
}) => {
  const { showToast } = useToast();
  const [scannedBinLocation, setScannedBinLocation] = useState<string | null>(null);
  const [addingToBin, setAddingToBin] = useState(false);

  const handleScanComplete = (scannedData: string) => {
    const trimmed = scannedData.trim();

    if (addingToBin && scannedBinLocation) {
      const invItem = inventory.find((i) => i.id === trimmed || i.barcode === trimmed);
      const job = jobs.find((j) => j.id === trimmed || j.jobCode?.toString() === trimmed);
      if (invItem && invItem.category === 'tool') {
        showToast('Use tool check-in to place a tool in a bin', 'warning');
      } else if (invItem) {
        onUpdateInventoryItem(invItem.id, { binLocation: scannedBinLocation })
          .then(() => {
            showToast(`${invItem.name} added to bin ${scannedBinLocation}`, 'success');
            return onRefreshInventory();
          })
          .then(() => setAddingToBin(false))
          .catch(() => showToast('Failed to add to bin', 'error'));
      } else if (job) {
        onUpdateJob(job.id, { binLocation: scannedBinLocation })
          .then(() => {
            showToast(`Job #${job.jobCode} added to bin ${scannedBinLocation}`, 'success');
            return onRefreshJobs();
          })
          .then(() => setAddingToBin(false))
          .catch(() => showToast('Failed to add to bin', 'error'));
      } else {
        showToast('Scan a job or inventory code to add to this bin', 'warning');
      }
      return;
    }

    const inventoryItem = inventory.find((item) => item.id === trimmed || item.barcode === trimmed);
    const job = jobs.find((j) => j.id === trimmed || j.jobCode?.toString() === trimmed);

    if (inventoryItem) {
      // Tools are inventory items in the 'tool' category — route them to the tag-in/out hub.
      if (inventoryItem.category === 'tool') {
        showToast(`Found tool: ${inventoryItem.name}`, 'success');
        onNavigate('tools', inventoryItem.id);
      } else {
        showToast(`Found inventory: ${inventoryItem.name}`, 'success');
        onNavigate('inventory-detail', inventoryItem.id);
      }
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

  if (scannedBinLocation && !addingToBin) {
    return (
      <BinResultsView
        binLocation={scannedBinLocation}
        jobs={jobs}
        inventory={inventory}
        onUpdateJob={onUpdateJob}
        onUpdateInventoryItem={onUpdateInventoryItem}
        onCreateInventory={onCreateInventory}
        onRefreshJobs={onRefreshJobs}
        onRefreshInventory={onRefreshInventory}
        onNavigate={onNavigate}
        onClose={() => setScannedBinLocation(null)}
        onAddByScan={() => setAddingToBin(true)}
        isAdmin={isAdmin}
      />
    );
  }

  if (addingToBin && scannedBinLocation) {
    return (
      <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
        <header className="safe-area-top flex shrink-0 items-center justify-between border-b border-line bg-background-dark/95 px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setAddingToBin(false)}
            className="flex size-11 min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Back to bin"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="app-section-title text-white">Add to bin {scannedBinLocation}</h1>
          <div className="size-11" aria-hidden />
        </header>
        <div className="min-h-0 flex-1">
          <QRScanner
            scanType="any"
            onScanComplete={handleScanComplete}
            onClose={() => setAddingToBin(false)}
            title="Scan to add to bin"
            description="Scan a job or inventory code to assign to this bin"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background-dark">
      <header className="safe-area-top flex shrink-0 items-center justify-between border-b border-line bg-background-dark/95 px-3 py-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : onNavigate('dashboard'))}
          className="flex size-11 min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Back to home"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="app-section-title text-white">Scan</h1>
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
