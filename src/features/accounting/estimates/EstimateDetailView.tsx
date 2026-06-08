import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AccountingShell } from '../components/AccountingShell';
import { LedgerTable } from '../components/LedgerTable';
import { TaxDisclaimer } from '../components/TaxDisclaimer';
import { useEstimate } from '../hooks/useAccountingQueries';
import {
  useAcceptEstimate,
  useConvertEstimate,
  useDeclineEstimate,
  useSendEstimate,
} from '../hooks/useAccountingMutations';
import { formatMoney } from '../accountingViewModel';
import { ACCOUNTING_BASE } from '../constants';
import { ESTIMATE_STATUS_LABELS, type EstimateLine, type EstimateStatus } from '../types';

const STATUS_STYLES: Record<EstimateStatus, string> = {
  draft: 'bg-white/10 text-slate-300',
  sent: 'bg-sky-500/15 text-sky-400',
  accepted: 'bg-green-500/15 text-green-400',
  declined: 'bg-red-500/15 text-red-400',
  expired: 'bg-amber-500/15 text-amber-400',
  converted: 'bg-violet-500/15 text-violet-400',
};

function sortedLines(lines: EstimateLine[] | undefined): EstimateLine[] {
  return [...(lines ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
}

export default function EstimateDetailView() {
  const { estimateId } = useParams<{ estimateId: string }>();
  const navigate = useNavigate();
  const { data: estimate, isPending, isError } = useEstimate(estimateId);
  const sendEstimate = useSendEstimate();
  const acceptEstimate = useAcceptEstimate();
  const declineEstimate = useDeclineEstimate();
  const convertEstimate = useConvertEstimate();
  const [actionError, setActionError] = useState<string | null>(null);

  const onSend = async () => {
    if (!estimate) return;
    setActionError(null);
    const res = await sendEstimate.mutateAsync(estimate.id);
    if (res.error) setActionError(res.error);
  };

  const onAccept = async () => {
    if (!estimate) return;
    setActionError(null);
    const res = await acceptEstimate.mutateAsync(estimate.id);
    if (res.error) setActionError(res.error);
  };

  const onDecline = async () => {
    if (!estimate) return;
    if (!window.confirm('Decline this estimate? It can no longer be converted to an invoice.'))
      return;
    setActionError(null);
    const res = await declineEstimate.mutateAsync(estimate.id);
    if (res.error) setActionError(res.error);
  };

  const onConvert = async () => {
    if (!estimate) return;
    setActionError(null);
    const res = await convertEstimate.mutateAsync(estimate.id);
    if (res.error || !res.invoiceId) {
      setActionError(res.error ?? 'Could not convert the estimate.');
      return;
    }
    // The converted invoice is a DRAFT — open it so the user can review and send it.
    navigate(`${ACCOUNTING_BASE}/invoices/${res.invoiceId}`);
  };

  const lines = sortedLines(estimate?.lines);
  const canSend = estimate?.status === 'draft';
  const canAccept =
    estimate != null && (estimate.status === 'sent' || estimate.status === 'expired');
  const canDecline =
    estimate != null && estimate.status !== 'declined' && estimate.status !== 'converted';
  const canConvert =
    estimate != null && estimate.status !== 'declined' && estimate.status !== 'converted';
  const taxShown = (estimate?.taxTotal ?? 0) > 0;

  const busy =
    sendEstimate.isPending ||
    acceptEstimate.isPending ||
    declineEstimate.isPending ||
    convertEstimate.isPending;

  return (
    <AccountingShell
      active="estimates"
      title={estimate ? `Estimate ${estimate.estimateNumber ?? 'Draft'}` : 'Estimate'}
      actions={
        estimate ? (
          <div className="flex gap-2">
            {canSend && (
              <Button size="sm" icon="send" onClick={onSend} disabled={busy}>
                {sendEstimate.isPending ? 'Sending…' : 'Send'}
              </Button>
            )}
            {canAccept && (
              <Button size="sm" variant="secondary" icon="check" onClick={onAccept} disabled={busy}>
                {acceptEstimate.isPending ? 'Accepting…' : 'Accept'}
              </Button>
            )}
            {canConvert && (
              <Button size="sm" icon="receipt_long" onClick={onConvert} disabled={busy}>
                {convertEstimate.isPending ? 'Converting…' : 'Convert to invoice'}
              </Button>
            )}
            {canDecline && (
              <Button size="sm" variant="danger" onClick={onDecline} disabled={busy}>
                {declineEstimate.isPending ? 'Declining…' : 'Decline'}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isPending && <p className="text-slate-400">Loading estimate…</p>}
      {isError && <p className="text-red-400">Could not load this estimate.</p>}
      {!isPending && !isError && !estimate && <p className="text-slate-400">Estimate not found.</p>}

      {estimate && (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {taxShown && <TaxDisclaimer />}

          {/* Status + meta */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[estimate.status]}`}
            >
              {ESTIMATE_STATUS_LABELS[estimate.status]}
            </span>
            <span className="text-sm text-slate-400">
              Customer{' '}
              <span className="text-white">{estimate.customerName || estimate.customerId}</span>
            </span>
            <span className="text-sm text-slate-400">
              Date <span className="text-white">{estimate.estimateDate}</span>
            </span>
            {estimate.expiryDate && (
              <span className="text-sm text-slate-400">
                Expires <span className="text-white">{estimate.expiryDate}</span>
              </span>
            )}
            {estimate.terms && (
              <span className="text-sm text-slate-400">
                Terms <span className="text-white">{estimate.terms}</span>
              </span>
            )}
          </div>

          {estimate.memo && <p className="text-white">{estimate.memo}</p>}

          {/* Line items */}
          <LedgerTable
            columns={[
              { label: 'Description' },
              { label: 'Qty', align: 'right' },
              { label: 'Unit price', align: 'right' },
              { label: 'Amount', align: 'right' },
            ]}
          >
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-white/5">
                <td className="px-3 py-2 text-white">{l.description || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {formatMoney(l.unitPrice)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                  {formatMoney(l.lineTotal)}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr className="border-t border-white/5">
                <td className="px-3 py-2 text-slate-500" colSpan={4}>
                  No line items.
                </td>
              </tr>
            )}
          </LedgerTable>

          {/* Totals */}
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums text-slate-200">
                {formatMoney(estimate.subtotal)}
              </span>
            </div>
            {estimate.discountTotal > 0 && (
              <div className="flex justify-between text-slate-400">
                <span>Discount</span>
                <span className="font-mono tabular-nums text-slate-200">
                  −{formatMoney(estimate.discountTotal)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-slate-400">
              <span>Tax</span>
              <span className="font-mono tabular-nums text-slate-200">
                {formatMoney(estimate.taxTotal)}
              </span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-1 text-base font-bold text-white">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatMoney(estimate.total)}</span>
            </div>
          </div>

          {/* Converted-invoice link */}
          {estimate.convertedInvoiceId && (
            <button
              type="button"
              onClick={() => navigate(`${ACCOUNTING_BASE}/invoices/${estimate.convertedInvoiceId}`)}
              className="flex items-center gap-1 self-start text-sm font-semibold text-primary hover:text-primary-hover"
            >
              <span className="material-symbols-outlined text-lg">receipt_long</span>
              View converted invoice
            </button>
          )}

          {actionError && (
            <p className="text-sm text-red-400" role="alert">
              {actionError}
            </p>
          )}
        </div>
      )}
    </AccountingShell>
  );
}
