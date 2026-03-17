import React from 'react';
import type { InventoryItem, InventoryCategory } from '@/core/types';
import { getCategoryDisplayName } from '@/core/types';

const CATEGORIES: InventoryCategory[] = [
  'material',
  'foam',
  'trimCord',
  'printing3d',
  'chemicals',
  'hardware',
  'miscSupplies',
];

export interface InventoryDetailEditFormState {
  editName: string;
  editDescription: string;
  editCategory: InventoryCategory;
  editInStock: number;
  editPrice: number;
  editUnit: string;
  editBarcode: string;
  editBinLocation: string;
  editVendor: string;
  editReorderPoint: number;
  editOnOrder: number;
  editReason: string;
}

interface InventoryDetailEditProps {
  currentItem: InventoryItem;
  form: InventoryDetailEditFormState;
  setForm: (patch: Partial<InventoryDetailEditFormState>) => void;
  allocated: number;
  isAdmin: boolean;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onScanBarcode: () => void;
  onScanBin: () => void;
}

export function InventoryDetailEdit({
  currentItem,
  form,
  setForm,
  allocated,
  isAdmin,
  isSaving,
  onSave,
  onCancel,
  onScanBarcode,
  onScanBin,
}: InventoryDetailEditProps) {
  return (
    <div className="flex h-full flex-col bg-background-dark">
      <div className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onCancel} className="text-white">
              <span className="material-symbols-outlined">close</span>
            </button>
            <h1 className="text-xl font-bold text-white">Edit Item</h1>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-sm bg-primary px-6 py-2 font-bold text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="space-y-3 rounded-sm bg-card-dark p-3">
          <h2 className="text-lg font-bold text-white">Basic Information</h2>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Name *</label>
            <input
              type="text"
              value={form.editName}
              onChange={(e) => setForm({ editName: e.target.value })}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Description</label>
            <textarea
              value={form.editDescription}
              onChange={(e) => setForm({ editDescription: e.target.value })}
              placeholder="Optional description..."
              rows={3}
              className="w-full resize-none rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Category *</label>
            <select
              value={form.editCategory}
              onChange={(e) => setForm({ editCategory: e.target.value as InventoryCategory })}
              className="w-full cursor-pointer rounded-sm border-2 border-primary/50 bg-background-light px-4 py-3 font-bold text-white hover:border-primary focus:border-primary focus:outline-none"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-background-dark text-white">
                  {getCategoryDisplayName(cat)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Unit *</label>
            <input
              type="text"
              value={form.editUnit}
              onChange={(e) => setForm({ editUnit: e.target.value })}
              placeholder="e.g., ft, lbs, ea"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
          {isAdmin && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-400">Price Per Unit</label>
              <input
                type="number"
                step={0.01}
                value={form.editPrice || ''}
                onChange={(e) => setForm({ editPrice: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
              />
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-sm bg-card-dark p-3">
          <h2 className="text-lg font-bold text-white">Stock Levels</h2>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">In Stock *</label>
            <input
              type="number"
              step={1}
              value={form.editInStock}
              onChange={(e) => setForm({ editInStock: parseFloat(e.target.value) || 0 })}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
            {form.editInStock !== currentItem.inStock && (
              <p className="mt-1 text-xs text-yellow-400">
                Current: {currentItem.inStock} → New: {form.editInStock} (
                {form.editInStock > currentItem.inStock ? '+' : ''}
                {form.editInStock - currentItem.inStock})
              </p>
            )}
          </div>
          {form.editInStock !== currentItem.inStock && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-400">
                Reason for Change *
              </label>
              <input
                type="text"
                value={form.editReason}
                onChange={(e) => setForm({ editReason: e.target.value })}
                placeholder="e.g., Physical count, received shipment, correction"
                className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-sm border border-white/10 bg-white/5 px-4 py-3">
              <p className="mb-1 text-xs text-slate-400">Allocated</p>
              <p className="text-lg font-bold text-yellow-400">{allocated}</p>
              <p className="text-xs text-slate-500">(auto-calculated)</p>
            </div>
            <div className="rounded-sm border border-white/10 bg-white/5 px-4 py-3">
              <p className="mb-1 text-xs text-slate-400">Available</p>
              <p className="text-lg font-bold text-green-400">
                {Math.max(0, form.editInStock - allocated)}
              </p>
              <p className="text-xs text-slate-500">(auto-calculated)</p>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Reorder Point</label>
            <input
              type="number"
              step={1}
              min={0}
              value={form.editReorderPoint > 0 ? form.editReorderPoint : ''}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                setForm({ editReorderPoint: val });
              }}
              placeholder="Not set (enter number to enable)"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
            <p className="mt-1 text-xs text-slate-500">
              Alert when available stock falls below this level. Leave empty or set to 0 to disable.
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">On Order</label>
            <input
              type="number"
              step={1}
              value={form.editOnOrder || ''}
              onChange={(e) => setForm({ editOnOrder: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-sm bg-card-dark p-3">
          <h2 className="text-lg font-bold text-white">Location & Vendor</h2>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Barcode</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.editBarcode}
                onChange={(e) => setForm({ editBarcode: e.target.value })}
                placeholder="Scan or enter manually"
                className="flex-1 rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
              />
              <button
                type="button"
                onClick={onScanBarcode}
                className="rounded-sm border border-primary bg-primary/20 px-4 py-3 text-primary transition-colors hover:bg-primary/30"
              >
                <span className="material-symbols-outlined">qr_code_scanner</span>
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Bin Location</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.editBinLocation}
                onChange={(e) => setForm({ editBinLocation: e.target.value })}
                placeholder="e.g., A4c"
                className="flex-1 rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
              />
              <button
                type="button"
                onClick={onScanBin}
                className="rounded-sm border border-primary bg-primary/20 px-4 py-3 text-primary transition-colors hover:bg-primary/30"
                title="Scan bin location QR"
              >
                <span className="material-symbols-outlined">qr_code_scanner</span>
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-400">Vendor</label>
            <input
              type="text"
              value={form.editVendor}
              onChange={(e) => setForm({ editVendor: e.target.value })}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
