import { useDimensionsByType } from '../hooks/useAccountingQueries';
import { DIMENSION_TYPE_LABELS, type DimensionType } from '../types';

interface DimensionPickerProps {
  /** Which dimension kind to list (class / location / department). */
  type: DimensionType;
  /** Selected dimension id, or '' for none. */
  value: string;
  onChange: (dimensionId: string) => void;
  id?: string;
  ariaLabel?: string;
  className?: string;
  /** Disable the control (e.g. while a parent form is busy). */
  disabled?: boolean;
}

/**
 * Type-scoped reporting-dimension select backed by accounting.dimensions (B2). A thin
 * sibling of AccountPicker: it lists only the active dimensions of ONE type so the
 * value can be threaded straight onto a journal/invoice/bill line's class/location/
 * department field. An empty value means "no dimension" — every dimension column is
 * nullable, so leaving it blank is always valid.
 *
 * Reusable on the invoice, bill, and journal line editors and on the recurring payload
 * editor; it never moves money, it only tags a line for reporting.
 */
export function DimensionPicker({
  type,
  value,
  onChange,
  id,
  ariaLabel,
  className = '',
  disabled = false,
}: DimensionPickerProps) {
  const { data: dimensions = [], isLoading } = useDimensionsByType(type);
  const label = DIMENSION_TYPE_LABELS[type];

  return (
    <select
      id={id}
      aria-label={ariaLabel ?? label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading}
      className={`w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none ${className}`}
    >
      <option value="">{isLoading ? 'Loading…' : `No ${label.toLowerCase()}`}</option>
      {dimensions.map((d) => (
        <option key={d.id} value={d.id}>
          {d.code ? `${d.code} · ` : ''}
          {d.name}
        </option>
      ))}
    </select>
  );
}
