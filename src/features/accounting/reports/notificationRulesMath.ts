/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Part of the FLAG-DARK notification-delivery
 *     module; requires CPA and/or security sign-off before it is enabled. This file
 *     decides WHICH accounting notifications should fire; the title/message it produces
 *     are PREFIXED with the UNVERIFIED marker, and every delivered row also carries
 *     metadata.unverified=true (stamped by the dispatch RPC). NO money moves here.
 *
 * Pure detection math for the four time-based accounting events + the one event-driven
 * event's payload builder. Given ALREADY-FETCHED domain data (open invoices, open bills,
 * bank accounts, computed tax-calendar entries) and a single notification rule, it returns
 * the set of "candidate" notifications that should be delivered as of a reference date.
 *
 *   • invoice_overdue       — a SENT invoice past its due date by >= threshold days, with a
 *                             positive balance. Re-notifies per aging "bucket" (a NEW dedupe
 *                             key when the invoice crosses 1/30/60/90 days) so a single
 *                             invoice cannot spam daily, but a worsening invoice re-alerts.
 *   • bill_due_soon         — an OPEN bill due within threshold days (and not already past
 *                             due beyond the window), with a positive balance.
 *   • low_bank_balance      — an ACTIVE bank account whose current balance is BELOW the
 *                             dollar threshold. Compared in INTEGER CENTS (G6). Re-notifies
 *                             at most once per UTC day (the dedupe key embeds the date).
 *   • tax_deadline_upcoming — a computed tax-calendar deadline within threshold days
 *                             (not yet past). Dedupe key embeds the agency + due date.
 *
 * No I/O, no React, no Supabase — trivially unit-testable (see notificationRulesMath.test.ts).
 * The service layer fetches the data, calls these, and dispatches each candidate to each
 * resolved recipient via accounting.dispatch_notification. The dedupe key here MATCHES the
 * key the env-gated server sweep computes, so the app-side and server-side paths share one
 * dedupe ledger and never double-deliver.
 *
 * MONEY MATH (G6): the low_bank_balance threshold is DOLLARS; we convert it and the balance
 * to integer cents with accountingViewModel.toCents and compare cents. No float comparison.
 *
 * DATES: all day arithmetic is in UTC (toIsoDate + a UTC-based daysBetween) so a boundary
 * never shifts across midnight in the runtime's local timezone. "As of" defaults to today
 * (UTC) when the caller omits it. ISO `YYYY-MM-DD` strings throughout, matching periodLock.ts.
 */
import { toCents } from '../accountingViewModel';
import { toIsoDate } from '../periodLock';
import type { Bill, BankAccount, Invoice, NotificationEventType, TaxCalendarEntry } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Today's date as ISO `YYYY-MM-DD` in UTC. */
export function todayIsoUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Whole-day difference (b − a) between two ISO `YYYY-MM-DD` dates, computed in UTC.
 * Positive when b is after a. Returns 0 for unparseable input (caller-side guards apply).
 * (Local copy so this module has no cross-report dependency; mirrors taxCalendarMath.)
 */
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * One notification the rules say should fire. The service maps this to a dispatch RPC call
 * (one per recipient). `title`/`message` already carry the UNVERIFIED prefix. `dedupeKey` is
 * the stable cross-path key; `subjectId` is the invoice/bill/account id (null for tax).
 */
export interface NotificationCandidate {
  eventType: NotificationEventType;
  /** The subject row id (invoice/bill/bank account); null for tax deadlines. */
  subjectId: string | null;
  /** Stable dedupe key — identical app-side and server-side. */
  dedupeKey: string;
  /** UNVERIFIED-prefixed notification title. */
  title: string;
  /** UNVERIFIED-prefixed notification message. */
  message: string;
  /** Optional in-app deep link (e.g. 'app-accounting-invoice:<id>'); the feed renders it. */
  link: string | null;
  /** Structured context for the notification metadata (merged with the unverified marker). */
  metadata: Record<string, unknown>;
}

/** The single source-of-truth UNVERIFIED prefix for every accounting notification surface. */
export const UNVERIFIED_PREFIX = '[UNVERIFIED — NOT FOR FILING] ';

/** Prefix a human string with the UNVERIFIED marker (idempotent — never double-prefixes). */
export function withUnverified(text: string): string {
  return text.startsWith(UNVERIFIED_PREFIX) ? text : UNVERIFIED_PREFIX + text;
}

/** Whole dollars/cents formatting for messages (display only; not used for any comparison). */
function fmtMoney(dollars: number): string {
  const cents = toCents(dollars);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Aging buckets for invoice_overdue re-notification. When an overdue invoice crosses into a
 * deeper bucket, the dedupe key changes, so the recipient is alerted again (once) for the
 * worsened state — but NOT every day. Buckets are days-past-due lower bounds.
 */
export const OVERDUE_BUCKET_BOUNDS = [1, 30, 60, 90] as const;

/**
 * The aging bucket an overdue invoice sits in: the deepest bucket bound that is BOTH <=
 * daysPastDue AND >= the notify threshold, never shallower than the threshold floor itself.
 * (A shallower bound than the threshold must never be chosen — the recipient is only alerted
 * from the threshold onward, so the threshold is the minimum bucket.)
 */
export function overdueBucket(daysPastDue: number, thresholdDays: number): number {
  const floor = Math.max(1, Math.floor(thresholdDays));
  let bucket = floor;
  for (const b of OVERDUE_BUCKET_BOUNDS) {
    if (b >= floor && daysPastDue >= b) bucket = b;
  }
  return bucket;
}

/** True when an invoice is in a state that can be overdue (sent/partially-paid, has balance). */
function invoiceIsOpenSent(inv: Invoice): boolean {
  return (inv.status === 'sent' || inv.status === 'partially_paid') && toCents(inv.balanceDue) > 0;
}

/** True when a bill is open/partially-paid with a positive balance. */
function billIsOpen(bill: Bill): boolean {
  return (
    (bill.status === 'open' || bill.status === 'partially_paid') && toCents(bill.balanceDue) > 0
  );
}

/**
 * Detect invoice_overdue candidates: sent invoices past due by >= thresholdDays with a
 * positive balance, as of `asOf`. One candidate per qualifying invoice, keyed by aging
 * bucket so a worsening invoice re-alerts but a static one does not spam.
 *
 * @param invoices  open AR invoices (the service pre-filters to non-void with a balance).
 * @param thresholdDays  minimum days past due (rule.threshold; <= 0 treated as 1).
 * @param asOf  reference date `YYYY-MM-DD` (defaults to today UTC).
 */
export function detectOverdueInvoices(
  invoices: Invoice[],
  thresholdDays: number,
  asOf: string = todayIsoUtc()
): NotificationCandidate[] {
  const asOfIso = toIsoDate(asOf);
  if (!asOfIso) return [];
  const minDays = Math.max(1, Math.floor(Number.isFinite(thresholdDays) ? thresholdDays : 1));
  const out: NotificationCandidate[] = [];

  for (const inv of invoices) {
    if (!invoiceIsOpenSent(inv)) continue;
    const due = toIsoDate(inv.dueDate);
    if (!due) continue; // no due date → cannot be "overdue"
    const daysPastDue = daysBetween(due, asOfIso); // positive when asOf is after due
    if (daysPastDue < minDays) continue;

    const bucket = overdueBucket(daysPastDue, minDays);
    const label = inv.invoiceNumber ? `#${inv.invoiceNumber}` : inv.id.slice(0, 8);
    out.push({
      eventType: 'invoice_overdue',
      subjectId: inv.id,
      dedupeKey: `invoice_overdue:${inv.id}:bucket${bucket}`,
      title: withUnverified('Invoice overdue'),
      message: withUnverified(
        `Invoice ${label} is ${daysPastDue} day${daysPastDue === 1 ? '' : 's'} past due ` +
          `(${fmtMoney(inv.balanceDue)} outstanding).`
      ),
      link: `app-accounting-invoice:${inv.id}`,
      metadata: {
        invoice_id: inv.id,
        invoice_number: inv.invoiceNumber,
        days_past_due: daysPastDue,
        bucket,
        balance_due: inv.balanceDue,
      },
    });
  }
  return out;
}

/**
 * Detect bill_due_soon candidates: open bills whose due date is within thresholdDays from
 * `asOf` (inclusive), not already past due, with a positive balance. Keyed by bill + due date
 * so re-running the same day does not duplicate, and a rescheduled bill re-alerts.
 *
 * Past-due bills are intentionally NOT surfaced here (this is the *upcoming* event); an AP
 * overdue event is out of scope for this module.
 */
export function detectBillsDueSoon(
  bills: Bill[],
  thresholdDays: number,
  asOf: string = todayIsoUtc()
): NotificationCandidate[] {
  const asOfIso = toIsoDate(asOf);
  if (!asOfIso) return [];
  const windowDays = Math.max(0, Math.floor(Number.isFinite(thresholdDays) ? thresholdDays : 0));
  const out: NotificationCandidate[] = [];

  for (const bill of bills) {
    if (!billIsOpen(bill)) continue;
    const due = toIsoDate(bill.dueDate);
    if (!due) continue;
    const daysUntilDue = daysBetween(asOfIso, due); // positive when due is after asOf
    // Within the window AND not already past due (daysUntilDue >= 0).
    if (daysUntilDue < 0 || daysUntilDue > windowDays) continue;

    const label = bill.billNumber ? `#${bill.billNumber}` : bill.id.slice(0, 8);
    const when =
      daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
    out.push({
      eventType: 'bill_due_soon',
      subjectId: bill.id,
      dedupeKey: `bill_due_soon:${bill.id}:${due}`,
      title: withUnverified('Bill due soon'),
      message: withUnverified(
        `Bill ${label} is due ${when} (${fmtMoney(bill.balanceDue)} outstanding).`
      ),
      link: `app-accounting-bill:${bill.id}`,
      metadata: {
        bill_id: bill.id,
        bill_number: bill.billNumber,
        due_date: due,
        days_until_due: daysUntilDue,
        balance_due: bill.balanceDue,
      },
    });
  }
  return out;
}

/**
 * Detect low_bank_balance candidates: active bank accounts whose current balance is strictly
 * BELOW the dollar threshold, compared in INTEGER CENTS (G6). When `bankAccountId` is set the
 * rule is scoped to that one account; otherwise every active account is checked against the
 * same floor. Dedupe key embeds the UTC date so it alerts at most once per day per account.
 *
 * @param accounts  bank accounts (the service passes active ones; we also guard isActive).
 * @param thresholdDollars  the floor in DOLLARS (rule.threshold). Null/НаН ⇒ no candidates
 *                          (a floor must be configured before this event can fire).
 * @param scopeBankAccountId  optional single-account scope (rule.bankAccountId).
 * @param asOf  reference date `YYYY-MM-DD` (defaults to today UTC) — used only for the key.
 */
export function detectLowBankBalances(
  accounts: BankAccount[],
  thresholdDollars: number | null,
  scopeBankAccountId: string | null = null,
  asOf: string = todayIsoUtc()
): NotificationCandidate[] {
  if (thresholdDollars == null || !Number.isFinite(thresholdDollars)) return [];
  const asOfIso = toIsoDate(asOf) ?? todayIsoUtc();
  const thresholdCents = toCents(thresholdDollars);
  const out: NotificationCandidate[] = [];

  for (const acct of accounts) {
    if (acct.isActive === false) continue;
    if (scopeBankAccountId && acct.id !== scopeBankAccountId) continue;
    const balanceCents = toCents(acct.currentBalance);
    if (balanceCents >= thresholdCents) continue; // at or above the floor → no alert

    out.push({
      eventType: 'low_bank_balance',
      subjectId: acct.id,
      dedupeKey: `low_bank_balance:${acct.id}:${asOfIso}`,
      title: withUnverified('Low bank balance'),
      message: withUnverified(
        `${acct.name} balance ${fmtMoney(acct.currentBalance)} is below the ` +
          `${fmtMoney(thresholdDollars)} threshold.`
      ),
      link: `app-accounting-bank:${acct.id}`,
      metadata: {
        bank_account_id: acct.id,
        bank_account_name: acct.name,
        current_balance: acct.currentBalance,
        threshold: thresholdDollars,
      },
    });
  }
  return out;
}

/**
 * Detect tax_deadline_upcoming candidates from PRE-COMPUTED tax-calendar entries (the C1
 * dashboard's output, each carrying its agency, period, due date, and daysUntilDue). Surfaces
 * deadlines whose due date is within thresholdDays from now and not yet past. Dedupe key
 * embeds agency + due date so each filing period alerts at most once per recipient.
 *
 * The entries are derived from the REPRESENTATIVE CDTFA cadence (NOT verified for filing); the
 * UNVERIFIED prefix + the entry's own notes caveat travel into the notification.
 *
 * @param entries  TaxCalendarEntry[] from salesTaxService.getTaxFilingCalendar (already
 *                 computed against the same/close "as of"); we re-test against thresholdDays.
 * @param thresholdDays  notify when due within N days (rule.threshold; <= 0 ⇒ due today only).
 */
export function detectTaxDeadlines(
  entries: TaxCalendarEntry[],
  thresholdDays: number
): NotificationCandidate[] {
  const windowDays = Math.max(0, Math.floor(Number.isFinite(thresholdDays) ? thresholdDays : 0));
  const out: NotificationCandidate[] = [];

  for (const entry of entries) {
    // Upcoming only: 0..windowDays days until due (skip past-due and beyond-window).
    if (entry.overdue) continue;
    if (entry.daysUntilDue < 0 || entry.daysUntilDue > windowDays) continue;

    const when =
      entry.daysUntilDue === 0
        ? 'today'
        : `in ${entry.daysUntilDue} day${entry.daysUntilDue === 1 ? '' : 's'}`;
    out.push({
      eventType: 'tax_deadline_upcoming',
      subjectId: null, // tax deadlines have no single accounting row id
      dedupeKey: `tax_deadline_upcoming:${entry.agencyId ?? entry.agencyName}:${entry.dueDate}`,
      title: withUnverified('Tax-filing deadline upcoming'),
      message: withUnverified(
        `${entry.agencyName} ${entry.periodLabel} filing is due ${when} (${entry.dueDate}). ` +
          `Representative cadence — verify with a CPA/EA.`
      ),
      link: 'app-accounting-tax-calendar',
      metadata: {
        agency_id: entry.agencyId,
        agency_name: entry.agencyName,
        period_label: entry.periodLabel,
        due_date: entry.dueDate,
        days_until_due: entry.daysUntilDue,
        frequency: entry.frequency,
      },
    });
  }
  return out;
}

/**
 * Build the single invoice_sent candidate for an invoice that was just sent (the event-driven,
 * app-side path). One candidate; dedupe key is per-invoice (sending an invoice is a one-time
 * transition — re-sending the SAME invoice should not re-notify, which the per-invoice key
 * guarantees). The caller dispatches it to each resolved recipient.
 */
export function buildInvoiceSentCandidate(invoice: Invoice): NotificationCandidate {
  const label = invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : invoice.id.slice(0, 8);
  return {
    eventType: 'invoice_sent',
    subjectId: invoice.id,
    dedupeKey: `invoice_sent:${invoice.id}`,
    title: withUnverified('Invoice sent'),
    message: withUnverified(
      `Invoice ${label} was sent${invoice.customerName ? ` to ${invoice.customerName}` : ''} ` +
        `(${fmtMoney(invoice.total)}).`
    ),
    link: `app-accounting-invoice:${invoice.id}`,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      customer_id: invoice.customerId,
      total: invoice.total,
    },
  };
}
