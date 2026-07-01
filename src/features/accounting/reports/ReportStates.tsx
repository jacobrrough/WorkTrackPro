import type { ReactNode } from 'react';
import { formatAccounting } from './reportFormat';

/** Loading placeholder shared by the report screens. */
export function ReportLoading({ label = 'Loading report…' }: { label?: string }) {
  return <p className="text-muted">{label}</p>;
}

/** Error placeholder shared by the report screens. */
export function ReportError({
  message = 'Could not load this report. Confirm the accounting schema is exposed and you have an accounting role.',
}: {
  message?: string;
}) {
  return (
    <p className="text-red-400" role="alert">
      {message}
    </p>
  );
}

/** Empty-state placeholder (no posted activity in the window). */
export function ReportEmpty({ icon, note }: { icon: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
      <span className="material-symbols-outlined text-4xl text-subtle">{icon}</span>
      <p className="text-lg font-bold text-white">No data for this period</p>
      <p className="max-w-sm text-sm text-muted">{note}</p>
    </div>
  );
}

/** Right-aligned, tabular money cell (accounting-style negatives). */
export function MoneyCell({ amount, strong = false }: { amount: number; strong?: boolean }) {
  const negative = amount < 0;
  return (
    <td
      className={`px-3 py-2 text-right font-mono tabular-nums ${
        strong ? 'font-bold text-white' : negative ? 'text-red-400' : 'text-white'
      }`}
    >
      {formatAccounting(amount)}
    </td>
  );
}

/** Green/amber pill summarizing whether a statement ties out. */
export function BalancedBadge({ balanced, label }: { balanced: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        balanced ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'
      }`}
    >
      <span className="material-symbols-outlined text-sm">
        {balanced ? 'check_circle' : 'warning'}
      </span>
      {label ?? (balanced ? 'In balance' : 'Out of balance')}
    </span>
  );
}

/** A full-width section subtotal row inside a LedgerTable. */
export function SubtotalRow({
  label,
  amount,
  colSpan,
}: {
  label: string;
  amount: number;
  colSpan: number;
}) {
  return (
    <tr className="border-t border-line bg-overlay/5">
      <td className="px-3 py-2 font-bold text-white" colSpan={colSpan}>
        {label}
      </td>
      <MoneyCell amount={amount} strong />
    </tr>
  );
}

/** A labeled section header row spanning the table. */
export function SectionHeaderRow({ title, span }: { title: string; span: number }) {
  return (
    <tr className="bg-overlay/[0.03]">
      <td
        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted"
        colSpan={span}
      >
        {title}
      </td>
    </tr>
  );
}

/** Wrapper that vertically stacks a report's header block and body with spacing. */
export function ReportBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-3xl flex-col gap-4">{children}</div>;
}
