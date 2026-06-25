import type { InventoryItem, InventoryCategoryOption } from '@/core/types';
import { categoryIcon } from '@/features/inventory/inventoryViewModel';

export interface InventoryDetailEditFormState {
  editName: string;
  editDescription: string;
  editCategory: string;
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
  /** Built-in + admin-defined custom categories to choose from. */
  categoryOptions: InventoryCategoryOption[];
  allocated: number;
  isAdmin: boolean;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onScanBarcode: () => void;
  onScanBin: () => void;
  onUploadImage: (file: File) => void | Promise<void>;
  onRemoveImage: () => void | Promise<void>;
  imageBusy: boolean;
  /** Opens the delete-confirmation flow. Omitted (button hidden) for non-admins. */
  onDelete?: () => void;
  /** True while a delete is in flight, to disable the danger-zone button. */
  isDeleting?: boolean;
}

export function InventoryDetailEdit({
  currentItem,
  form,
  setForm,
  categoryOptions,
  allocated,
  isAdmin,
  isSaving,
  onSave,
  onCancel,
  onScanBarcode,
  onScanBin,
  onUploadImage,
  onRemoveImage,
  imageBusy,
  onDelete,
  isDeleting = false,
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
            className="rounded-sm bg-primary px-6 py-2 font-bold text-on-accent disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="space-y-3 rounded-sm bg-card-dark p-3">
          <h2 className="text-lg font-bold text-white">Photo</h2>
          <div className="flex items-center gap-3">
            {currentItem.hasImage && currentItem.imageUrl ? (
              <img
                src={currentItem.imageUrl}
                alt={currentItem.name}
                className="size-20 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <span className="flex size-20 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary">
                <span className="material-symbols-outlined text-3xl">
                  {categoryIcon(currentItem.category)}
                </span>
              </span>
            )}
            <div className="flex flex-col gap-2">
              <label
                className={`inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-sm border border-primary bg-primary/20 px-4 text-sm font-bold text-primary ${
                  imageBusy ? 'pointer-events-none opacity-50' : ''
                }`}
              >
                <span className="material-symbols-outlined">photo_camera</span>
                {currentItem.hasImage ? 'Replace photo' : 'Add photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={imageBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void onUploadImage(file);
                  }}
                />
              </label>
              {currentItem.hasImage && (
                <button
                  type="button"
                  onClick={() => void onRemoveImage()}
                  disabled={imageBusy}
                  className="min-h-[40px] rounded-sm border border-white/20 px-4 text-sm font-bold text-muted disabled:opacity-50"
                >
                  Remove
                </button>
              )}
              <p className="text-xs text-subtle">
                {imageBusy ? 'Working…' : 'Replaces the category placeholder shown in lists.'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-sm bg-card-dark p-3">
          <h2 className="text-lg font-bold text-white">Basic Information</h2>
          <div>
            <label className="mb-2 block text-sm font-bold text-muted">Name *</label>
            <input
              type="text"
              value={form.editName}
              onChange={(e) => setForm({ editName: e.target.value })}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-muted">Description</label>
            <textarea
              value={form.editDescription}
              onChange={(e) => setForm({ editDescription: e.target.value })}
              placeholder="Optional description..."
              rows={3}
              className="w-full resize-none rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-muted">Category *</label>
            <select
              value={form.editCategory}
              onChange={(e) => setForm({ editCategory: e.target.value })}
              className="w-full cursor-pointer rounded-sm border-2 border-primary/50 bg-background-light px-4 py-3 font-bold text-white hover:border-primary focus:border-primary focus:outline-none"
            >
              {categoryOptions.map((cat) => (
                <option key={cat.key} value={cat.key} className="bg-background-dark text-white">
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-muted">Unit *</label>
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
              <label className="mb-2 block text-sm font-bold text-muted">Price Per Unit</label>
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
            <label className="mb-2 block text-sm font-bold text-muted">In Stock *</label>
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
              <label className="mb-2 block text-sm font-bold text-muted">Reason for Change *</label>
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
              <p className="mb-1 text-xs text-muted">Allocated</p>
              <p className="text-lg font-bold text-yellow-400">{allocated}</p>
              <p className="text-xs text-subtle">(auto-calculated)</p>
            </div>
            <div className="rounded-sm border border-white/10 bg-white/5 px-4 py-3">
              <p className="mb-1 text-xs text-muted">Available</p>
              <p className="text-lg font-bold text-green-400">
                {Math.max(0, form.editInStock - allocated)}
              </p>
              <p className="text-xs text-subtle">(auto-calculated)</p>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-muted">Reorder Point</label>
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
            <p className="mt-1 text-xs text-subtle">
              Alert when available stock falls below this level. Leave empty or set to 0 to disable.
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-muted">On Order</label>
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
            <label className="mb-2 block text-sm font-bold text-muted">Barcode</label>
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
            <label className="mb-2 block text-sm font-bold text-muted">Bin Location</label>
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
            <label className="mb-2 block text-sm font-bold text-muted">Vendor</label>
            <input
              type="text"
              value={form.editVendor}
              onChange={(e) => setForm({ editVendor: e.target.value })}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white"
            />
          </div>
        </div>

        {onDelete && (
          <div className="space-y-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
            <h2 className="text-lg font-bold text-red-300">Danger Zone</h2>
            <p className="text-sm text-muted">
              Permanently delete this item and its stock history. Blocked if it's allocated to a job
              or used in a part. This can't be undone.
            </p>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm border border-red-500 bg-red-500/20 px-4 font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">delete</span>
              {isDeleting ? 'Deleting…' : 'Delete item'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
