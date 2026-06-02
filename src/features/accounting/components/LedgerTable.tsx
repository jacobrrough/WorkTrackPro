import type { ReactNode } from 'react';

export interface LedgerColumn {
  label: string;
  align?: 'left' | 'right';
}

interface LedgerTableProps {
  columns: LedgerColumn[];
  children: ReactNode; // <tr> rows
}

/** Dense, dark-theme data table for ledgers, journal lines, and reports. Consumers
 *  supply <tr> rows as children; use <td className="text-right tabular-nums"> for
 *  money cells. */
export function LedgerTable({ columns, children }: LedgerTableProps) {
  return (
    <div className="overflow-x-auto rounded-sm border border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5 text-slate-400">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
