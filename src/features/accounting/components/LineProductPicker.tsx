import { useQuery } from '@tanstack/react-query';
import { partsService } from '@/services/api/parts';
import { useItems } from '../hooks/useAccountingQueries';

/** What the user selected in the combined product/service dropdown. */
export type LineProductSelection =
  | { kind: 'item'; id: string }
  | { kind: 'part'; id: string }
  | { kind: 'none' };

/**
 * Combined "Product/service" select for SALES-DOCUMENT line editors (estimate/invoice create
 * + draft-edit). A line can bill:
 *   - a Products & Services item (accounting.items — e.g. Labor, Delivery, Material; each
 *     carries its own income account so revenue posts to the right GL account), or
 *   - a manufacturing part (public.parts — priced via the shared quote calculator), or
 *   - neither (a free-text line).
 *
 * Both catalogs share ONE dropdown via prefixed option values so the line model stays a
 * part XOR item XOR free-text choice:
 *   ''           → no linked product (free-text line)
 *   'item:<id>'  → an accounting item
 *   'part:<id>'  → a part
 *
 * A line already pointing at an item/part missing from the list (inactive, filtered) keeps a
 * "(current …)" option so the selection isn't silently lost.
 *
 * EDITOR-ONLY: this pulls in itemsService + partsService + react-query, so it mounts only in
 * the accounting create/edit views — never import it from the read/render path (SalesDocument).
 */
export default function LineProductPicker({
  itemId,
  partId,
  onSelect,
  disabled,
  className,
  id,
}: {
  itemId: string | null;
  partId: string | null;
  onSelect: (sel: LineProductSelection) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { data: items = [], isPending: itemsPending } = useItems();
  const { data: parts = [], isPending: partsPending } = useQuery({
    queryKey: ['parts'],
    queryFn: () => partsService.getAllParts(),
    staleTime: 5 * 60 * 1000,
  });
  const pending = itemsPending || partsPending;

  const current = itemId ? `item:${itemId}` : partId ? `part:${partId}` : '';
  const missingItem = !!itemId && !items.some((i) => i.id === itemId);
  const missingPart = !!partId && !parts.some((p) => p.id === partId);

  const handle = (raw: string) => {
    if (raw.startsWith('item:')) onSelect({ kind: 'item', id: raw.slice(5) });
    else if (raw.startsWith('part:')) onSelect({ kind: 'part', id: raw.slice(5) });
    else onSelect({ kind: 'none' });
  };

  return (
    <select
      id={id}
      className={
        className ??
        'h-10 w-full rounded-sm border border-line bg-surface-2 px-3 py-2 text-sm text-white'
      }
      value={current}
      onChange={(e) => handle(e.target.value)}
      disabled={disabled || pending}
      aria-label="Product or service"
    >
      <option value="">{pending ? 'Loading…' : 'No linked product'}</option>
      {missingItem && <option value={`item:${itemId}`}>(current item)</option>}
      {missingPart && <option value={`part:${partId}`}>(current part)</option>}
      {items.length > 0 && (
        <optgroup label="Products &amp; services">
          {items.map((i) => (
            <option key={i.id} value={`item:${i.id}`}>
              {i.name}
            </option>
          ))}
        </optgroup>
      )}
      {parts.length > 0 && (
        <optgroup label="Parts">
          {parts.map((p) => (
            <option key={p.id} value={`part:${p.id}`}>
              {p.partNumber}
              {p.name ? ' — ' + p.name : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
