import type { InputHTMLAttributes } from 'react';

interface CurrencyInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'type'
> {
  value: number;
  onValueChange: (value: number) => void;
}

/** Right-aligned money input. Emits a number; shows empty for zero so the field is
 *  comfortable to type into. */
export function CurrencyInput({
  value,
  onValueChange,
  className = '',
  ...props
}: CurrencyInputProps) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      value={value === 0 ? '' : value}
      onChange={(e) => {
        const n = Number.parseFloat(e.target.value);
        onValueChange(Number.isFinite(n) ? n : 0);
      }}
      className={`w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-right text-white placeholder:text-slate-600 focus:border-primary focus:outline-none ${className}`}
      placeholder="0.00"
      {...props}
    />
  );
}
