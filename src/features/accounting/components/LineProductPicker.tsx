import { useItems } from '../hooks/useAccountingQueries';

/** What the user picked in the line "Product/service" type dropdown. */
export type LineProductSelection =
  | { kind: 'item'; id: string }
  | { kind: 'part' }
  | { kind: 'none' };

/**
 * The line "Product/service" TYPE dropdown for SALES-DOCUMENT editors (estimate/invoice create
 * + draft-edit). It lists the things you can bill:
 *   - one entry per active Products & Services item (Labor, Delivery, Material, …), each of
 *     which carries its own income account so revenue posts to the right GL account, plus
 *   - a single **Part** option — choosing it flips the line into "part mode" and the Description
 *     cell reveals a part picker that auto-fills the line from the part quote, and
 *   - **Custom / other** for a free-text line with no catalog link.
 *
 * NOTE this dropdown does NOT list individual parts (there can be thousands) — "Part" is one
 * option and the specific part is chosen in the Description cell. A line is therefore a part XOR
 * an item XOR free text. EDITOR-ONLY: pulls in itemsService + react-query; never import it from
 * the read/render path (SalesDocument).
 */
export default function LineProductPicker({
  itemId,
  isPart,
  onSelect,
  disabled,
  className,
  id,
}: {
  itemId: string | null;
  /** True when the line is in "part mode" (a part is chosen, or Part was just selected). */
  isPart: boolean;
  onSelect: (sel: LineProductSelection) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { data: items = [], isPending } = useItems();

  const current = itemId ? `item:${itemId}` : isPart ? 'part' : '';
  const missingItem = !!itemId && !items.some((i) => i.id === itemId);

  const handle = (raw: string) => {
    if (raw === 'part') onSelect({ kind: 'part' });
    else if (raw.startsWith('item:')) onSelect({ kind: 'item', id: raw.slice(5) });
    else onSelect({ kind: 'none' });
  };

  return (
    <select
      id={id}
      className={
        className ??
        'h-10 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-white'
      }
      value={current}
      onChange={(e) => handle(e.target.value)}
      disabled={disabled || isPending}
      aria-label="Product or service"
    >
      <option value="">Custom / other</option>
      <option value="part">Part</option>
      {missingItem && <option value={`item:${itemId}`}>(current item)</option>}
      {items.map((i) => (
        <option key={i.id} value={`item:${i.id}`}>
          {i.name}
        </option>
      ))}
    </select>
  );
}
