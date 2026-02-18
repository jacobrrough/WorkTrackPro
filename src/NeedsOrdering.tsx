import React, { useState, useMemo } from 'react';
import { ViewState, InventoryItem, getCategoryDisplayName } from '@/core/types';

interface NeedsOrderingProps {
  inventory: InventoryItem[];
  onNavigate: (view: ViewState, id?: string) => void;
  onBack?: () => void;
  onMarkOrdered: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  onReceiveOrder: (itemId: string, quantity: number, notes?: string) => Promise<boolean>;
  calculateAvailable: (item: InventoryItem) => number;
  calculateAllocated: (inventoryId: string) => number;
}

interface VendorGroup {
  vendor: string;
  items: InventoryItem[];
  totalItems: number;
  totalValue: number;
}

const NeedsOrdering: React.FC<NeedsOrderingProps> = ({
  inventory,
  onNavigate,
  onBack,
  onMarkOrdered,
  onReceiveOrder,
  calculateAvailable,
  calculateAllocated,
}) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({});
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [showOnOrder, setShowOnOrder] = useState(false);
  const [, setOrderingItemId] = useState<string | null>(null);
  const [, setReceivingItemId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Items that need ordering: below reorder point (with nothing on order) OR short for committed jobs
  const { needsOrdering, onOrderItems } = useMemo(() => {
    const needs: InventoryItem[] = [];
    const onOrder: InventoryItem[] = [];
    inventory.forEach((item) => {
      const available = item.available ?? calculateAvailable(item);
      const allocated = item.allocated ?? calculateAllocated(item.id);
      const shortForJobs = allocated > 0 && available < allocated;
      const belowReorder = item.reorderPoint != null && item.reorderPoint > 0 && available <= item.reorderPoint;
      const nothingOnOrder = (item.onOrder || 0) === 0;
      if ((item.onOrder || 0) > 0) onOrder.push(item);
      if (nothingOnOrder && (belowReorder || shortForJobs)) needs.push(item);
    });
    return { needsOrdering: needs, onOrderItems: onOrder };
  }, [inventory, calculateAvailable, calculateAllocated]);

  // Group by vendor
  const vendorGroups = useMemo((): VendorGroup[] => {
    const items = showOnOrder ? onOrderItems : needsOrdering;
    const groups: Record<string, InventoryItem[]> = {};

    items.forEach((item) => {
      const vendor = item.vendor || 'No Vendor Specified';
      if (!groups[vendor]) {
        groups[vendor] = [];
      }
      groups[vendor].push(item);
    });

    return Object.entries(groups)
      .map(([vendor, items]) => ({
        vendor,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
        totalItems: items.length,
        totalValue: items.reduce((sum, item) => sum + (item.price || 0), 0),
      }))
      .sort((a, b) => {
        // Put "No Vendor Specified" at the end
        if (a.vendor === 'No Vendor Specified') return 1;
        if (b.vendor === 'No Vendor Specified') return -1;
        return a.vendor.localeCompare(b.vendor);
      });
  }, [needsOrdering, onOrderItems, showOnOrder]);

  const toggleVendor = (vendor: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) {
        next.delete(vendor);
      } else {
        next.add(vendor);
      }
      return next;
    });
  };

  const toggleSelectAll = (_vendor: string, items: InventoryItem[]) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((item) => next.has(item.id));

      if (allSelected) {
        items.forEach((item) => next.delete(item.id));
      } else {
        items.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleQuantityChange = (itemId: string, qty: number) => {
    setOrderQuantities((prev) => ({
      ...prev,
      [itemId]: Math.max(1, qty),
    }));
  };

  const handleMarkOrdered = async (item: InventoryItem) => {
    const qty = orderQuantities[item.id] || 1;
    setIsProcessing(true);
    try {
      const success = await onMarkOrdered(item.id, qty);
      if (success) {
        setSelectedItems((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setOrderingItemId(null);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReceiveOrder = async (item: InventoryItem) => {
    const qty = item.onOrder || 1;
    setIsProcessing(true);
    try {
      const success = await onReceiveOrder(item.id, qty);
      if (success) {
        setReceivingItemId(null);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkSelectedOrdered = async (_vendor: string, items: InventoryItem[]) => {
    const itemsToOrder = items.filter((item) => selectedItems.has(item.id));
    if (itemsToOrder.length === 0) return;

    setIsProcessing(true);
    try {
      for (const item of itemsToOrder) {
        const qty = orderQuantities[item.id] || 1;
        await onMarkOrdered(item.id, qty);
      }

      // Clear selections for this vendor
      setSelectedItems((prev) => {
        const next = new Set(prev);
        itemsToOrder.forEach((item) => next.delete(item.id));
        return next;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const totalNeedsOrdering = needsOrdering.length;
  const totalOnOrder = onOrderItems.length;

  return (
    <div className="flex min-h-screen flex-col bg-background-dark">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background-dark/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack || (() => onNavigate('inventory'))}
            className="-ml-2 p-2 text-white/60 hover:text-white"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Ordering</h1>
            <p className="text-sm text-white/40">
              {showOnOrder
                ? `${totalOnOrder} items on order`
                : `${totalNeedsOrdering} items need ordering`}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setShowOnOrder(false)}
            className={`flex-1 rounded-sm px-4 py-2 text-sm font-bold transition-all ${
              !showOnOrder
                ? 'border border-red-500/30 bg-red-500/20 text-red-400'
                : 'border border-transparent bg-white/5 text-white/60'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-lg">warning</span>
              Needs Ordering ({totalNeedsOrdering})
            </span>
          </button>
          <button
            onClick={() => setShowOnOrder(true)}
            className={`flex-1 rounded-sm px-4 py-2 text-sm font-bold transition-all ${
              showOnOrder
                ? 'border border-blue-500/30 bg-blue-500/20 text-blue-400'
                : 'border border-transparent bg-white/5 text-white/60'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-lg">local_shipping</span>
              On Order ({totalOnOrder})
            </span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {vendorGroups.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined mb-4 text-6xl text-white/20">
              {showOnOrder ? 'inventory_2' : 'check_circle'}
            </span>
            <p className="text-lg font-bold text-white/60">
              {showOnOrder ? 'No items on order' : 'All stocked up!'}
            </p>
            <p className="mt-2 text-sm text-white/40">
              {showOnOrder
                ? 'Items you mark as ordered will appear here'
                : 'No items with zero availability'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {vendorGroups.map((group) => {
              const isExpanded = expandedVendors.has(group.vendor);
              const selectedCount = group.items.filter((item) => selectedItems.has(item.id)).length;
              const allSelected = selectedCount === group.items.length;

              return (
                <div
                  key={group.vendor}
                  className="overflow-hidden rounded-md border border-white/10 bg-card-dark"
                >
                  {/* Vendor Header */}
                  <button
                    onClick={() => toggleVendor(group.vendor)}
                    className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5"
                  >
                    <span
                      className={`material-symbols-outlined transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    >
                      chevron_right
                    </span>
                    <div className="flex-1 text-left">
                      <p className="font-bold text-white">{group.vendor}</p>
                      <p className="text-sm text-white/40">
                        {group.totalItems} item{group.totalItems !== 1 ? 's' : ''}
                        {group.totalValue > 0 && ` \u2022 ~$${group.totalValue.toFixed(2)} est.`}
                      </p>
                    </div>
                    {!showOnOrder && selectedCount > 0 && (
                      <span className="rounded-sm bg-primary/20 px-2 py-1 text-xs font-bold text-primary">
                        {selectedCount} selected
                      </span>
                    )}
                  </button>

                  {/* Items */}
                  {isExpanded && (
                    <div className="border-t border-white/10">
                      {/* Select All / Mark All Ordered */}
                      {!showOnOrder && (
                        <div className="flex items-center justify-between bg-white/5 px-4 py-2">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={() => toggleSelectAll(group.vendor, group.items)}
                              className="h-4 w-4 rounded border-white/20 bg-white/10 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-white/60">Select all</span>
                          </label>
                          {selectedCount > 0 && (
                            <button
                              onClick={() => handleMarkSelectedOrdered(group.vendor, group.items)}
                              disabled={isProcessing}
                              className="flex items-center gap-1 rounded-sm bg-primary px-3 py-1.5 text-xs font-bold text-white"
                            >
                              <span className="material-symbols-outlined text-sm">check</span>
                              Mark {selectedCount} Ordered
                            </button>
                          )}
                        </div>
                      )}

                      {/* Item List */}
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 border-t border-white/5 px-4 py-3"
                        >
                          {!showOnOrder && (
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => toggleSelectItem(item.id)}
                              className="h-5 w-5 rounded border-white/20 bg-white/10 text-primary focus:ring-primary"
                            />
                          )}

                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => onNavigate('inventory-detail', item.id)}
                          >
                            <p className="font-bold text-white">{item.name}</p>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <span className="text-white/40">
                                {getCategoryDisplayName(item.category)}
                              </span>
                              {item.binLocation && (
                                <>
                                  <span className="text-white/20">\u2022</span>
                                  <span className="text-white/40">Bin: {item.binLocation}</span>
                                </>
                              )}
                              {item.price && (
                                <>
                                  <span className="text-white/20">\u2022</span>
                                  <span className="text-white/40">
                                    ${item.price.toFixed(2)}/{item.unit || 'ea'}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="mt-1 flex flex-col gap-0.5">
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="text-xs font-bold text-red-400">
                                  Available: {item.available ?? calculateAvailable(item)}{' '}
                                  {item.unit}
                                </span>
                                <span className="text-xs font-bold text-yellow-400">
                                  Needed for jobs: {item.allocated ?? calculateAllocated(item.id)}{' '}
                                  {item.unit}
                                </span>
                                {showOnOrder && (item.onOrder || 0) > 0 && (
                                  <span className="flex items-center gap-1 text-xs font-bold text-blue-400">
                                    <span className="material-symbols-outlined text-sm">
                                      local_shipping
                                    </span>
                                    {item.onOrder} on order
                                  </span>
                                )}
                              </div>
                              {(() => {
                                const avail = item.available ?? calculateAvailable(item);
                                const alloc = item.allocated ?? calculateAllocated(item.id);
                                const short = alloc > 0 && avail < alloc;
                                if (short) {
                                  return (
                                    <p className="text-xs font-bold text-red-300">
                                      Need {alloc - avail} more {item.unit} to complete all jobs
                                    </p>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>

                          {/* Actions */}
                          {showOnOrder ? (
                            /* Receive Order Button */
                            <button
                              onClick={() => handleReceiveOrder(item)}
                              disabled={isProcessing}
                              className="flex items-center gap-1 rounded-sm bg-green-500/20 px-3 py-2 text-sm font-bold text-green-400"
                            >
                              <span className="material-symbols-outlined text-sm">inventory</span>
                              Receive
                            </button>
                          ) : (
                            /* Order Quantity + Mark Ordered */
                            <div className="flex items-center gap-2">
                              <div className="flex items-center rounded-sm bg-white/10">
                                <button
                                  onClick={() =>
                                    handleQuantityChange(
                                      item.id,
                                      (orderQuantities[item.id] || 1) - 1
                                    )
                                  }
                                  className="px-2 py-1 text-white/60 hover:text-white"
                                >
                                  <span className="material-symbols-outlined text-sm">remove</span>
                                </button>
                                <input
                                  type="number"
                                  value={orderQuantities[item.id] || 1}
                                  onChange={(e) =>
                                    handleQuantityChange(item.id, parseInt(e.target.value) || 1)
                                  }
                                  className="w-12 bg-transparent text-center text-sm font-bold text-white focus:outline-none"
                                  min="1"
                                />
                                <button
                                  onClick={() =>
                                    handleQuantityChange(
                                      item.id,
                                      (orderQuantities[item.id] || 1) + 1
                                    )
                                  }
                                  className="px-2 py-1 text-white/60 hover:text-white"
                                >
                                  <span className="material-symbols-outlined text-sm">add</span>
                                </button>
                              </div>
                              <button
                                onClick={() => handleMarkOrdered(item)}
                                disabled={isProcessing}
                                className="rounded-sm bg-primary/20 px-3 py-2 text-sm font-bold text-primary"
                              >
                                Order
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Summary Footer */}
      {!showOnOrder && totalNeedsOrdering > 0 && selectedItems.size > 0 && (
        <div className="safe-area-pb fixed bottom-0 left-0 right-0 border-t border-white/10 bg-card-dark px-4 py-3">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <div>
              <p className="font-bold text-white">{selectedItems.size} items selected</p>
              <p className="text-sm text-white/40">Ready to mark as ordered</p>
            </div>
            <button
              onClick={() => {
                // Mark all selected as ordered
                needsOrdering
                  .filter((item) => selectedItems.has(item.id))
                  .forEach((item) => handleMarkOrdered(item));
              }}
              disabled={isProcessing}
              className="flex items-center gap-2 rounded-sm bg-primary px-6 py-3 font-bold text-white"
            >
              {isProcessing ? (
                <>
                  <span className="material-symbols-outlined animate-spin">refresh</span>
                  Processing...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">check_circle</span>
                  Mark All Ordered
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NeedsOrdering;
