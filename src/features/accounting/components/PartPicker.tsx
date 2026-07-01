import { useQuery } from '@tanstack/react-query';
import { partsService } from '@/services/api/parts';

/**
 * Part select for the SALES-DOCUMENT line editor's Description cell. It only appears once a
 * line's "Product/service" type is set to **Part**; choosing a part here auto-fills the line
 * (description + quote price + whole-number qty) via the editor's resolver. EDITOR-ONLY — it
 * pulls in partsService + react-query, so it must never be imported by the read/render path.
 *
 * Value semantics: '' = no part chosen yet (persisted as NULL). A line already pointing at a
 * part that's missing from the list still keeps it selectable via a '(current part)' option.
 */
export default function PartPicker({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string | null;
  onChange: (partId: string | null) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { data: parts = [], isPending } = useQuery({
    queryKey: ['parts'],
    queryFn: () => partsService.getAllParts(),
    staleTime: 5 * 60 * 1000,
  });
  const current = value ?? '';
  // Keep a line's part selectable even if it's not in the list (e.g. deleted/filtered).
  const missingCurrent = current !== '' && !parts.some((p) => p.id === current);

  return (
    <select
      id={id}
      className={
        className ??
        'h-10 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-white'
      }
      value={current}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled || isPending}
      aria-label="Part"
    >
      <option value="">{isPending ? 'Loading parts…' : 'Select a part…'}</option>
      {missingCurrent && <option value={current}>(current part)</option>}
      {parts.map((p) => (
        <option key={p.id} value={p.id}>
          {p.partNumber}
          {p.name ? ' — ' + p.name : ''}
        </option>
      ))}
    </select>
  );
}
