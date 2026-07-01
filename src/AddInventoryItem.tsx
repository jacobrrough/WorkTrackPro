import React, { useState } from 'react';
import { useInventoryCategories } from '@/features/inventory/useInventoryCategories';
import { BarcodeScannerModal } from '@/features/inventory/detail/BarcodeScannerModal';
import { useToast } from './Toast';
import { FormField } from './components/ui/FormField';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { ScrollablePage } from './components/ScrollablePage';
import { validateRequired, validateQuantity, validatePrice } from '@/core/validation';

interface AddInventoryItemProps {
  onAdd: (data: {
    name: string;
    description?: string;
    category: string;
    inStock: number;
    unit: string;
    price?: number;
    barcode?: string;
    binLocation?: string;
    vendor?: string;
    reorderPoint?: number;
  }) => Promise<boolean>;
  onCancel: () => void;
  isAdmin?: boolean;
  /** Pre-fill the bin location (e.g. when creating an item straight into a scanned bin). */
  initialBinLocation?: string;
}

const FIELD_INPUT_CLASS =
  'min-w-0 flex-1 rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary';

// Text input paired with a camera Scan button (barcode + bin location both use this).
// onScan opens the shared scanner; the scanned value is routed back to onChange by the caller.
const ScannableInput: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onScan: () => void;
  scanLabel: string;
}> = ({ id, value, onChange, placeholder, onScan, scanLabel }) => (
  <div className="flex gap-2">
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={FIELD_INPUT_CLASS}
    />
    <button
      type="button"
      onClick={onScan}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-overlay/5 px-4 font-bold text-white hover:bg-overlay/10 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label={scanLabel}
    >
      <span className="material-symbols-outlined text-xl">qr_code_scanner</span>
      Scan
    </button>
  </div>
);

const AddInventoryItem: React.FC<AddInventoryItemProps> = ({
  onAdd,
  onCancel,
  isAdmin = true,
  initialBinLocation = '',
}) => {
  const { showToast } = useToast();
  const { options: categoryOptions } = useInventoryCategories();
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('material');
  const [inStock, setInStock] = useState(0);
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [barcode, setBarcode] = useState('');
  const [scanTarget, setScanTarget] = useState<'barcode' | 'binLocation' | null>(null);
  const [binLocation, setBinLocation] = useState(initialBinLocation);
  const [vendor, setVendor] = useState('');
  const [reorderPoint, setReorderPoint] = useState<number>(0);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string | null> = {};
    newErrors.name = validateRequired(name.trim());
    newErrors.unit = validateRequired(unit.trim());
    if (price > 0) {
      newErrors.price = validatePrice(price);
    }
    newErrors.inStock = validateQuantity(inStock);
    if (reorderPoint > 0) {
      newErrors.reorderPoint = validateQuantity(reorderPoint);
    }
    setErrors(newErrors);
    return !Object.values(newErrors).some((e) => e !== null);
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      showToast('Please fix validation errors', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const success = await onAdd({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        inStock,
        unit: unit.trim(),
        ...(isAdmin && { price: price || undefined }),
        barcode: barcode.trim() || undefined,
        binLocation: binLocation.trim() || undefined,
        vendor: vendor.trim() || undefined,
        reorderPoint: reorderPoint > 0 ? reorderPoint : undefined,
      });

      if (success) {
        showToast('Item added successfully', 'success');
        onCancel();
      } else {
        showToast('Failed to add item', 'error');
      }
    } catch (error) {
      console.error('Add error:', error);
      showToast('Error adding item', 'error');
    }
    setIsSaving(false);
  };

  return (
    <div className="flex h-full flex-col bg-background-dark">
      {/* Header */}
      <div className="border-b border-line bg-gradient-to-b from-background-light to-background-dark p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="text-white" aria-label="Cancel and go back">
              <span className="material-symbols-outlined">close</span>
            </button>
            <h1 className="app-section-title text-white">Add Inventory Item</h1>
          </div>
          <Button onClick={handleSubmit} disabled={isSaving} icon="add">
            {isSaving ? 'Adding...' : 'Add'}
          </Button>
        </div>
      </div>

      {/* Form */}
      <ScrollablePage className="space-y-4 px-4 pt-4">
        {/* Basic Info */}
        <Card className="space-y-4">
          <h2 className="mb-4 text-lg font-bold text-white">Basic Information</h2>

          <FormField label="Name" htmlFor="name" error={errors.name} required>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors({ ...errors, name: null });
              }}
              placeholder="e.g., Red Fabric, Foam Sheet"
              className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              aria-invalid={!!errors.name}
            />
          </FormField>

          <FormField label="Description" htmlFor="description">
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>

          <FormField label="Category" htmlFor="category" required>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              style={{ colorScheme: 'dark' }}
            >
              {categoryOptions.map((opt) => (
                <option key={opt.key} value={opt.key} className="bg-background-dark text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Unit" htmlFor="unit" error={errors.unit} required>
            <input
              id="unit"
              type="text"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                if (errors.unit) setErrors({ ...errors, unit: null });
              }}
              placeholder="e.g., ft, lbs, ea, yards"
              className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.unit}
            />
          </FormField>

          {isAdmin && (
            <FormField label="Price Per Unit" htmlFor="price" error={errors.price}>
              <input
                id="price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => {
                  setPrice(parseFloat(e.target.value) || 0);
                  if (errors.price) setErrors({ ...errors, price: null });
                }}
                placeholder="0.00"
                className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                aria-invalid={!!errors.price}
              />
            </FormField>
          )}
        </Card>

        {/* Stock */}
        <Card className="space-y-4">
          <h2 className="mb-4 text-lg font-bold text-white">Stock</h2>

          <FormField
            label="Initial Stock"
            htmlFor="inStock"
            error={errors.inStock}
            hint="Starting quantity in stock"
          >
            <input
              id="inStock"
              type="number"
              step="1"
              value={inStock}
              onChange={(e) => {
                setInStock(parseFloat(e.target.value) || 0);
                if (errors.inStock) setErrors({ ...errors, inStock: null });
              }}
              placeholder="0"
              className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.inStock}
            />
          </FormField>

          <FormField
            label="Reorder Point"
            htmlFor="reorderPoint"
            error={errors.reorderPoint}
            hint="Alert when available stock falls below this level. Leave empty or set to 0 to disable."
          >
            <input
              id="reorderPoint"
              type="number"
              step="1"
              min="0"
              value={reorderPoint > 0 ? reorderPoint : ''}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                setReorderPoint(val);
                if (errors.reorderPoint) setErrors({ ...errors, reorderPoint: null });
              }}
              placeholder="Not set (enter number to enable)"
              className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.reorderPoint}
            />
          </FormField>
        </Card>

        {/* Location & Vendor */}
        <Card className="space-y-4">
          <h2 className="mb-4 text-lg font-bold text-white">Location & Vendor</h2>

          <FormField label="Barcode" htmlFor="barcode">
            <ScannableInput
              id="barcode"
              value={barcode}
              onChange={setBarcode}
              placeholder="Optional"
              onScan={() => setScanTarget('barcode')}
              scanLabel="Scan barcode"
            />
          </FormField>

          <FormField label="Bin Location" htmlFor="binLocation">
            <ScannableInput
              id="binLocation"
              value={binLocation}
              onChange={setBinLocation}
              placeholder="e.g., A3, B12, Shelf 2"
              onScan={() => setScanTarget('binLocation')}
              scanLabel="Scan bin location"
            />
          </FormField>

          <FormField label="Vendor" htmlFor="vendor">
            <input
              id="vendor"
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg border border-line bg-overlay/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>
        </Card>
      </ScrollablePage>

      <BarcodeScannerModal
        open={scanTarget !== null}
        onClose={() => setScanTarget(null)}
        onScanned={(value) => {
          if (scanTarget === 'binLocation') setBinLocation(value);
          else setBarcode(value);
        }}
        showToast={showToast}
      />
    </div>
  );
};

export default AddInventoryItem;
