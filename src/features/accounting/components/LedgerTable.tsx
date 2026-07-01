import type { ReactNode } from 'react';

export interface LedgerColumn {
  label: string;
  align?: 'left' | 'right';
}

interface LedgerTableProps {
  columns: LedgerColumn[];
  children: ReactNode; // <tr> rows
  /**
   * Row density. 'comfortable' (default) = roomier, QuickBooks-like rows; 'compact' tightens
   * them back down for very long ledgers (e.g. a full-year account register).
   */
  density?: 'comfortable' | 'compact';
  /** Subtle zebra striping. OFF by default — it would stripe report subtotal/section rows. */
  zebra?: boolean;
  /** Keep the column header pinned while a long body scrolls. */
  stickyHeader?: boolean;
}

/**
 * Dark-theme data table for ledgers, journal lines, and reports. Consumers supply <tr> rows as
 * children; use <td className="text-right tabular-nums"> for money cells.
 *
 * Body cell padding, row hover, and (optional) zebra are applied centrally here via wrapper
 * child-selectors, so every consumer gets the same roomier QuickBooks-like spacing WITHOUT
 * editing each <td>. The descendant selectors out-specify any per-cell `px-3 py-2` a consumer
 * still hardcodes, so spacing stays single-sourced.
 */
export function LedgerTable({
  columns,
  children,
  density = 'comfortable',
  zebra = false,
  stickyHeader = false,
}: LedgerTableProps) {
  const bodyPadY = density === 'compact' ? '[&_tbody_td]:py-2' : '[&_tbody_td]:py-3';
  const tableClass = [
    'w-full border-collapse text-sm',
    '[&_tbody_td]:px-4 [&_tbody_td]:align-middle',
    bodyPadY,
    '[&_tbody_tr:hover]:bg-white/[0.03]',
    zebra ? '[&_tbody_tr:nth-child(even)]:bg-white/[0.02]' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className={tableClass}>
        <thead>
          <tr
            className={`border-b border-line bg-white/5 text-muted ${
              stickyHeader ? 'sticky top-0 z-10' : ''
            }`}
          >
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
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
