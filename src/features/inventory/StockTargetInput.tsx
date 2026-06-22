import React from 'react';

interface StockTargetInputProps {
  /** Canonical value shown when the field isn't being actively edited. */
  value: number;
  /** Parsed number on each keystroke — NaN when the field is empty (caller treats as no-op). */
  onChangeNumber: (value: number) => void;
  className?: string;
  ariaLabel: string;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
}

// Stock count box backed by a local string draft so the field can be fully cleared while typing
// rather than being stuck with a value you can't delete. Focusing the box selects its contents,
// so the first keystroke replaces the existing number (typing over a "0" gives "5", not "05")
// and you can still backspace to empty. The canonical numeric value is re-displayed on blur.
export function StockTargetInput({
  value,
  onChangeNumber,
  className,
  ariaLabel,
  onClick,
}: StockTargetInputProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={draft ?? String(value)}
      onClick={onClick}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        onChangeNumber(parseFloat(e.target.value));
      }}
      onBlur={() => setDraft(null)}
      className={className}
      aria-label={ariaLabel}
    />
  );
}
