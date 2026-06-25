import type { ReactNode } from 'react';
import { formatMoney } from '../../accountingViewModel';
import type { InvoiceTotals } from '../../posting';
import type { TaxCode } from '../../types';
import { docInputClass } from './salesFormUi';

/**
 * QuickBooks-style totals panel shared by the estimate/invoice create + edit screens. Shows
 * Subtotal, Taxable subtotal, the sales-tax-rate selector (the header tax code, surfaced here
 * like QuickBooks' "Select sales tax rate"), Sales tax, and the document Total. Tax math is the
 * caller's `totals` (computed by the same pure function the service posts with), so the on-screen
 * figure equals the saved document.
 */
export interface SalesDocumentTotalsPanelProps {
  kind: 'invoice' | 'estimate';
  totals: InvoiceTotals;
  taxCodes: TaxCode[];
  /** Currently-selected (effective) header tax code; '' = no tax. */
  taxCodeId: string;
  onTaxCodeId: (v: string) => void;
  /** When an org default exists the empty option reads "No tax" (an explicit choice). */
  hasDefaultTaxCode?: boolean;
  /** Optional hint under the selector (e.g. the address auto-suggest note). */
  hint?: ReactNode;
  /** Tax-exempt customer — the selector is suppressed and a note shown instead. */
  taxExempt?: boolean;
  disabled?: boolean;
}

function Row({
  label,
  value,
  strong,
  big,
}: {
  label: ReactNode;
  value: string;
  strong?: boolean;
  big?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        strong ? 'border-t border-white/10 pt-2 text-white' : 'text-muted'
      }`}
    >
      <span className={strong ? 'font-semibold' : ''}>{label}</span>
      <span
        className={`font-mono tabular-nums ${big ? 'text-lg font-bold text-white' : strong ? 'font-semibold' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

export function SalesDocumentTotalsPanel({
  kind,
  totals,
  taxCodes,
  taxCodeId,
  onTaxCodeId,
  hasDefaultTaxCode,
  hint,
  taxExempt,
  disabled,
}: SalesDocumentTotalsPanelProps) {
  const taxableSubtotalCents = totals.lines.reduce(
    (sum, l) => (l.taxable ? sum + l.netCents : sum),
    0
  );
  const totalLabel = kind === 'estimate' ? 'Estimate total' : 'Invoice total';

  return (
    <div className="rounded-lg border border-white/10 bg-card-dark p-4 text-sm">
      <div className="space-y-2">
        <Row label="Subtotal" value={formatMoney(totals.subtotalCents / 100)} />
        <Row label="Taxable subtotal" value={formatMoney(taxableSubtotalCents / 100)} />

        {taxExempt ? (
          <p className="text-xs text-amber-300">Customer is tax-exempt — no sales tax applied.</p>
        ) : (
          <div>
            <label
              htmlFor={`${kind}-taxrate`}
              className="mb-1 block text-xs font-medium text-muted"
            >
              Sales tax rate
            </label>
            <select
              id={`${kind}-taxrate`}
              className={docInputClass}
              value={taxCodeId}
              onChange={(e) => onTaxCodeId(e.target.value)}
              disabled={disabled}
            >
              <option value="">{hasDefaultTaxCode ? 'No tax' : 'None'}</option>
              {taxCodes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isTaxable ? ` (${(t.rate * 100).toFixed(3)}%)` : ' (non-taxable)'}
                </option>
              ))}
            </select>
            {hint && <div className="mt-1">{hint}</div>}
          </div>
        )}

        <Row label="Sales tax" value={formatMoney(totals.taxCents / 100)} />
        <Row label={totalLabel} value={formatMoney(totals.totalCents / 100)} strong big />
      </div>
    </div>
  );
}

export default SalesDocumentTotalsPanel;
