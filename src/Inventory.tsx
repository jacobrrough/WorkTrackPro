import React, { useEffect, useState } from 'react';
import { InventoryItem, Job, ViewState } from '@/core/types';
import { useNavigation } from '@/contexts/NavigationContext';
import InventoryDetail from './InventoryDetail';
import AddInventoryItem from './AddInventoryItem';

import InventoryMainView from '@/features/inventory/InventoryMainView';
import InventoryHub from '@/features/inventory/InventoryHub';
import type { InventoryFilters, InventoryTab } from '@/features/inventory/inventoryViewModel';

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
  onSetImage: (id: string, file: File) => Promise<InventoryItem | null>;
  onRemoveImage: (id: string) => Promise<InventoryItem | null>;
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
  isLoading?: boolean;
  initialItemId?: string;
  onBackFromDetail?: () => void;
  /** Which sub-view to open initially. The /app/allparts deep link passes 'main'. Defaults 'hub'. */
  initialView?: 'hub' | 'main';
}

type InventoryView = 'hub' | 'main' | 'add';

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
  onSetImage,
  onRemoveImage,
  onReloadInventory,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
  onAllocateToJob,
  isLoading = false,
  initialItemId,
  onBackFromDetail,
  initialView = 'hub',
}) => {
  const { state: navState, updateState } = useNavigation();
  const [view, setView] = useState<InventoryView>(initialView);
  const [filters, setFilters] = useState<InventoryFilters>({
    search: navState.inventorySearchTerm ?? '',
    category: (navState.inventoryCategory as InventoryFilters['category']) ?? 'all',
    supplier: navState.inventorySupplier ?? 'all',
  });

  const selectedItem = initialItemId ? inventory.find((i) => i.id === initialItemId) : null;
  const showingDetail = !!initialItemId && !!selectedItem;

  // Track recently-viewed items (most-recent first) for the hub's Recent Items list. Runs whenever
  // a detail opens (deep link, hub, or list) since all paths set initialItemId via routing.
  useEffect(() => {
    if (!initialItemId) return;
    const prev = navState.inventoryRecentIds ?? [];
    if (prev[0] === initialItemId) return;
    updateState({
      inventoryRecentIds: [initialItemId, ...prev.filter((id) => id !== initialItemId)].slice(0, 8),
    });
  }, [initialItemId, navState.inventoryRecentIds, updateState]);

  const handleBack = () => {
    if (showingDetail && onBackFromDetail) {
      onBackFromDetail();
    } else {
      setView('hub');
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
      setView('hub');
      return true;
    }
    return false;
  };

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
        onSetImage={onSetImage}
        onRemoveImage={onRemoveImage}
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

  if (view === 'add') {
    return <AddInventoryItem onAdd={handleAddComplete} onCancel={handleBack} isAdmin={isAdmin} />;
  }

  if (view === 'hub') {
    return (
      <InventoryHub
        inventory={inventory}
        isLoading={isLoading}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
        onUpdateStock={onUpdateStock}
        onAddItem={handleAddItem}
        onViewAll={(tab?: InventoryTab) => {
          if (tab) updateState({ inventoryTab: tab });
          setView('main');
        }}
        onOpenDetail={(itemId) => onNavigate('inventory-detail', itemId)}
        onBack={() => onNavigate('dashboard')}
        recentIds={navState.inventoryRecentIds ?? []}
      />
    );
  }

  return (
    <InventoryMainView
      inventory={inventory}
      isLoading={isLoading}
      onBack={() => setView('hub')}
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
      onOpenDetail={(itemId) => onNavigate('inventory-detail', itemId)}
      calculateAvailable={calculateAvailable}
      calculateAllocated={calculateAllocated}
    />
  );
};

export default Inventory;
