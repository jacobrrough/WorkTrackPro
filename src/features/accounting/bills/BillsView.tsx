import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LIST_CONTAINER, LIST_HEADER, LIST_ROW } from '../components/listRowStyles';
import { useBills } from '../hooks/useAccountingQueries';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { BILL_STATUS_LABELS, type Bill, type BillStatus } from '../types';

const STATUS_STYLES: Record<BillStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  open: 'bg-sky-500/15 text-sky-400',
  partially_paid: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-green-500/15 text-green-400',
  void: 'bg-red-500/15 text-red-400',
};

function StatusPill({ status }: { status: BillStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {BILL_STATUS_LABELS[status]}
    </span>
  );
}

function BillRow({ bill, onOpen }: { bill: Bill; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={LIST_ROW}>
      <span className="w-24 shrink-0 truncate font-mono text-xs text-slate-500">
        {bill.billNumber || 'Draft'}
      </span>
      <span className="w-24 shrink-0 text-sm text-slate-400">{bill.billDate}</span>
      <span className="flex-1 truncate text-white">{bill.vendorName || bill.vendorId}</span>
      <span className="hidden w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-400 sm:block">
        {formatMoney(bill.total)}
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums text-slate-200">
        {formatMoney(bill.balanceDue)}
      </span>
      <StatusPill status={bill.status} />
    </button>
  );
}

export default function BillsView() {
  const navigate = useNavigate();
  const { data: bills = [], isPending, isError } = useBills();

  return (
    <AccountingShell
      active="bills"
      title="Bills"
      actions={
        <Button size="sm" icon="add" onClick={() => navigate(`${ACCOUNTING_BASE}/bills/new`)}>
          New bill
        </Button>
      }
    >
      {isPending && <p className="text-slate-400">Loading bills…</p>}
      {isError && (
        <p className="text-red-400">
          Could not load bills. Confirm the accounting schema is exposed and you have an accounting
          role.
        </p>
      )}

      {!isPending && !isError && bills.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-white/15 px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-slate-500">request_quote</span>
          <p className="text-lg font-bold text-white">No bills yet</p>
          <p className="max-w-sm text-sm text-slate-400">
            Enter a vendor bill to track what you owe. Posting it records a balanced expense entry
            to the general ledger (Dr Expense / Cr Accounts Payable).
          </p>
          <Button size="sm" icon="add" onClick={() => navigate(`${ACCOUNTING_BASE}/bills/new`)}>
            New bill
          </Button>
        </div>
      )}

      {bills.length > 0 && (
        <>
          <div className={LIST_HEADER}>
            <span className="w-24 shrink-0">Number</span>
            <span className="w-24 shrink-0">Date</span>
            <span className="flex-1">Vendor</span>
            <span className="w-28 shrink-0 text-right">Total</span>
            <span className="w-28 shrink-0 text-right">Balance</span>
            <span className="w-[58px] shrink-0" />
          </div>
          <div className={LIST_CONTAINER}>
            {bills.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                onOpen={() => navigate(`${ACCOUNTING_BASE}/bills/${bill.id}`)}
              />
            ))}
          </div>
        </>
      )}
    </AccountingShell>
  );
}
