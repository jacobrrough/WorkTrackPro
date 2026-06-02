/**
 * Pure display helpers for the recurring-templates UI (B2). No React/Supabase here —
 * just formatting a template's schedule and payload for the list and editor. Money is
 * summed in integer cents (toCents) so the on-screen estimate never drifts on floats.
 *
 * NOTE: the payload "amount" shown is a GROSS line estimate for at-a-glance scanning
 * (Σ line totals; tax is not modeled here). The authoritative figure is whatever the
 * invoice/bill/journal posts when generated — this is a preview, not the posted total.
 */
import { toCents } from '../accountingViewModel';
import { isOnOrBefore, todayISO } from '../recurrence';
import {
  RECURRING_FREQUENCY_LABELS,
  type RecurringBillLine,
  type RecurringBillPayload,
  type RecurringInvoiceLine,
  type RecurringInvoicePayload,
  type RecurringJournalLine,
  type RecurringJournalPayload,
  type RecurringKind,
  type RecurringPayload,
  type RecurringTemplate,
} from '../types';

// ── Factory line shapes ────────────────────────────────────────────────────────
// Fresh blank lines for the payload editors. Kept here (a non-component module) so the
// editor files export only components (React Fast Refresh stays happy).

export const emptyInvoiceLine = (): RecurringInvoiceLine => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  taxable: true,
});

export const emptyBillLine = (): RecurringBillLine => ({
  accountId: null,
  description: '',
  quantity: 1,
  unitCost: 0,
});

export const emptyJournalLine = (): RecurringJournalLine => ({
  accountId: '',
  debit: 0,
  credit: 0,
});

const ORDINAL_SUFFIX = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
};

/** "Monthly", "Every 2 weeks", "Every 3 months on the 1st" — a human schedule label. */
export function scheduleLabel(
  tpl: Pick<RecurringTemplate, 'frequency' | 'intervalCount' | 'dayOfMonth'>
): string {
  const base =
    tpl.intervalCount > 1
      ? `Every ${tpl.intervalCount} ${pluralUnit(tpl.frequency, tpl.intervalCount)}`
      : RECURRING_FREQUENCY_LABELS[tpl.frequency];
  const anchored =
    tpl.dayOfMonth != null &&
    (tpl.frequency === 'monthly' || tpl.frequency === 'quarterly' || tpl.frequency === 'yearly')
      ? ` on the ${tpl.dayOfMonth}${ORDINAL_SUFFIX(tpl.dayOfMonth)}`
      : '';
  return `${base}${anchored}`;
}

/** Singular→plural frequency unit for the "Every N units" label. */
function pluralUnit(frequency: RecurringTemplate['frequency'], count: number): string {
  const unit: Record<RecurringTemplate['frequency'], string> = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month',
    quarterly: 'quarter',
    yearly: 'year',
  };
  const u = unit[frequency];
  return count === 1 ? u : `${u}s`;
}

/** A template is "due" when active and its next_run_date is on/before the as-of date. */
export function isTemplateDue(tpl: RecurringTemplate, asOf: string = todayISO()): boolean {
  return tpl.active && isOnOrBefore(tpl.nextRunDate, asOf);
}

/** Gross line-total estimate (in cents) for a payload, by kind. Tax not included. */
export function payloadGrossCents(kind: RecurringKind, payload: RecurringPayload): number {
  if (kind === 'invoice') {
    const p = payload as RecurringInvoicePayload;
    return (p.lines ?? []).reduce((sum, l) => {
      const gross =
        l.lineTotal != null
          ? l.lineTotal
          : (l.quantity ?? 0) * (l.unitPrice ?? 0) - (l.discount ?? 0);
      return sum + toCents(gross);
    }, 0);
  }
  if (kind === 'bill') {
    const p = payload as RecurringBillPayload;
    const lines = (p.lines ?? []).reduce((sum, l) => {
      const gross = l.lineTotal != null ? l.lineTotal : (l.quantity ?? 0) * (l.unitCost ?? 0);
      return sum + toCents(gross);
    }, 0);
    return lines + toCents(p.taxTotal ?? 0);
  }
  // journal: the entry's magnitude is the total debits (== total credits when balanced).
  const p = payload as RecurringJournalPayload;
  return (p.lines ?? []).reduce((sum, l) => sum + toCents(l.debit ?? 0), 0);
}

/** Line count of a payload regardless of kind (all three shapes carry `lines`). */
export function payloadLineCount(payload: RecurringPayload): number {
  return Array.isArray(payload.lines) ? payload.lines.length : 0;
}
