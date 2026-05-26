interface ProgressEstimateProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function ProgressEstimate({ value, onChange, disabled }: ProgressEstimateProps) {
  const displayValue = value != null ? Math.round(value) : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-semibold text-white">Progress Estimate</label>
        <span className="text-xs text-slate-400">{displayValue}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={displayValue}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
