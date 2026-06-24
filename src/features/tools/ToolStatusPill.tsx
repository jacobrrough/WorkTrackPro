import type { InventoryItem } from '@/core/types';

/** Compact custody status pill for a tool. Pass `holderLabel` to append the holder when out. */
export function ToolStatusPill({
  item,
  holderLabel,
}: {
  item: InventoryItem;
  holderLabel?: string;
}) {
  const out = !!item.currentHolderId;
  const className = out
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    : 'bg-green-500/20 text-green-300 border-green-500/30';
  const text = out ? `Out${holderLabel ? ` · ${holderLabel}` : ''}` : 'Available';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${className}`}
    >
      {text}
    </span>
  );
}
