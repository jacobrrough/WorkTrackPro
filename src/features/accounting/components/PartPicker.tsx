import { useQuery } from '@tanstack/react-query';
import { partsService } from '@/services/api/parts';

/**
 * Part picker for SALES-DOCUMENT line editors (estimate/invoice create + edit). Links a
 * line to a real public.parts row. EDITOR-ONLY — it mounts inside accounting create/edit
 * views (which already pull in accounting code), so importing partsService + react-query
 * here is fine. It must NOT be imported by SalesDocument (the read/render path).
 *
 * Value semantics: '' = no linked part (persisted as NULL). A line already pointing at a
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
        'h-10 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-3 py-2 text-sm text-white'
      }
      value={current}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled || isPending}
      aria-label="Part"
    >
      <option value="">{isPending ? 'Loading parts…' : 'No linked part'}</option>
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
