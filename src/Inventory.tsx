import React, { useState, useEffect, useMemo } from 'react';
import { InventoryItem, ViewState, getCategoryDisplayName } from '@/core/types';
import InventoryKanban from './InventoryKanban';
import InventoryDetail from './InventoryDetail';
import AddInventoryItem from './AddInventoryItem';
import NeedsOrdering from './NeedsOrdering';

interface InventoryProps {
  inventory: InventoryItem[];
  onNavigate: (view: ViewState, id?: string) => void;
  onUpdateStock: (id: string, inStock: number, reason?: string) => Promise<void>;
  onUpdateItem: (id: string, data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onCreateItem: (data: Partial<InventoryItem>) => Promise<InventoryItem | null>;
  onMarkOrdered: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  onReceiveOrder: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  isAdmin: boolean;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
  initialItemId?: string;
  onBackFromDetail?: () => void;
}

type InventoryView = 'kanban' | 'detail' | 'add' | 'ordering';

const Inventory: React.FC<InventoryProps> = ({
  inventory,
  onNavigate,
  onUpdateStock,
  onUpdateItem,
  onCreateItem,
  onMarkOrdered,
  onReceiveOrder,
  isAdmin,
  calculateAvailable,
  calculateAllocated,
  initialItemId,
  onBackFromDetail,
}) => {
  const [view, setView] = useState<InventoryView>('kanban');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredInventory = useMemo(() => {
    if (!searchQuery.trim()) return inventory;
    const q = searchQuery.trim().toLowerCase();
    return inventory.filter((item) => {
      const name = (item.name ?? '').toLowerCase();
      const desc = (item.description ?? '').toLowerCase();
      const category = getCategoryDisplayName(item.category).toLowerCase();
      const bin = (item.binLocation ?? '').toLowerCase();
      const barcode = (item.barcode ?? '').toLowerCase();
      const vendor = (item.vendor ?? '').toLowerCase();
      const unit = (item.unit ?? '').toLowerCase();
      return (
        name.includes(q) ||
        desc.includes(q) ||
        category.includes(q) ||
        bin.includes(q) ||
        barcode.includes(q) ||
        vendor.includes(q) ||
        unit.includes(q)
      );
    });
  }, [inventory, searchQuery]);

  const selectedItem = selectedItemId ? inventory.find((i) => i.id === selectedItemId) : null;

  // NEW: Navigate to specific item if initialItemId provided
  useEffect(() => {
    if (initialItemId && inventory.length > 0) {
      const item = inventory.find((i) => i.id === initialItemId);
      if (item) {
        setSelectedItemId(initialItemId);
        setView('detail');
      }
    }
  }, [initialItemId, inventory]);

  const handleNavigateToDetail = (itemId: string) => {
    setSelectedItemId(itemId);
    setView('detail');
  };

  const handleBack = () => {
    setView('kanban');
    setSelectedItemId(null);
  };

  const handleAddItem = () => {
    setView('add');
  };

  const handleAddComplete = async (data: Partial<InventoryItem>) => {
    const newItem = await onCreateItem(data);
    if (newItem) {
      setView('kanban');
      return true;
    }
    return false;
  };

  // Render current view
  if (view === 'add') {
    return <AddInventoryItem onAdd={handleAddComplete} onCancel={handleBack} />;
  }

  if (view === 'detail' && selectedItem) {
    return (
      <InventoryDetail
        item={selectedItem}
        onNavigate={onNavigate}
        onBack={onBackFromDetail ?? handleBack}
        onUpdateStock={onUpdateStock}
        onUpdateItem={onUpdateItem}
        isAdmin={isAdmin}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
      />
    );
  }

  if (view === 'ordering') {
    return (
      <NeedsOrdering
        inventory={filteredInventory}
        onNavigate={onNavigate}
        onBack={handleBack}
        onMarkOrdered={onMarkOrdered}
        onReceiveOrder={onReceiveOrder}
        calculateAvailable={calculateAvailable}
        calculateAllocated={calculateAllocated}
      />
    );
  }

  // Default: Kanban view with tabs
  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="border-b border-white/10 bg-background-light">
        <div className="flex">
          <button
            onClick={() => setView('kanban')}
            className={`flex-1 px-4 py-3 font-bold ${
              view === 'kanban' ? 'border-b-2 border-primary text-white' : 'text-slate-400'
            }`}
          >
            All Items
          </button>
          <button
            onClick={() => setView('ordering')}
            className={`flex-1 px-4 py-3 font-bold ${
              view === 'ordering' ? 'border-b-2 border-primary text-white' : 'text-slate-400'
            }`}
          >
            Ordering
          </button>
        </div>
        {/* Search bar */}
        <div className="px-4 pb-3 pt-1">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">
              search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, category, bin, barcode, vendor..."
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search inventory"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Clear search"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="mt-1.5 text-xs text-slate-500">
              {filteredInventory.length} item{filteredInventory.length !== 1 ? 's' : ''} match
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'kanban' && (
          <InventoryKanban
            inventory={filteredInventory}
            searchActive={!!searchQuery.trim()}
            onNavigate={handleNavigateToDetail}
            onBack={() => onNavigate('dashboard')}
            onAddItem={handleAddItem}
            isAdmin={isAdmin}
            calculateAvailable={calculateAvailable}
          />
        )}
      </div>
    </div>
  );
};

export default Inventory;
