import type { ReactNode } from 'react';

/**
 * Shared presentational primitives for the QuickBooks-style sales-document forms
 * (estimate/invoice — create + edit). These render the QB layout (sectioned cards, a
 * compact label:control meta block, stacked field blocks) using the app's own dark theme
 * tokens, so the forms read like QuickBooks but stay consistent with the rest of WorkTrackPro.
 */

/** One shared input style so every field across all four screens looks identical. */
export const docInputClass =
  'w-full rounded-md border border-white/10 bg-background-dark px-3 py-2 text-sm text-white placeholder:text-subtle focus:border-primary focus:outline-none disabled:opacity-60';

/** A titled section "card" — the QB paper-section look in the app's dark theme. */
export function SalesFormCard({
  title,
  right,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-white/10 bg-card-dark ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
          {title ? <h2 className="text-sm font-semibold text-white">{title}</h2> : <span />}
          {right}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Compact QuickBooks-style label:control row (label left, control right) for the header meta. */
export function MetaRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 sm:justify-end">
      <label htmlFor={htmlFor} className="shrink-0 text-xs font-medium text-muted sm:text-right">
        {label}
      </label>
      <div className="w-full sm:w-44">{children}</div>
    </div>
  );
}

/** A stacked label-over-control field block for the wider header/message fields. */
export function FieldBlock({
  label,
  htmlFor,
  hint,
  children,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </div>
  );
}
