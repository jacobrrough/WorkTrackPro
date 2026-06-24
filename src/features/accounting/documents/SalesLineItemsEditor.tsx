import { useMemo, type CSSProperties } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toCents, formatMoney } from '../accountingViewModel';
import { CurrencyInput } from '../components/CurrencyInput';
import { QuantityInput } from '../components/QuantityInput';
import PartPicker from '../components/PartPicker';
import { usePartLineResolver } from './usePartLineResolver';
import type { NewInvoiceLineInput } from '../types';

/**
 * A controlled sales-document line (invoice/estimate). Extends NewInvoiceLineInput with an
 * optional transient `_key` for stable drag-and-drop identity. `lineRows` (the persistence
 * mapper) ignores unknown fields, so `_key` never reaches the DB.
 */
export interface EditorLine extends NewInvoiceLineInput {
  /** Transient stable key for dnd; not persisted. */
  _key?: string;
}

const inputClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** Local net (post-discount) amount of a line, in cents — mirrors posting.lineNetCents for the
 *  amount cell when the caller hasn't supplied a precomputed lineAmountsCents. */
function localNetCents(line: EditorLine): number {
  if (line.lineTotal != null) {
    const net = toCents(line.lineTotal);
    return net > 0 ? net : 0;
  }
  const discountCents = toCents(line.discount ?? 0);
  const grossCents = Math.round((toCents(line.quantity) * toCents(line.unitPrice)) / 100);
  const net = grossCents - discountCents;
  return net > 0 ? net : 0;
}

interface SalesLineItemsEditorProps {
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  /** Optional precomputed per-line net amounts (cents) from the owner's totals; used for the
   *  amount cell when provided so the on-screen amount equals the persisted figure. */
  lineAmountsCents?: number[];
  disabled?: boolean;
}

interface LineRowProps {
  line: EditorLine;
  index: number;
  amountCents: number;
  disabled?: boolean;
  canRemove: boolean;
  onPatch: (patch: Partial<EditorLine>) => void;
  onPickPart: (partId: string | null) => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}

function LineRow({
  line,
  index,
  amountCents,
  disabled,
  canRemove,
  onPatch,
  onPickPart,
  onQuantity,
  onRemove,
}: LineRowProps) {
  const sortableId = line._key ?? String(index);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasPart = !!line.partId;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[24px_1fr_60px_84px_32px] items-center gap-2 md:grid-cols-[24px_1fr_140px_70px_100px_90px_70px_32px]"
    >
      {/* Drag handle — only the handle starts a drag, so the inputs stay usable. */}
      <button
        type="button"
        aria-label={`Reorder line ${index + 1}`}
        className="flex cursor-grab items-center justify-center text-subtle hover:text-muted active:cursor-grabbing disabled:opacity-30"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <span className="material-symbols-outlined text-lg">drag_indicator</span>
      </button>

      <input
        aria-label={`Line ${index + 1} description`}
        className={`${inputClass} col-span-4 md:col-span-1`}
        value={line.description ?? ''}
        onChange={(e) => onPatch({ description: e.target.value })}
        placeholder="Description"
        disabled={disabled}
      />

      {/* Link part — seeds description/price from the part quote; user can still edit after. */}
      <div className="col-span-4 md:col-span-1">
        <PartPicker
          id={`line-${index + 1}-part`}
          value={line.partId ?? null}
          onChange={onPickPart}
          disabled={disabled}
          className={`${inputClass} h-auto`}
        />
      </div>

      {/* Integer qty for part-linked lines only; decimal qty otherwise. */}
      {hasPart ? (
        <QuantityInput
          aria-label={`Line ${index + 1} quantity`}
          value={line.quantity ?? 0}
          onValueChange={onQuantity}
          disabled={disabled}
        />
      ) : (
        <CurrencyInput
          aria-label={`Line ${index + 1} quantity`}
          value={line.quantity ?? 0}
          onValueChange={onQuantity}
          disabled={disabled}
        />
      )}

      <CurrencyInput
        aria-label={`Line ${index + 1} unit price`}
        value={line.unitPrice ?? 0}
        onValueChange={(v) =>
          // User-entered price supersedes any imported/seeded explicit lineTotal.
          onPatch({ unitPrice: v, lineTotal: undefined })
        }
        disabled={disabled}
      />

      <span className="hidden text-right font-mono text-sm tabular-nums text-muted md:block">
        {formatMoney(amountCents / 100)}
      </span>

      <label className="flex items-center justify-center">
        <input
          type="checkbox"
          aria-label={`Line ${index + 1} taxable`}
          checked={line.taxable !== false}
          onChange={(e) => onPatch({ taxable: e.target.checked })}
          className="size-4 rounded-sm border-white/20 bg-background-dark"
          disabled={disabled}
        />
      </label>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove line ${index + 1}`}
        disabled={disabled || !canRemove}
        className="flex items-center justify-center rounded-sm text-subtle hover:bg-white/10 hover:text-red-400 disabled:opacity-30"
      >
        <span className="material-symbols-outlined text-lg">delete</span>
      </button>
    </div>
  );
}

/**
 * Controlled sales-document line grid shared by the invoice/estimate create + draft-edit
 * views. Mirrors InvoiceCreateView's grid (description, qty, unit price, amount, taxable,
 * delete) and adds a per-line "Link part" picker plus drag-to-reorder. Pricing on part-pick
 * / qty-change reuses the shared part-quote core via usePartLineResolver, so an editor line
 * is priced exactly like the invoice-from-job seam (SEED, not lock — the user can still edit).
 */
export default function SalesLineItemsEditor({
  lines,
  onChange,
  lineAmountsCents,
  disabled,
}: SalesLineItemsEditorProps) {
  const { resolve } = usePartLineResolver();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Stable dnd ids: prefer the line's transient _key, fall back to its index.
  const itemIds = useMemo(() => lines.map((l, i) => l._key ?? String(i)), [lines]);

  const patchLine = (index: number, patch: Partial<EditorLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const onPickPart = async (index: number, partId: string | null) => {
    if (!partId) {
      // Clearing the part: drop the link only; leave description/price as the user left them.
      patchLine(index, { partId: null });
      return;
    }
    const current = lines[index];
    // Set the link immediately so the qty input flips to whole-number while pricing resolves.
    patchLine(index, { partId });
    const result = await resolve(partId, current.quantity || 1);
    if (!result) return;
    // Seed description + price from the part quote (don't lock — user can edit after).
    patchLine(index, {
      partId,
      description: result.description,
      unitPrice: result.unitPrice,
      lineTotal: result.lineTotal,
    });
  };

  const onQuantity = async (index: number, quantity: number) => {
    const current = lines[index];
    if (current.partId) {
      // Re-price a part-linked line at the new quantity (re-seed unit price + line total).
      patchLine(index, { quantity });
      const result = await resolve(current.partId, quantity);
      if (!result) return;
      patchLine(index, {
        quantity,
        unitPrice: result.unitPrice,
        lineTotal: result.lineTotal,
      });
      return;
    }
    // Non-part line: user-entered quantity supersedes any imported explicit lineTotal.
    patchLine(index, { quantity, lineTotal: undefined });
  };

  const removeLine = (index: number) => {
    if (lines.length <= 1) return; // keep >= 1 line
    onChange(lines.filter((_, i) => i !== index));
  };

  const addLine = () =>
    onChange([
      ...lines,
      { description: '', quantity: 1, unitPrice: 0, discount: 0, taxable: true },
    ]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(active.id as string);
    const to = itemIds.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(lines, from, to));
  };

  return (
    <div>
      <div className="hidden grid-cols-[24px_1fr_140px_70px_100px_90px_70px_32px] gap-2 px-1 pb-1 text-xs font-semibold uppercase text-subtle md:grid">
        <span />
        <span>Description</span>
        <span>Part</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Tax</span>
        <span />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {lines.map((line, i) => {
              const amountCents = lineAmountsCents?.[i] ?? localNetCents(line);
              return (
                <LineRow
                  key={line._key ?? i}
                  line={line}
                  index={i}
                  amountCents={amountCents}
                  disabled={disabled}
                  canRemove={lines.length > 1}
                  onPatch={(patch) => patchLine(i, patch)}
                  onPickPart={(partId) => void onPickPart(i, partId)}
                  onQuantity={(quantity) => void onQuantity(i, quantity)}
                  onRemove={() => removeLine(i)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={addLine}
        disabled={disabled}
        className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-lg">add</span>
        Add line
      </button>
    </div>
  );
}
