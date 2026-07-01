interface ProgressEstimateInputProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  disabled?: boolean;
}

export function ProgressEstimateInput({
  value,
  onChange,
  onSave,
  onClear,
  disabled,
}: ProgressEstimateInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
        }}
        className="w-full rounded border border-line bg-overlay/5 px-2 py-1.5 text-base text-white focus:border-primary/50 focus:outline-none"
        placeholder="Optional 0–100"
      />
      <button
        type="button"
        onClick={onClear}
        disabled={disabled}
        className="rounded border border-line-strong px-2 py-1 text-[10px] text-muted hover:bg-overlay/10"
      >
        Clear
      </button>
    </div>
  );
}
