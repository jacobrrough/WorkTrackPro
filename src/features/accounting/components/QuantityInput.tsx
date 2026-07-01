import type { InputHTMLAttributes } from 'react';

interface QuantityInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'type'
> {
  value: number;
  onValueChange: (value: number) => void;
}

/** Right-aligned whole-number quantity input. Emits a number; shows empty for zero so
 *  the field is comfortable to type into. A legacy fractional value displays rounded but
 *  is only re-saved on an actual edit. */
export function QuantityInput({
  value,
  onValueChange,
  className = '',
  ...props
}: QuantityInputProps) {
  return (
    <input
      type="number"
      inputMode="numeric"
      step="1"
      min="1"
      value={value === 0 ? '' : Math.round(value)}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        onValueChange(Number.isFinite(n) ? Math.max(1, n) : 1);
      }}
      className={`w-full rounded-lg border border-line bg-background-dark px-2 py-1.5 text-right text-white placeholder:text-subtle focus:border-primary focus:outline-none ${className}`}
      placeholder="1"
      {...props}
    />
  );
}
