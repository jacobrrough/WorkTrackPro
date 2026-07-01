/**
 * Red "Short N" badge shown on inventory rows that need reordering. Shared by the hub and the
 * All Parts list so the two read identically (same style + tooltip) — mirrors the stockStatePill
 * pattern. `shortfall` is StockComputed.shortfall (units still needed, net of what's on order);
 * renders nothing when it's 0. `className` is a layout slot for the calling row (e.g. `shrink-0`).
 */
export function ShortBadge({
  shortfall,
  className = '',
}: {
  shortfall: number;
  className?: string;
}) {
  if (shortfall <= 0) return null;
  return (
    <span
      className={`rounded-2xl border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-300 ${className}`}
      title="Units still needed to reach the reorder point and cover job demand, after what's on order"
    >
      Short {shortfall}
    </span>
  );
}
