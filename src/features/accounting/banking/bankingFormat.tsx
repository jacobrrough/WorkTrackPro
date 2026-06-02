import { formatMoney } from '../accountingViewModel';
import {
  BANK_TXN_STATUS_LABELS,
  type BankTransactionStatus,
} from '../types';

/**
 * Shared presentation helpers for the A4 Banking screens (register + reconcile).
 * Kept tiny and dependency-free beyond the existing money formatter so every
 * banking screen renders signed amounts and status pills identically.
 */

const STATUS_STYLES: Record<BankTransactionStatus, string> = {
  unreviewed: 'bg-white/10 text-slate-300',
  categorized: 'bg-sky-500/15 text-sky-400',
  matched: 'bg-green-500/15 text-green-400',
  excluded: 'bg-amber-500/15 text-amber-400',
};

/** Small uppercase status chip for a bank transaction's review state. */
export function TxnStatusPill({ status }: { status: BankTransactionStatus }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {BANK_TXN_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Format a signed bank amount for display. Per the bank sign convention a positive
 * amount is money in (deposit, shown green) and a negative is money out (withdrawal,
 * shown red with a leading minus). The magnitude is what posts; this is display only.
 */
export function SignedAmount({ amount, className = '' }: { amount: number; className?: string }) {
  const isOut = amount < 0;
  const tone = isOut ? 'text-red-400' : 'text-green-400';
  return (
    <span className={`font-mono tabular-nums ${tone} ${className}`}>
      {isOut ? '−' : '+'}
      {formatMoney(Math.abs(amount))}
    </span>
  );
}
