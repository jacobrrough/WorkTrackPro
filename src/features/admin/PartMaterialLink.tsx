/**
 * Single material row for Part BOM: name (link to inventory), qty per unit, unit cost, live subtotal, edit/delete.
 * Reusable in Part Detail and Part Form.
 */

import React, { useState } from 'react';
import type { PartMaterial, InventoryItem, ViewState } from '@/core/types';
import { partsService } from '@/services/api/parts';
import { useToast } from '@/Toast';
import MaterialCostDisplay from '@/components/MaterialCostDisplay';

export interface PartMaterialLinkProps {
  material: PartMaterial;
  inventoryItem?: InventoryItem | null;
  onUpdate: () => void;
  onNavigate?: (view: ViewState, id?: string) => void;
  showFinancials?: boolean;
  /** When true, this material's category can be CNC'd out (foam) — shows the "Needs CNC" slider. */
  cncAble?: boolean;
  className?: string;
}

const qty = (m: PartMaterial) => m.quantityPerUnit ?? (m as { quantity?: number }).quantity ?? 1;

const PartMaterialLink: React.FC<PartMaterialLinkProps> = ({
  material,
  inventoryItem,
  onUpdate,
  onNavigate,
  showFinancials = true,
  cncAble = false,
  className = '',
}) => {
  const { showToast } = useToast();
  const [editingQty, setEditingQty] = useState(false);
  const [qtyValue, setQtyValue] = useState('');
  const [unitValue, setUnitValue] = useState('');

  const currentQty = qty(material);
  const displayQty = editingQty ? qtyValue || currentQty : currentQty;
  const effectiveQty = editingQty ? parseFloat(qtyValue || '0') || currentQty : currentQty;
  const unitPrice = inventoryItem?.price ?? 0;
  const ourCost = unitPrice * effectiveQty;
  const name = material.inventoryName ?? inventoryItem?.name ?? 'Unknown';

  const handleSave = async () => {
    const numValue = parseFloat(qtyValue);
    if (Number.isNaN(numValue) || numValue < 0) {
      showToast('Invalid quantity', 'error');
      setEditingQty(false);
      return;
    }
    try {
      const updated = await partsService.updatePartMaterial(material.id, {
        quantityPerUnit: numValue,
        unit: (unitValue || material.unit || 'units').trim() || 'units',
      });
      if (updated) {
        showToast('Material updated', 'success');
        setEditingQty(false);
        onUpdate();
      } else {
        showToast('Failed to update material', 'error');
      }
    } catch {
      showToast('Failed to update material', 'error');
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    if (onNavigate) e.stopPropagation();
    try {
      await partsService.deleteMaterial(material.id);
      showToast('Material removed', 'success');
      onUpdate();
    } catch {
      showToast('Failed to remove material', 'error');
    }
  };

  const startEdit = () => {
    setEditingQty(true);
    setQtyValue(currentQty.toString());
    setUnitValue(material.unit ?? 'units');
  };

  const handleToggleRequiresCnc = async () => {
    const next = !material.requiresCnc;
    try {
      const updated = await partsService.updatePartMaterial(material.id, { requiresCnc: next });
      if (updated) {
        showToast(next ? 'Marked: needs CNC' : 'Marked: no CNC', 'success');
        onUpdate();
      } else {
        showToast('Failed to update material', 'error');
      }
    } catch {
      showToast('Failed to update material', 'error');
    }
  };

  return (
    <div
      role={onNavigate ? 'button' : undefined}
      tabIndex={onNavigate ? 0 : undefined}
      onClick={onNavigate ? () => onNavigate('inventory-detail', material.inventoryId) : undefined}
      onKeyDown={
        onNavigate
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('inventory-detail', material.inventoryId);
              }
            }
          : undefined
      }
      className={`flex min-h-[7rem] flex-col rounded border border-line bg-white/5 p-3 ${onNavigate ? 'cursor-pointer transition-colors hover:border-primary/30 hover:bg-white/10' : ''} ${className}`}
    >
      <div className="min-h-0 flex-1">
        <p className="truncate text-sm font-medium text-white" title={name}>
          {name}
        </p>
        {onNavigate && (
          <span className="mt-1 inline-block text-xs text-primary">View inventory →</span>
        )}
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1.5"
          onClick={(e) => onNavigate && e.stopPropagation()}
        >
          {editingQty ? (
            <>
              <input
                type="number"
                step="0.01"
                min={0}
                value={qtyValue}
                onChange={(e) => setQtyValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  else if (e.key === 'Escape') setEditingQty(false);
                }}
                autoFocus
                className="w-16 rounded border border-primary/50 bg-white/5 px-1.5 py-1 text-xs text-white focus:border-primary focus:outline-none"
              />
              <input
                type="text"
                value={unitValue}
                onChange={(e) => setUnitValue(e.target.value)}
                className="w-14 rounded border border-primary/50 bg-white/5 px-1.5 py-1 text-xs text-white focus:border-primary focus:outline-none"
              />
            </>
          ) : (
            <>
              <span className="text-xs text-muted">
                {displayQty} {material.unit}
              </span>
              <button
                type="button"
                onClick={startEdit}
                className="text-xs text-primary hover:underline"
              >
                Edit
              </button>
            </>
          )}
        </div>
        {cncAble && (
          <div className="mt-1.5" onClick={(e) => onNavigate && e.stopPropagation()}>
            <button
              type="button"
              role="switch"
              aria-checked={material.requiresCnc === true}
              title="Whether this foam needs to be CNC'd out — when on, it's pulled on the CNC step and the variant shows in the CNC checklist."
              onClick={() => void handleToggleRequiresCnc()}
              className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-bold transition-colors ${
                material.requiresCnc
                  ? 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/30'
                  : 'bg-white/5 text-muted hover:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">
                {material.requiresCnc ? 'toggle_on' : 'toggle_off'}
              </span>
              Needs CNC
            </button>
          </div>
        )}
        {showFinancials && (
          <div className="mt-1" onClick={(e) => onNavigate && e.stopPropagation()}>
            <MaterialCostDisplay ourCost={ourCost} />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleDelete}
        className="mt-2 flex shrink-0 items-center justify-center self-start rounded border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-colors hover:bg-red-500/20"
        aria-label="Remove material"
      >
        <span className="material-symbols-outlined text-base">delete</span>
      </button>
    </div>
  );
};

export default PartMaterialLink;
