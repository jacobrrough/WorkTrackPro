import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { usePurchaseOrders } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { PURCHASE_ORDERS_BASE } from '../constants';
import { PO_STATUS_LABELS, type PurchaseOrder, type PoStatus } from '../types';

const STATUS_STYLES: Record<PoStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  open: 'bg-sky-500/15 text-sky-400',
  partially_received: 'bg-amber-500/15 text-amber-400',
  received: 'bg-green-500/15 text-green-400',
  closed: 'bg-violet-500/15 text-violet-400',
  cancelled: 'bg-red-500/15 text-red-400',
};

function StatusPill({ status }: { status: PoStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {PO_STATUS_LABELS[status]}
    </span>
  );
}

function PORow({ po, onOpen }: { po: PurchaseOrder; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"
    >
      <span className="w-24 shrink-0 truncate font-mono text-xs text-slate-500">
        {po.poNumber || 'Draft'}
      </span>
      <span className="w-24 shrink-0 text-sm text-slate-400">{po.orderDate}</span>
      <span className="flex-1 truncate text-white">{po.vendorName || po.vendorId}</span>
      <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-400 sm:block">
        {po.expectedDate || '—'}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
        {formatMoney(po.total)}
      </span>
      <StatusPill status={po.status} />
    </button>
  );
}

export default function POsView() {
  const navigate = useNavigate();
  const { data: pos = [], isPending, isError } = usePurchaseOrders();

  return (
    <AccountingShell
      active="purchase-orders"
      title="Purchase Orders"
      actions={
        <Button size="sm" icon="add" onClick={() => navigate(`${PURCHASE_ORDERS_BASE}/new`)}>
          New purchase order
        </Button>
      }
    >
      {isPending && <p className="text-slate-400">Loading purchase orders…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load purchase orders. Confirm the accounting schema is exposed and you have an
          accounting role.
        </p>
      )}

      {!isPending && !isError && pos.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">shopping_cart</span>
          <p className="text-lg font-bold text-white">No purchase orders yet</p>
          <p className="max-w-sm text-sm text-slate-400">
            Raise a purchase order to commit to buying from a vendor. A PO posts nothing to the
            ledger — converting it to a bill is what records the expense (Dr Expense / Cr Accounts
            Payable) when you post that bill.
          </p>
          <Button size="sm" icon="add" onClick={() => navigate(`${PURCHASE_ORDERS_BASE}/new`)}>
            New purchase order
          </Button>
        </div>
      )}

      {pos.length > 0 && (
        <>
          <div className="hidden items-center gap-3 px-3 pb-1 text-xs font-semibold uppercase text-slate-500 sm:flex">
            <span className="w-24 shrink-0">Number</span>
            <span className="w-24 shrink-0">Ordered</span>
            <span className="flex-1">Vendor</span>
            <span className="w-28 shrink-0 text-right">Expected</span>
            <span className="w-28 shrink-0 text-right">Total</span>
            <span className="w-[88px] shrink-0" />
          </div>
          <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10">
            {pos.map((po) => (
              <PORow
                key={po.id}
                po={po}
                onOpen={() => navigate(`${PURCHASE_ORDERS_BASE}/${po.id}`)}
              />
            ))}
          </div>
        </>
      )}
    </AccountingShell>
  );
}
