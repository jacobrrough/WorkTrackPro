interface VariantBreakdownEntry {
  suffix: string;
  qty: number;
  laborHoursTotal?: number;
  cncHoursTotal?: number;
  printer3DHoursTotal?: number;
}

interface VariantBreakdownProps {
  entries: VariantBreakdownEntry[];
}

export function VariantBreakdown({ entries }: VariantBreakdownProps) {
  if (!entries || entries.length === 0) return null;

  return (
    <div className="mb-3 space-y-0.5">
      {entries.map(({ suffix, qty, laborHoursTotal, cncHoursTotal, printer3DHoursTotal }) => (
        <div key={suffix} className="flex justify-between text-[10px] text-slate-400">
          {suffix} ×{qty} = L {(laborHoursTotal ?? 0).toFixed(1)}h / CNC{' '}
          {(cncHoursTotal ?? 0).toFixed(1)}h / 3D {(printer3DHoursTotal ?? 0).toFixed(1)}h
        </div>
      ))}
    </div>
  );
}
