import React, { useState } from 'react';
import { InventoryItem, Job, ViewState } from '@/core/types';
import { useNavigation } from '@/contexts/NavigationContext';
import InventoryDetail from './InventoryDetail';
import AddInventoryItem from './AddInventoryItem';
import { useToast } from './Toast';
import InventoryMainView from '@/features/inventory/InventoryMainView';
import type { InventoryFilters } from '@/features/inventory/inventoryViewModel';

interface InventoryProps {
  inventory: InventoryItem[];
  jobs: Job[];
  onNavigate: (view: ViewState, id?: string) => void;
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onUpdateItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onCreateItem: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onMarkOrdered: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  onReceiveOrder: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  onAddAttachment: (inventoryId: string, file: File, isAdminOnly?: boolean) => Promise<boolean>;
  onDeleteAttachment: (attachmentId: string, inventoryId: string) => Promise<boolean>;
  onReloadInventory?: () => Promise<void>;
  isAdmin: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  onAllocateToJob: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    notes?: string
  ) => Promise<boolean>;
  initialItemId?: string;
  onBackFromDetail?: () => void;
}

type InventoryView = 'main' | 'add';

const Inventory: React.FC<InventoryProps> = ({
  inventory,
  jobs,
  onNavigate,
  onUpdateStock,
  onUpdateItem,
  onCreateItem,
  onMarkOrdered: _onMarkOrdered,
  onReceiveOrder: _onReceiveOrder,
  onAddAttachment,
  onDeleteAttachment,
  onReloadInventory,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
  onAllocateToJob,
  initialItemId,
  onBackFromDetail,
}) => {
  const { showToast } = useToast();
  const { state: navState, updateState } = useNavigation();
  const [view, setView] = useState<InventoryView>('main');
  const [filters, setFilters] = useState<InventoryFilters>({
    search: navState.inventorySearchTerm ?? '',
    category: 'all',
    supplier: 'all',
  });

  const selectedItem = initialItemId ? inventory.find((i) => i.id === initialItemId) : null;
  const showingDetail = !!initialItemId && !!selectedItem;

  const handleBack = () => {
    if (showingDetail && onBackFromDetail) {
      onBackFromDetail();
    } else {
      setView('main');
    }
  };

  const handleAddItem = () => {
    if (!isAdmin) {
      showToast('Only admins can add inventory items', 'error');
      return;
    }
    setView('add');
  };

  const handleAddComplete = async (data: Partial<InventoryItem>) => {
    if (!isAdmin) {
      showToast('Only admins can add inventory items', 'error');
      setView('main');
      return false;
    }
    const newItem = await onCreateItem(data);
    if (newItem) {
      setView('main');
      return true;
    }
    return false;
  };

  if (view === 'add') {
    return <AddInventoryItem onAdd={handleAddComplete} onCancel={handleBack} />;
  }

  if (showingDetail && selectedItem) {
    return (
      <InventoryDetail
        item={selectedItem}
        onNavigate={onNavigate}
        onBack={onBackFromDetail ?? handleBack}
        onUpdateStock={onUpdateStock}
        onUpdateItem={onUpdateItem}
        onAddAttachment={onAddAttachment}
        onDeleteAttachment={onDeleteAttachment}
        onReloadItem={onReloadInventory}
        isAdmin={isAdmin}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
        jobs={jobs}
      />
    );
  }

  return (
    <InventoryMainView
      inventory={inventory}
      jobs={jobs}
      isAdmin={isAdmin}
      onBack={() => onNavigate('dashboard')}
      filters={filters}
      onFiltersChange={(patch) => {
        const next = { ...filters, ...patch };
        setFilters(next);
        if (patch.search !== undefined) {
          updateState({ inventorySearchTerm: patch.search });
        }
      }}
      onAddItem={handleAddItem}
      onOpenDetail={(itemId) => onNavigate('inventory-detail', itemId)}
      onQuickAdjust={async (item, delta) => {
        await onUpdateStock(
          item.id,
          Math.max(0, item.inStock + delta),
          delta > 0 ? 'Quick add from inventory list' : 'Quick subtract from inventory list'
        );
      }}
      onAllocateToJob={onAllocateToJob}
      calculateAvailable={calculateAvailable}
      calculateAllocated={calculateAllocated}
    />
  );
};

export default Inventory;
