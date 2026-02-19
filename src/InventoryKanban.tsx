import React, { useMemo, useState, useEffect } from 'react';
import { InventoryItem, InventoryCategory } from '@/core/types';
import { useNavigation } from '@/contexts/NavigationContext';
import QRScanner from './components/QRScanner';
import { useToast } from './Toast';

interface InventoryKanbanProps {
  inventory: InventoryItem[];
  searchActive?: boolean;
  onNavigate: (itemId: string) => void; // Navigate to item detail
  onBack: () => void; // Navigate back to dashboard
  onAddItem: () => void;
  onUpdateItem?: (itemId: string, updates: Partial<InventoryItem>) => Promise<void>;
  isAdmin: boolean;
  calculateAvailable: (item: InventoryItem) => number;
}

const CATEGORIES: { id: InventoryCategory; label: string }[] = [
  { id: 'material', label: 'Material' },
  { id: 'foam', label: 'Foam' },
  { id: 'trimCord', label: 'Trim Cord' },
  { id: 'printing3d', label: '3D Printing' },
  { id: 'chemicals', label: 'Chemicals' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'miscSupplies', label: 'Misc Supplies' },
];

const InventoryKanban: React.FC<InventoryKanbanProps> = ({
  inventory,
  searchActive = false,
  onNavigate,
  onBack,
  onAddItem,
  onUpdateItem,
  isAdmin,
  calculateAvailable,
}) => {
  const { showToast } = useToast();
  const [scanningForItem, setScanningForItem] = useState<string | null>(null);
  const { state: navState, updateState } = useNavigation();

  // Use navigation context for expanded categories, fallback to local state
  const expandedCategories = useMemo(() => {
    return new Set(navState.expandedCategories || []);
  }, [navState.expandedCategories]);

  const toggleCategory = (categoryId: string) => {
    const newExpanded = expandedCategories.has(categoryId)
      ? navState.expandedCategories.filter((id) => id !== categoryId)
      : [...navState.expandedCategories, categoryId];
    updateState({ expandedCategories: newExpanded });
  };

  const categorizedInventory = useMemo(() => {
    const result: Record<string, InventoryItem[]> = {};
    CATEGORIES.forEach((cat) => {
      result[cat.id] = inventory
        .filter((item) => item.category === cat.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    });
    return result;
  }, [inventory]);

  // When search is active, auto-expand categories that have matching items so results are visible
  useEffect(() => {
    if (searchActive) {
      const withItems = CATEGORIES.filter(
        (cat) => (categorizedInventory[cat.id]?.length ?? 0) > 0
      ).map((c) => c.id);
      updateState({ expandedCategories: withItems });
    }
  }, [searchActive, categorizedInventory, updateState]);

  const collapseAll = () => updateState({ expandedCategories: [] });
  const expandAll = () => updateState({ expandedCategories: CATEGORIES.map((c) => c.id) });

  return (
    <div className="flex h-full flex-col bg-background-dark">
      <div className="border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-white transition-colors hover:text-primary">
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <h1 className="text-2xl font-bold text-white">Inventory</h1>
          </div>
          {isAdmin && (
            <button
              onClick={onAddItem}
              className="flex items-center gap-2 rounded-sm bg-primary px-4 py-2 font-bold text-white"
            >
              <span className="material-symbols-outlined">add</span>
              Add Item
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={expandAll} className="text-sm font-bold text-primary">
            Expand All
          </button>
          <span className="text-slate-600">|</span>
          <button onClick={collapseAll} className="text-sm font-bold text-primary">
            Collapse All
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {CATEGORIES.map((category) => {
          const items = categorizedInventory[category.id] || [];
          const isExpanded = expandedCategories.has(category.id);

          return (
            <div key={category.id} className="border-b border-white/10">
              <button
                onClick={() => toggleCategory(category.id)}
                className="sticky top-0 z-10 w-full border-b border-white/10 bg-background-light p-3 transition-colors hover:bg-background-light/80"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-xl text-white">
                      {isExpanded ? 'expand_more' : 'chevron_right'}
                    </span>
                    <h2 className="text-lg font-bold text-white">{category.label}</h2>
                    <span className="rounded-sm bg-white/10 px-2 py-1 text-xs font-bold text-white">
                      {items.length}
                    </span>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="space-y-3 p-3">
                  {items.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">
                      No items in this category
                    </p>
                  ) : (
                    items.map((item) => {
                      const available = item.available ?? calculateAvailable(item);
                      const allocated = item.allocated ?? 0;
                      const shortForJobs = allocated > 0 && available < allocated;
                      const belowReorder =
                        item.reorderPoint != null &&
                        item.reorderPoint > 0 &&
                        available <= item.reorderPoint;
                      const isLowStock = belowReorder || shortForJobs;

                      return (
                        <div
                          key={item.id}
                          className="w-full rounded-sm border border-white/10 bg-card-dark p-3"
                        >
                          <button
                            onClick={() => onNavigate(item.id)}
                            className="w-full text-left transition-colors hover:bg-card-dark/80"
                          >
                            <div className="mb-3 flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="text-lg font-bold text-white">{item.name}</h3>
                                {item.description && (
                                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-300">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {isLowStock && (
                                  <span className="material-symbols-outlined text-xl text-red-500">
                                    warning
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setScanningForItem(item.id);
                                  }}
                                  className="flex size-8 items-center justify-center rounded-sm border border-primary/30 bg-primary/20 text-primary transition-colors hover:bg-primary/30 active:scale-95"
                                  title="Scan bin location"
                                >
                                  <span className="material-symbols-outlined text-lg">
                                    qr_code_scanner
                                  </span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-4 gap-3">
                              <div>
                                <p className="text-xs text-slate-400">In Stock</p>
                                <p className="font-bold text-white">{item.inStock}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Available</p>
                                <p
                                  className={`font-bold ${available > 0 ? 'text-green-400' : 'text-red-400'} ${belowReorder ? 'text-orange-400' : ''}`}
                                >
                                  {available}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Needed (jobs)</p>
                                <p className="font-bold text-yellow-400">{allocated}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Unit</p>
                                <p className="font-bold text-white">{item.unit}</p>
                              </div>
                              {item.reorderPoint != null && item.reorderPoint > 0 && (
                                <div>
                                  <p className="text-xs text-slate-400">Reorder @</p>
                                  <p
                                    className={`font-bold ${belowReorder ? 'text-orange-400' : 'text-slate-400'}`}
                                  >
                                    {item.reorderPoint}
                                  </p>
                                </div>
                              )}
                              {item.price && (!item.reorderPoint || item.reorderPoint === 0) && (
                                <div>
                                  <p className="text-xs text-slate-400">Price</p>
                                  <p className="font-bold text-white">${item.price.toFixed(2)}</p>
                                </div>
                              )}
                            </div>

                            {item.binLocation && (
                              <div className="mt-2">
                                <p className="flex items-center gap-1 text-xs text-slate-400">
                                  <span className="material-symbols-outlined text-sm">
                                    location_on
                                  </span>
                                  {item.binLocation}
                                </p>
                              </div>
                            )}

                            {isLowStock && (
                              <div className="mt-2 space-y-0.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1">
                                <p className="text-xs font-bold text-red-400">
                                  {belowReorder && shortForJobs
                                    ? '⚠️ Below reorder point & short for jobs'
                                    : belowReorder
                                      ? '⚠️ Below reorder point'
                                      : '⚠️ Short for jobs'}
                                </p>
                                {belowReorder && (
                                  <p className="text-xs text-red-300">
                                    Available ({available}) is at or below reorder point (
                                    {item.reorderPoint}).
                                  </p>
                                )}
                                {shortForJobs && (
                                  <p className="text-xs text-red-300">
                                    {allocated} {item.unit} needed for jobs. Need{' '}
                                    {allocated - available} more.
                                  </p>
                                )}
                              </div>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bin Location Scanner */}
      {scanningForItem && (
        <QRScanner
          scanType="bin"
          onScanComplete={async (binLocation) => {
            if (onUpdateItem) {
              try {
                await onUpdateItem(scanningForItem, { binLocation });
                showToast(`Bin location updated: ${binLocation}`, 'success');
              } catch {
                showToast('Failed to update bin location', 'error');
              }
            }
            setScanningForItem(null);
          }}
          onClose={() => setScanningForItem(null)}
          currentValue={inventory.find((i) => i.id === scanningForItem)?.binLocation}
          title="Scan Bin Location"
          description="Scan QR code on bin location"
        />
      )}
    </div>
  );
};

export default InventoryKanban;
