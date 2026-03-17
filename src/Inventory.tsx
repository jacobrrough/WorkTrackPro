import React, { useState } from 'react';
import { InventoryItem, Job, ViewState } from '@/core/types';
import { useNavigation } from '@/contexts/NavigationContext';
import InventoryDetail from './InventoryDetail';
import AddInventoryItem from './AddInventoryItem';
import InventoryKanban from './InventoryKanban';
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
  onMarkOrdered,
  onReceiveOrder,
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
  const listView = navState.inventoryListView ?? 'list';
  const setListView = (mode: 'list' | 'kanban') => updateState({ inventoryListView: mode });
  const [filters, setFilters] = useState<InventoryFilters>({
    search: navState.inventorySearchTerm ?? '',
    category: (navState.inventoryCategory as InventoryFilters['category']) ?? 'all',
    supplier: navState.inventorySupplier ?? 'all',
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
    setView('add');
  };

  const handleAddComplete = async (data: Partial<InventoryItem>) => {
    const payload = { ...data };
    if (!isAdmin && 'price' in payload) {
      delete (payload as Record<string, unknown>).price;
    }
    const newItem = await onCreateItem(payload);
    if (newItem) {
      setView('main');
      return true;
    }
    return false;
  };

  if (view === 'add') {
    return <AddInventoryItem onAdd={handleAddComplete} onCancel={handleBack} isAdmin={isAdmin} />;
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
        onMarkOrdered={onMarkOrdered}
        onReceiveOrder={onReceiveOrder}
        onAllocateToJob={onAllocateToJob}
        isAdmin={isAdmin}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
        jobs={jobs}
      />
    );
  }

  if (listView === 'kanban') {
    return (
      <InventoryKanban
        inventory={inventory}
        onNavigate={(itemId) => onNavigate('inventory-detail', itemId)}
        onBack={() => onNavigate('dashboard')}
        onAddItem={handleAddItem}
        onUpdateItem={async (itemId, updates) => {
          const updated = await onUpdateItem(itemId, updates);
          if (updated && onReloadInventory) await onReloadInventory();
        }}
        onSwitchToList={() => setListView('list')}
        isAdmin={isAdmin}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
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
        const navPatch: Partial<{
          inventorySearchTerm: string;
          inventoryCategory: string;
          inventorySupplier: string;
        }> = {};
        if (patch.search !== undefined) navPatch.inventorySearchTerm = patch.search;
        if (patch.category !== undefined) navPatch.inventoryCategory = patch.category;
        if (patch.supplier !== undefined) navPatch.inventorySupplier = patch.supplier;
        if (Object.keys(navPatch).length) updateState(navPatch);
      }}
      onAddItem={handleAddItem}
      onCreateItem={async (data) => {
        const payload = { ...data };
        if (!isAdmin && 'price' in payload) delete (payload as Record<string, unknown>).price;
        const newItem = await onCreateItem(payload);
        if (newItem && onReloadInventory) await onReloadInventory();
        return newItem;
      }}
      onReloadInventory={onReloadInventory}
      onOpenDetail={(itemId) => onNavigate('inventory-detail', itemId)}
      onKanbanView={() => setListView('kanban')}
      onMarkOrdered={onMarkOrdered}
      onReceiveOrder={onReceiveOrder}
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
