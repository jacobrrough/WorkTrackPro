import { useMemo, type CSSProperties, type ReactNode } from 'react';
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
import LineProductPicker, { type LineProductSelection } from '../components/LineProductPicker';
import { SalesFormCard, docInputClass } from './form/salesFormUi';
import { usePartLineResolver } from './usePartLineResolver';
import { useItems } from '../hooks/useAccountingQueries';
import { lineFromItem } from './lineFromItem';
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

/**
 * Shared grid template (desktop) for the QuickBooks-style line table. The header row and every
 * line row use this same template so the columns line up:
 *   drag | # | Product/service | Description | Qty | Rate | Amount | Tax | delete
 * Each line wraps its controls in `md:contents` wrappers so on mobile they stack into a card and
 * on md+ they flow into these columns without duplicating JSX.
 */
const DESKTOP_GRID = 'md:grid-cols-[24px_24px_180px_minmax(0,1fr)_68px_104px_112px_44px_32px]';

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
  /** Optional control rendered top-right in the table card header (e.g. a "From job" button). */
  headerAction?: ReactNode;
  disabled?: boolean;
}

interface LineRowProps {
  line: EditorLine;
  index: number;
  amountCents: number;
  disabled?: boolean;
  canRemove: boolean;
  onPatch: (patch: Partial<EditorLine>) => void;
  onSelect: (sel: LineProductSelection) => void;
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
  onSelect,
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
      className={`grid grid-cols-[24px_minmax(0,1fr)_32px] items-start gap-2 rounded-md border border-white/10 bg-background-dark/40 p-2 md:items-center md:gap-2 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-1.5 ${DESKTOP_GRID}`}
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

      {/* Row number — desktop only. */}
      <span className="hidden items-center justify-center text-xs tabular-nums text-subtle md:flex">
        {index + 1}
      </span>

      {/* Mobile stacks these into a card; md:contents flattens them into the table columns. */}
      <div className="min-w-0 space-y-2 md:contents">
        <LineProductPicker
          id={`line-${index + 1}-product`}
          itemId={line.itemId ?? null}
          partId={line.partId ?? null}
          onSelect={onSelect}
          disabled={disabled}
          className={`${docInputClass} h-auto`}
        />

        <input
          aria-label={`Line ${index + 1} description`}
          className={docInputClass}
          value={line.description ?? ''}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder="Description"
          disabled={disabled}
        />

        {/* Qty / Rate / Amount / Tax — a 4-up row on mobile, individual columns on desktop. */}
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 md:contents">
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
            aria-label={`Line ${index + 1} rate`}
            value={line.unitPrice ?? 0}
            onValueChange={(v) =>
              // User-entered price supersedes any imported/seeded explicit lineTotal.
              onPatch({ unitPrice: v, lineTotal: undefined })
            }
            disabled={disabled}
          />

          <span className="text-right font-mono text-sm tabular-nums text-white">
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
        </div>
      </div>

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
 * Controlled QuickBooks-style "Product or service" table shared by the invoice/estimate create +
 * draft-edit views. Columns: Product/service (a part link), Description, Qty, Rate, Amount, Tax,
 * plus drag-to-reorder. Pricing on part-pick / qty-change reuses the shared part-quote core via
 * usePartLineResolver, so an editor line is priced exactly like the invoice-from-job seam (SEED,
 * not lock — the user can still edit).
 */
export default function SalesLineItemsEditor({
  lines,
  onChange,
  lineAmountsCents,
  headerAction,
  disabled,
}: SalesLineItemsEditorProps) {
  const { resolve } = usePartLineResolver();
  const { data: items = [] } = useItems();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Stable dnd ids: prefer the line's transient _key, fall back to its index.
  const itemIds = useMemo(() => lines.map((l, i) => l._key ?? String(i)), [lines]);

  const patchLine = (index: number, patch: Partial<EditorLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const onPickPart = async (index: number, partId: string) => {
    const current = lines[index];
    // Set the link immediately so the qty input flips to whole-number while pricing resolves.
    // A part bills the default sales income, so drop any item link + per-line income account.
    patchLine(index, { partId, itemId: null, incomeAccountId: null });
    const result = await resolve(partId, current.quantity || 1);
    if (!result) return;
    // Seed description + price from the part quote (don't lock — user can edit after).
    patchLine(index, {
      partId,
      itemId: null,
      incomeAccountId: null,
      description: result.description,
      unitPrice: result.unitPrice,
      lineTotal: result.lineTotal,
    });
  };

  const onSelectProduct = (index: number, sel: LineProductSelection) => {
    if (sel.kind === 'none') {
      // Clear any product link; leave description/price as the user left them.
      patchLine(index, { itemId: null, partId: null, incomeAccountId: null });
      return;
    }
    if (sel.kind === 'part') {
      void onPickPart(index, sel.id);
      return;
    }
    // An accounting item (Labor / Delivery / Material / …): seed description, price, income
    // account + tax code from the catalog so the revenue posts to the item's income account.
    const item = items.find((i) => i.id === sel.id);
    if (!item) {
      patchLine(index, { itemId: sel.id, partId: null });
      return;
    }
    patchLine(index, lineFromItem(item, lines[index]));
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

  const emptyLine = (): EditorLine => ({
    description: '',
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    taxable: true,
  });

  const addLine = () => onChange([...lines, emptyLine()]);

  const clearAllLines = () => onChange([emptyLine()]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(active.id as string);
    const to = itemIds.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(lines, from, to));
  };

  return (
    <SalesFormCard title="Product or service" right={headerAction} bodyClassName="p-3 sm:p-4">
      {/* Column header — desktop only (mobile rows are self-describing cards). */}
      <div
        className={`hidden gap-2 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-subtle md:grid ${DESKTOP_GRID}`}
      >
        <span />
        <span className="text-center">#</span>
        <span>Product/service</span>
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Tax</span>
        <span />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 md:space-y-0 md:divide-y md:divide-white/5">
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
                  onSelect={(sel) => onSelectProduct(i, sel)}
                  onQuantity={(quantity) => void onQuantity(i, quantity)}
                  onRemove={() => removeLine(i)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-3 flex items-center gap-4 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={addLine}
          disabled={disabled}
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          Add product or service
        </button>
        <button
          type="button"
          onClick={clearAllLines}
          disabled={disabled || lines.length <= 1}
          className="text-sm font-medium text-muted hover:text-white disabled:opacity-40"
        >
          Clear all lines
        </button>
      </div>
    </SalesFormCard>
  );
}
