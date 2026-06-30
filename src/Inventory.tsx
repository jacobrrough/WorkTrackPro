import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { InventoryItem, Job, ViewState } from '@/core/types';
import type { DeleteInventoryResult } from '@/services/api/inventory';
import { useNavigation } from '@/contexts/NavigationContext';
import InventoryDetail from './InventoryDetail';
import AddInventoryItem from './AddInventoryItem';

import InventoryMainView from '@/features/inventory/InventoryMainView';
import InventoryHub from '@/features/inventory/InventoryHub';
import StockAdjustFlow, { type StockAdjustFlowMode } from '@/features/inventory/StockAdjustFlow';
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
  onDeleteItem: (id: string) => Promise<DeleteInventoryResult>;
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
  /**
   * The item fetched directly by the detail route (getByIds). Lets a deep link render
   * the detail even when the global `inventory` list hasn't loaded yet — or omits the
   * item — without seeding it into the shared list. The list entry, when present, is
   * preferred since inventory mutations keep it current; this is the fallback.
   */
  initialItem?: InventoryItem | null;
  onBackFromDetail?: () => void;
  /** Which sub-view to open initially. The /app/inventory/allparts deep link passes 'main'. Default 'hub'. */
  initialView?: 'hub' | 'main';
}

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
  onDeleteItem,
  onReloadInventory,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
  onAllocateToJob,
  isLoading = false,
  initialItemId,
  initialItem,
  onBackFromDetail,
  initialView = 'hub',
}) => {
  const { state: navState, updateState } = useNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<InventoryFilters>({
    search: navState.inventorySearchTerm ?? '',
    category: (navState.inventoryCategory as InventoryFilters['category']) ?? 'all',
    supplier: navState.inventorySupplier ?? 'all',
  });

  // Sub-views (add / all-parts list / stock-adjust flows) are driven off a `?view=`
  // search param rather than local state. Opening one pushes a real history entry, so
  // the browser/hardware back button collapses the sub-view back to the hub instead of
  // leaving inventory entirely for /app. The /app/inventory/allparts route has no param
  // and falls back to initialView='main'.
  const viewParam = searchParams.get('view');
  const showAdd = viewParam === 'add';
  const showMain = viewParam === 'all' || (initialView === 'main' && !viewParam);
  const flowMode: StockAdjustFlowMode | null =
    viewParam === 'in' ? 'in' : viewParam === 'out' ? 'out' : null;

  // Open a sub-view: push a `?view=` entry so back returns to the hub.
  const openView = (param: string) => setSearchParams({ view: param });
  // Close a sub-view, returning to the underlying view by dropping the `?view=` param
  // (replace, so we don't stack a second entry). That lands on the hub for /app/inventory,
  // or back on the All-Parts list for the /app/inventory/allparts route (where the user
  // launched the sub-view from). Only that standalone route reaches the else branch (no
  // param to drop), so navigate to the hub.
  const closeSubView = () => {
    if (viewParam) {
      setSearchParams({}, { replace: true });
    } else {
      navigate('/app/inventory');
    }
  };

  // Prefer the live list entry (mutations keep it current); fall back to the
  // directly-fetched item so a deep link still renders when the item isn't in the
  // loaded list.
  const selectedItem = initialItemId
    ? (inventory.find((i) => i.id === initialItemId) ??
      (initialItem?.id === initialItemId ? initialItem : null))
    : null;
  const showingDetail = !!initialItemId && !!selectedItem;

  const handleBack = () => {
    if (showingDetail && onBackFromDetail) {
      onBackFromDetail();
    } else {
      closeSubView();
    }
  };

  const handleAddComplete = async (data: Partial<InventoryItem>) => {
    const payload = { ...data };
    if (!isAdmin && 'price' in payload) {
      delete (payload as Record<string, unknown>).price;
    }
    const newItem = await onCreateItem(payload);
    if (newItem) {
      closeSubView();
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
        onDeleteItem={onDeleteItem}
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

  if (showAdd) {
    return <AddInventoryItem onAdd={handleAddComplete} onCancel={handleBack} isAdmin={isAdmin} />;
  }

  if (showMain) {
    return (
      <InventoryMainView
        inventory={inventory}
        isLoading={isLoading}
        onBack={closeSubView}
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
        onAddItem={() => openView('add')}
        onOpenDetail={(itemId) => onNavigate('inventory-detail', itemId)}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
      />
    );
  }

  return (
    <>
      <InventoryHub
        inventory={inventory}
        isLoading={isLoading}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
        onAddItem={() => openView('add')}
        onViewAll={(tab?: InventoryTab) => {
          // Browsing via a tile/stat is an unfiltered-browse intent, so drop any search the
          // user left active in the All Parts list earlier (it's persisted in nav state). Without
          // this the leftover term silently filters the tab down to "no matches".
          setFilters((prev) => ({ ...prev, search: '' }));
          updateState({ inventoryTab: tab ?? 'allParts', inventorySearchTerm: '' });
          openView('all');
        }}
        onOpenFlow={(mode) => openView(mode)}
        onOpenDetail={(itemId) => onNavigate('inventory-detail', itemId)}
        onBack={() => onNavigate('dashboard')}
      />
      {flowMode && (
        <StockAdjustFlow
          mode={flowMode}
          inventory={inventory}
          onUpdateStock={onUpdateStock}
          onClose={closeSubView}
          calculateAvailable={calculateAvailable}
        />
      )}
    </>
  );
};

export default Inventory;
