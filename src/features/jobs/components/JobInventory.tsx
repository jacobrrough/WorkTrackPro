import { useMemo, useState } from 'react';
import type { InventoryItem, Job, ViewState } from '@/core/types';

interface JobInventoryProps {
  job: Job;
  inventory: InventoryItem[];
  inventoryById: Map<string, InventoryItem>;
  calculateAvailable: (item: InventoryItem) => number;
  currentUserIsAdmin: boolean;
  isSubmitting: boolean;
  onNavigate: (view: ViewState, id?: string) => void;
  isMaterialAuto: (inventoryId: string, quantity: number) => boolean;
  onAddInventory: (
    jobId: string,
    inventoryId: string,
    quantity: number,
    unit: string
  ) => Promise<void>;
  onRemoveInventory: (jobId: string, jobInventoryId: string) => Promise<void>;
}

export default function JobInventory({
  job,
  inventory,
  inventoryById,
  calculateAvailable,
  currentUserIsAdmin,
  isSubmitting,
  onNavigate,
  isMaterialAuto,
  onAddInventory,
  onRemoveInventory,
}: JobInventoryProps) {
  const [showAddInventory, setShowAddInventory] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<string>('');
  const [inventoryQty, setInventoryQty] = useState('1');
  const [inventorySearch, setInventorySearch] = useState('');
  const [editingMaterialQty, setEditingMaterialQty] = useState<string | null>(null);
  const [materialQtyValue, setMaterialQtyValue] = useState<string>('');

  const filteredInventory = useMemo(
    () =>
      inventory.filter(
        (i) =>
          i.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
          i.barcode?.toLowerCase().includes(inventorySearch.toLowerCase())
      ),
    [inventory, inventorySearch]
  );

  const handleAddInventory = async () => {
    if (!selectedInventory || !inventoryQty) return;
    const item = inventoryById.get(selectedInventory);
    if (!item) return;
    await onAddInventory(job.id, selectedInventory, parseFloat(inventoryQty), item.unit);
    setShowAddInventory(false);
    setSelectedInventory('');
    setInventoryQty('1');
    setInventorySearch('');
  };

  const handleRemoveInventory = async (jobInvId: string) => {
    if (!jobInvId) return;
    await onRemoveInventory(job.id, jobInvId);
  };

  return (
    <>
      <div className="p-3 pt-0">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <span className="material-symbols-outlined text-lg text-primary">inventory_2</span>
            Materials ({job.inventoryItems?.length || 0})
          </h3>
          {currentUserIsAdmin && (
            <button
              onClick={() => setShowAddInventory(true)}
              className="min-h-11 px-2 text-xs font-bold text-primary"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Add
            </button>
          )}
        </div>

        {!job.inventoryItems || job.inventoryItems.length === 0 ? (
          <div className="rounded-sm bg-[#261a32] p-3 text-center">
            <span className="material-symbols-outlined mb-2 text-3xl text-slate-500">
              inventory_2
            </span>
            <p className="text-sm text-slate-400">No materials assigned</p>
            {currentUserIsAdmin && (
              <button
                onClick={() => setShowAddInventory(true)}
                className="mt-2 min-h-11 px-2 text-sm font-bold text-primary"
              >
                + Add materials
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {(job.inventoryItems || []).map((item) => {
              const itemName = (item as { inventoryName?: string }).inventoryName;
              const invItem = item.inventoryId ? inventoryById.get(item.inventoryId) : undefined;
              const available = invItem ? (invItem.available ?? calculateAvailable(invItem)) : 0;
              const isLow = available < item.quantity;
              const isEditingThis = editingMaterialQty === item.id;

              return (
                <div
                  key={item.id || item.inventoryId}
                  className="overflow-hidden rounded-sm bg-[#261a32]"
                >
                  <div className="flex items-center justify-between p-3">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (invItem) onNavigate('inventory-detail', invItem.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (invItem) onNavigate('inventory-detail', invItem.id);
                        }
                      }}
                      className="-ml-1 flex flex-1 cursor-pointer items-center gap-3 rounded-sm p-1 text-left transition-colors hover:bg-white/5"
                    >
                      {invItem?.imageUrl ? (
                        <img
                          src={invItem.imageUrl}
                          alt={itemName || 'Material'}
                          className={`size-10 flex-shrink-0 rounded-sm object-cover ${isLow ? 'ring-2 ring-red-500' : ''}`}
                        />
                      ) : (
                        <div
                          className={`flex size-10 flex-shrink-0 items-center justify-center rounded-sm ${isLow ? 'bg-red-500/20' : 'bg-white/10'}`}
                        >
                          <span
                            className={`material-symbols-outlined ${isLow ? 'text-red-400' : 'text-slate-400'}`}
                          >
                            {isLow ? 'warning' : 'inventory_2'}
                          </span>
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-primary transition-colors hover:text-primary/80 hover:underline">
                          {itemName || invItem?.name || 'Unknown Item'}
                        </p>
                        <p className="text-xs text-slate-400">
                          Need:{' '}
                          {isEditingThis ? (
                            <input
                              type="number"
                              value={materialQtyValue}
                              onChange={(e) => setMaterialQtyValue(e.target.value)}
                              onBlur={async () => {
                                const newQty = parseFloat(materialQtyValue);
                                if (
                                  newQty > 0 &&
                                  newQty !== item.quantity &&
                                  item.id &&
                                  item.inventoryId
                                ) {
                                  await onRemoveInventory(job.id, item.id);
                                  await onAddInventory(job.id, item.inventoryId, newQty, item.unit);
                                }
                                setEditingMaterialQty(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') setEditingMaterialQty(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-16 rounded border border-primary bg-white/10 px-2 py-0.5 text-xs text-white"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={(e) => {
                                if (currentUserIsAdmin && item.id) {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setEditingMaterialQty(item.id);
                                  setMaterialQtyValue(item.quantity.toString());
                                }
                              }}
                              className={
                                currentUserIsAdmin
                                  ? '-mx-2 -my-1 inline-block cursor-pointer rounded px-2 py-1 transition-colors hover:bg-primary/10 hover:text-primary hover:underline'
                                  : ''
                              }
                              title={currentUserIsAdmin ? 'Click to edit quantity' : ''}
                            >
                              {item.quantity}
                            </span>
                          )}{' '}
                          {item.unit}
                          {item.inventoryId && isMaterialAuto(item.inventoryId, item.quantity) && (
                            <span className="ml-1.5 rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                              auto
                            </span>
                          )}
                          {invItem && (
                            <span className="ml-2">
                              • Available: {invItem.available ?? calculateAvailable(invItem)}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {currentUserIsAdmin && item.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveInventory(item.id);
                        }}
                        className="ml-2 min-h-11 min-w-11 p-1 text-red-400 hover:text-red-300"
                        title="Remove material"
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAddInventory && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/80 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full flex-col rounded-t-md border-t border-white/10 bg-background-dark p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Add Material</h3>
              <button
                onClick={() => setShowAddInventory(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                search
              </span>
              <input
                type="text"
                placeholder="Search inventory..."
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                className="h-12 w-full rounded-sm border border-white/20 bg-white/10 pl-10 pr-4 text-white"
              />
            </div>

            <div className="mb-3 flex-1 space-y-2 overflow-y-auto">
              {filteredInventory.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedInventory(item.id)}
                  className={`w-full rounded-sm p-3 text-left ${
                    selectedInventory === item.id
                      ? 'border border-primary bg-primary/10'
                      : 'border border-white/10 bg-white/5'
                  }`}
                >
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="text-xs text-slate-400">
                    Available: {item.available ?? calculateAvailable(item)} {item.unit}
                  </p>
                </button>
              ))}
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm text-slate-300">Quantity</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={inventoryQty}
                onChange={(e) => setInventoryQty(e.target.value)}
                className="h-12 w-full rounded-sm border border-white/20 bg-white/10 px-3 text-white"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowAddInventory(false)}
                className="h-12 flex-1 rounded-sm border border-white/20 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleAddInventory}
                disabled={!selectedInventory || !inventoryQty || isSubmitting}
                className="h-12 flex-1 rounded-sm bg-primary font-bold text-white disabled:opacity-50"
              >
                Add Material
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
