import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import { CurrencyInput } from '../components/CurrencyInput';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { usePurchaseOrder, usePurchaseOrderBills } from '../hooks/useAccountingQueries';
import {
  useConvertPurchaseOrder,
  useReceivePurchaseOrder,
  useClosePurchaseOrder,
  useCancelPurchaseOrder,
} from '../hooks/useAccountingMutations';
import { computePoVariances } from '@/services/api/accounting';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import {
  PO_STATUS_LABELS,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PoStatus,
} from '../types';

const STATUS_STYLES: Record<PoStatus, string> = {
  draft: 'bg-overlay/10 text-muted',
  open: 'bg-sky-500/15 text-sky-400',
  partially_received: 'bg-amber-500/15 text-amber-400',
  received: 'bg-green-500/15 text-green-400',
  closed: 'bg-violet-500/15 text-violet-400',
  cancelled: 'bg-red-500/15 text-red-400',
};

function sortedLines(lines: PurchaseOrderLine[] | undefined): PurchaseOrderLine[] {
  return [...(lines ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Dialog to record received quantities per PO line (no money posts — receiving books nothing). */
function ReceiveModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const receive = useReceivePurchaseOrder();
  const lines = sortedLines(po.lines);
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.quantityReceived]))
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const res = await receive.mutateAsync({
      id: po.id,
      received: lines.map((l) => ({
        poLineId: l.id,
        quantityReceived: received[l.id] ?? l.quantityReceived,
      })),
    });
    if (res.error || !res.purchaseOrder) {
      setError(res.error ?? 'Could not record the receipt.');
      return;
    }
    onClose();
  };

  return (
    <div className="app-modal-backdrop z-modal p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-card-dark p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Receive items</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-overlay/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">
          Enter the total quantity received per line (capped at the quantity ordered). Receiving
          posts no journal entry — converting the PO to a bill and posting that bill records the
          expense.
        </p>

        <div className="flex flex-col gap-3">
          {lines.map((l) => (
            <FormField
              key={l.id}
              label={`${l.description || 'Line'} — ordered ${l.quantityOrdered}`}
              htmlFor={`recv-${l.id}`}
            >
              <CurrencyInput
                id={`recv-${l.id}`}
                aria-label={`Received quantity for ${l.description || 'line'}`}
                value={received[l.id] ?? 0}
                onValueChange={(v) =>
                  setReceived((prev) => ({
                    ...prev,
                    [l.id]: Math.min(Math.max(0, v), l.quantityOrdered),
                  }))
                }
              />
            </FormField>
          ))}

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={receive.isPending}>
              {receive.isPending ? 'Saving…' : 'Save receipt'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The 3-way-match / variance panel: per PO line, ordered vs received quantity and the PO
 * unit cost vs the (quantity-weighted) billed unit cost from the linked bill lines, plus a
 * per-line bill count. A line with nothing billed shows "—" for the billed cost (surfaced,
 * never guessed). Pure presentation over computePoVariances.
 */
function VariancePanel({ po }: { po: PurchaseOrder }) {
  const { data: bills = [], isPending } = usePurchaseOrderBills(po.id);
  const variances = useMemo(() => computePoVariances(po, bills), [po, bills]);

  if (isPending) return <p className="text-sm text-muted">Loading match…</p>;

  const totalBillCount = bills.length;

  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">3-way match</h2>
      <p className="mb-2 text-xs text-subtle">
        Ordered vs received quantity, and PO cost vs billed cost. Quantity short/over and any cost
        delta are flagged; a line with nothing billed shows a dash.
      </p>
      <LedgerTable
        columns={[
          { label: 'Line' },
          { label: 'Ordered', align: 'right' },
          { label: 'Received', align: 'right' },
          { label: 'Qty Δ', align: 'right' },
          { label: 'PO cost', align: 'right' },
          { label: 'Bill cost', align: 'right' },
          { label: 'Cost Δ', align: 'right' },
        ]}
      >
        {variances.map((v) => {
          const qtyShort = v.quantityVariance < 0;
          const qtyOver = v.quantityVariance > 0;
          const costOff = v.costVariance != null && Math.abs(v.costVariance) >= 0.005;
          return (
            <tr key={v.poLineId} className="border-t border-line/60">
              <td className="px-3 py-2 text-white">
                {v.description || '—'}
                {v.billCount > 0 && (
                  <span className="ml-2 text-xs text-subtle">
                    · {v.billCount} bill{v.billCount === 1 ? '' : 's'}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{v.quantityOrdered}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{v.quantityReceived}</td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  qtyShort ? 'text-amber-400' : qtyOver ? 'text-red-400' : 'text-subtle'
                }`}
              >
                {v.quantityVariance > 0 ? `+${v.quantityVariance}` : v.quantityVariance}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {formatMoney(v.poUnitCost)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {v.billedUnitCost == null ? '—' : formatMoney(v.billedUnitCost)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  costOff ? 'text-red-400' : 'text-subtle'
                }`}
              >
                {v.costVariance == null
                  ? '—'
                  : `${v.costVariance > 0 ? '+' : ''}${formatMoney(v.costVariance)}`}
              </td>
            </tr>
          );
        })}
        {variances.length === 0 && (
          <tr className="border-t border-line/60">
            <td className="px-3 py-2 text-subtle" colSpan={7}>
              No lines to match.
            </td>
          </tr>
        )}
      </LedgerTable>

      {/* Linked bills */}
      {totalBillCount > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase text-subtle">Bills from this PO</h3>
          <div className="divide-y divide-overlay/5 overflow-hidden rounded-lg border border-line">
            {bills.map((b) => (
              <a
                key={b.id}
                href={`${ACCOUNTING_BASE}/bills/${b.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-overlay/5"
              >
                <span className="w-24 shrink-0 truncate font-mono text-xs text-subtle">
                  {b.billNumber || 'Draft'}
                </span>
                <span className="w-24 shrink-0 text-muted">{b.billDate}</span>
                <span className="flex-1 truncate text-muted">{b.status}</span>
                <span className="shrink-0 font-mono tabular-nums text-white">
                  {formatMoney(b.total)}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function PODetailView() {
  const { poId } = useParams<{ poId: string }>();
  const navigate = useNavigate();
  const { data: po, isPending, isError } = usePurchaseOrder(poId);
  const convert = useConvertPurchaseOrder();
  const closePo = useClosePurchaseOrder();
  const cancelPo = useCancelPurchaseOrder();
  const [showReceive, setShowReceive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onConvert = async () => {
    if (!po) return;
    setActionError(null);
    const res = await convert.mutateAsync(po.id);
    if (res.error || !res.billId) {
      setActionError(res.error ?? 'Could not convert the purchase order.');
      return;
    }
    // The converted bill is a DRAFT — open it so the user can review and post it.
    navigate(`${ACCOUNTING_BASE}/bills/${res.billId}`);
  };

  const onClose = async () => {
    if (!po) return;
    if (!window.confirm('Close this purchase order? No further receipts or bills are expected.'))
      return;
    setActionError(null);
    const res = await closePo.mutateAsync(po.id);
    if (res.error) setActionError(res.error);
  };

  const onCancel = async () => {
    if (!po) return;
    if (!window.confirm('Cancel this purchase order?')) return;
    setActionError(null);
    const res = await cancelPo.mutateAsync(po.id);
    if (res.error) setActionError(res.error);
  };

  const lines = sortedLines(po?.lines);
  const taxShown = (po?.taxTotal ?? 0) > 0;
  const isTerminal = po?.status === 'cancelled' || po?.status === 'closed';
  const canReceive = po != null && !isTerminal;
  const canConvert = po != null && po.status !== 'cancelled';
  const canClose = po != null && po.status !== 'cancelled' && po.status !== 'closed';
  const canCancel =
    po != null &&
    po.status !== 'cancelled' &&
    !(po.lines ?? []).some((l) => l.quantityReceived > 0);

  const busy = convert.isPending || closePo.isPending || cancelPo.isPending;

  return (
    <AccountingShell
      active="purchase-orders"
      title={po ? `PO ${po.poNumber ?? 'Draft'}` : 'Purchase Order'}
      actions={
        po ? (
          <div className="flex gap-2">
            {canReceive && (
              <Button
                size="sm"
                variant="secondary"
                icon="inventory"
                onClick={() => setShowReceive(true)}
                disabled={busy}
              >
                Receive
              </Button>
            )}
            {canConvert && (
              <Button size="sm" icon="request_quote" onClick={onConvert} disabled={busy}>
                {convert.isPending ? 'Converting…' : 'Convert to bill'}
              </Button>
            )}
            {canClose && (
              <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
                {closePo.isPending ? 'Closing…' : 'Close'}
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="danger" onClick={onCancel} disabled={busy}>
                {cancelPo.isPending ? 'Cancelling…' : 'Cancel PO'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isPending && <p className="text-muted">Loading purchase order…</p>}
      {isError && <p className="text-red-400">Could not load this purchase order.</p>}
      {!isPending && !isError && !po && <p className="text-muted">Purchase order not found.</p>}

      {po && (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {taxShown && <TaxDisclaimer />}

          {/* Status + meta */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[po.status]}`}
            >
              {PO_STATUS_LABELS[po.status]}
            </span>
            <span className="text-sm text-muted">
              Vendor <span className="text-white">{po.vendorName || po.vendorId}</span>
            </span>
            <span className="text-sm text-muted">
              Ordered <span className="text-white">{po.orderDate}</span>
            </span>
            {po.expectedDate && (
              <span className="text-sm text-muted">
                Expected <span className="text-white">{po.expectedDate}</span>
              </span>
            )}
          </div>

          {po.memo && <p className="text-white">{po.memo}</p>}

          {/* Line items */}
          <LedgerTable
            columns={[
              { label: 'Description' },
              { label: 'Ordered', align: 'right' },
              { label: 'Received', align: 'right' },
              { label: 'Unit cost', align: 'right' },
              { label: 'Amount', align: 'right' },
            ]}
          >
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-line/60">
                <td className="px-3 py-2 text-white">{l.description || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {l.quantityOrdered}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {l.quantityReceived}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {formatMoney(l.unitCost)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white">
                  {formatMoney(l.lineTotal)}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr className="border-t border-line/60">
                <td className="px-3 py-2 text-subtle" colSpan={5}>
                  No line items.
                </td>
              </tr>
            )}
          </LedgerTable>

          {/* Totals */}
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-muted">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums text-white">{formatMoney(po.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Tax</span>
              <span className="font-mono tabular-nums text-white">{formatMoney(po.taxTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1 text-base font-bold text-white">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatMoney(po.total)}</span>
            </div>
          </div>

          {actionError && (
            <p className="text-sm text-red-400" role="alert">
              {actionError}
            </p>
          )}

          {/* 3-way match / variance */}
          <VariancePanel po={po} />
        </div>
      )}

      {showReceive && po && <ReceiveModal po={po} onClose={() => setShowReceive(false)} />}
    </AccountingShell>
  );
}
