/**
 * Legal notice (invariant G9) shown on every surface that displays tax, payroll, or
 * financial-report figures, and on data export. Wording matches the module overview.
 *
 * `representativeRates` appends the C1 sales-tax caveat ("Representative rates only.")
 * required on every sales-tax / tax-calendar screen and export — the seeded CDTFA
 * rates and filing cadences are representative, not authoritative.
 */
export function TaxDisclaimer({
  className = '',
  representativeRates = false,
}: {
  className?: string;
  representativeRates?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 ${className}`}
      role="note"
    >
      <span className="font-bold">Disclaimer:</span> Not certified tax software. Always verify with
      a CPA/EA. You are responsible for tax accuracy and timely filing.
      {representativeRates && <span className="font-semibold"> Representative rates only.</span>}
    </div>
  );
}
