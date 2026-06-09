import React from 'react';

interface EmptyStateProps {
  /** Material Symbols icon name (e.g. "inventory_2"). */
  icon: string;
  /** Bold headline, e.g. "No active jobs". */
  title: string;
  /** Optional subtle hint shown under the title. */
  hint?: string;
  /** Optional action (e.g. a button) shown under the hint. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Shared empty-state block for list views. Mirrors the dashed-border, centered
 * icon + bold title + slate hint pattern already used across the accounting
 * views, so every "nothing here yet" surface looks consistent on the dark UI.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  hint,
  action,
  className = '',
}) => {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center ${className}`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-4xl text-slate-500">
        {icon}
      </span>
      <p className="text-lg font-bold text-white">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-400">{hint}</p>}
      {action}
    </div>
  );
};

export default EmptyState;
