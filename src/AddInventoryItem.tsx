import React, { useState } from 'react';
import { InventoryCategory } from '@/core/types';
import { useToast } from './Toast';
import { FormField } from './components/ui/FormField';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { validateRequired, validateQuantity, validatePrice } from '@/core/validation';

interface AddInventoryItemProps {
  onAdd: (data: {
    name: string;
    category: InventoryCategory;
    inStock: number;
    unit: string;
    price?: number;
    barcode?: string;
    binLocation?: string;
    vendor?: string;
    reorderPoint?: number;
  }) => Promise<boolean>;
  onCancel: () => void;
}

const AddInventoryItem: React.FC<AddInventoryItemProps> = ({ onAdd, onCancel }) => {
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<InventoryCategory>('material');
  const [inStock, setInStock] = useState(0);
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [barcode, setBarcode] = useState('');
  const [binLocation, setBinLocation] = useState('');
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
    if (inStock < 0) {
      newErrors.inStock = validateQuantity(inStock);
    }
    if (reorderPoint < 0) {
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
        price: price || undefined,
        barcode: barcode.trim() || undefined,
        binLocation: binLocation.trim() || undefined,
        vendor: vendor.trim() || undefined,
        reorderPoint: reorderPoint || undefined,
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
      <div className="border-b border-white/10 bg-gradient-to-b from-background-light to-background-dark p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="text-white" aria-label="Cancel and go back">
              <span className="material-symbols-outlined">close</span>
            </button>
            <h1 className="text-xl font-bold text-white">Add Inventory Item</h1>
          </div>
          <Button onClick={handleSubmit} disabled={isSaving} icon="add">
            {isSaving ? 'Adding...' : 'Add'}
          </Button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Basic Info */}
        <Card>
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
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
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
              className="w-full resize-none rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>

          <FormField label="Category" htmlFor="category" required>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as InventoryCategory)}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="material">Material</option>
              <option value="foam">Foam</option>
              <option value="trimCord">Trim Cord</option>
              <option value="printing3d">3D Printing</option>
              <option value="chemicals">Chemicals</option>
              <option value="hardware">Hardware</option>
              <option value="miscSupplies">Misc Supplies</option>
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
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.unit}
            />
          </FormField>

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
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.price}
            />
          </FormField>
        </Card>

        {/* Stock */}
        <Card>
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
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.inStock}
            />
          </FormField>

          <FormField
            label="Reorder Point"
            htmlFor="reorderPoint"
            error={errors.reorderPoint}
            hint="Alert when stock falls below this level"
          >
            <input
              id="reorderPoint"
              type="number"
              step="1"
              value={reorderPoint}
              onChange={(e) => {
                setReorderPoint(parseFloat(e.target.value) || 0);
                if (errors.reorderPoint) setErrors({ ...errors, reorderPoint: null });
              }}
              placeholder="0"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!errors.reorderPoint}
            />
          </FormField>
        </Card>

        {/* Location & Vendor */}
        <Card>
          <h2 className="mb-4 text-lg font-bold text-white">Location & Vendor</h2>

          <FormField label="Barcode" htmlFor="barcode">
            <input
              id="barcode"
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>

          <FormField label="Bin Location" htmlFor="binLocation">
            <input
              id="binLocation"
              type="text"
              value={binLocation}
              onChange={(e) => setBinLocation(e.target.value)}
              placeholder="e.g., A3, B12, Shelf 2"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>

          <FormField label="Vendor" htmlFor="vendor">
            <input
              id="vendor"
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-sm border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>
        </Card>
      </div>
    </div>
  );
};

export default AddInventoryItem;
