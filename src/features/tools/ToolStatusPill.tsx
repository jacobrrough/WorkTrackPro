import type { Tool } from '@/core/types';

const STYLES: Record<Tool['status'], string> = {
  available: 'bg-green-500/20 text-green-300 border-green-500/30',
  out: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  retired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

/** Compact custody status pill. Pass `holderLabel` to append the holder when a tool is out. */
export function ToolStatusPill({ tool, holderLabel }: { tool: Tool; holderLabel?: string }) {
  const text =
    tool.status === 'retired'
      ? 'Retired'
      : tool.status === 'out'
        ? `Out${holderLabel ? ` · ${holderLabel}` : ''}`
        : 'Available';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${STYLES[tool.status]}`}
    >
      {text}
    </span>
  );
}
