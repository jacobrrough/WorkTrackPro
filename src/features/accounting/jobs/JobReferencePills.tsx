import { Link } from 'react-router-dom';
import { ACCOUNTING_BASE, ESTIMATES_BASE } from '../constants';
import { useEstimateByNumber, useInvoiceByNumber } from '../hooks/useAccountingQueries';

/**
 * EST#/INV# reference pills that resolve a job's free-text numbers to the REAL estimate /
 * invoice documents, deep-link into the accounting module, and surface the matched customer.
 *
 * Mounted only when accounting is built in (lazily, behind ACCOUNTING_BUILD_ENABLED in
 * JobDetail), so a flag-off build carries none of this. A number that doesn't resolve (typo,
 * not-yet-synced doc) falls back to a plain, unlinked pill — identical to the legacy display.
 * The linked detail routes keep their own admin gate; the pill/customer are safe to show.
 */

const PILL = 'rounded px-2 py-1 text-xs font-medium';
const EST_PILL = `${PILL} bg-purple-500/20 text-purple-300`;
const INV_PILL = `${PILL} bg-green-500/20 text-green-300`;
const LINKED = 'transition hover:brightness-125 hover:underline';

export default function JobReferencePills({
  estNumber,
  invNumber,
}: {
  estNumber?: string | null;
  invNumber?: string | null;
}) {
  const est = useEstimateByNumber(estNumber);
  const inv = useInvoiceByNumber(invNumber);
  const customerName = inv.data?.customerName ?? est.data?.customerName ?? null;

  return (
    <>
      {estNumber &&
        (est.data ? (
          <Link
            to={`${ESTIMATES_BASE}/${est.data.id}`}
            className={`${EST_PILL} ${LINKED}`}
            title="Open estimate"
          >
            EST #{estNumber}
          </Link>
        ) : (
          <span className={EST_PILL}>EST #{estNumber}</span>
        ))}

      {invNumber &&
        (inv.data ? (
          <Link
            to={`${ACCOUNTING_BASE}/invoices/${inv.data.id}`}
            className={`${INV_PILL} ${LINKED}`}
            title="Open invoice"
          >
            INV# {invNumber}
          </Link>
        ) : (
          <span className={INV_PILL}>INV# {invNumber}</span>
        ))}

      {customerName && (
        <span
          className={`${PILL} inline-flex items-center gap-1 bg-overlay/10 text-white`}
          title="Customer (from the linked document)"
        >
          <span className="material-symbols-outlined text-sm leading-none">person</span>
          {customerName}
        </span>
      )}
    </>
  );
}
