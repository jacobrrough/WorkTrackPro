/**
 * Pure builders that turn a recurring template's payload + a generation date into the
 * concrete service inputs the "generate due" action posts. Kept free of React/Supabase
 * so the payload→document mapping (including the all-important balanced-journal check
 * for the journal kind) is unit-testable (see recurringTemplates.test.ts).
 *
 * MONEY: nothing here touches the DB. Amounts stay plain dollars; the invoice/bill
 * services and post_journal_entry round them through integer cents and the DB balance
 * trigger is the final gate (G3/G6). buildRecurringJournalLines fails fast with the
 * same balance rule (assertBalanced) the DB enforces.
 */
import { assertBalanced } from '../../../features/accounting/posting';
import { addInterval } from '../../../features/accounting/recurrence';
import type {
  NewBillInput,
  NewInvoiceInput,
  NewJournalLineInput,
  RecurringBillPayload,
  RecurringInvoicePayload,
  RecurringJournalPayload,
} from '../../../features/accounting/types';

/** Add `days` to an ISO `YYYY-MM-DD` (reusing the recurrence UTC date math). */
function addDays(iso: string, days: number): string {
  return addInterval(iso, 'daily', days);
}

/**
 * Build the `NewInvoiceInput` for a recurring invoice generated on `onDate`. The due
 * date is `onDate + dueInDays` when the payload specifies an offset (else null). Line
 * dimensions (class/location/department) flow straight through to the invoice lines,
 * which the invoices service persists and stamps onto the income JE on send.
 */
export function buildRecurringInvoiceInput(
  payload: RecurringInvoicePayload,
  onDate: string
): NewInvoiceInput {
  return {
    customerId: payload.customerId,
    jobId: payload.jobId ?? null,
    invoiceDate: onDate,
    dueDate: payload.dueInDays != null ? addDays(onDate, payload.dueInDays) : null,
    terms: payload.terms ?? null,
    taxCodeId: payload.taxCodeId ?? null,
    memo: payload.memo ?? null,
    notes: payload.notes ?? null,
    lines: payload.lines.map((l) => ({
      itemId: l.itemId ?? null,
      description: l.description ?? null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      discount: l.discount,
      taxCodeId: l.taxCodeId ?? null,
      taxable: l.taxable,
      incomeAccountId: l.incomeAccountId ?? null,
      classId: l.classId ?? null,
      locationId: l.locationId ?? null,
      departmentId: l.departmentId ?? null,
    })),
  };
}

/** Build the `NewBillInput` for a recurring bill generated on `onDate`. */
export function buildRecurringBillInput(
  payload: RecurringBillPayload,
  onDate: string
): NewBillInput {
  return {
    vendorId: payload.vendorId,
    billDate: onDate,
    dueDate: payload.dueInDays != null ? addDays(onDate, payload.dueInDays) : null,
    terms: payload.terms ?? null,
    taxTotal: payload.taxTotal,
    jobId: payload.jobId ?? null,
    memo: payload.memo ?? null,
    lines: payload.lines.map((l) => ({
      accountId: l.accountId ?? null,
      itemId: l.itemId ?? null,
      description: l.description ?? null,
      quantity: l.quantity,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
      jobId: l.jobId ?? null,
      classId: l.classId ?? null,
      locationId: l.locationId ?? null,
      departmentId: l.departmentId ?? null,
    })),
  };
}

/**
 * Build the balanced journal lines for a recurring `journal`-kind template. Each
 * payload line carries an explicit Dr/Cr against an account, plus optional dimensions
 * and party links. THROWS (via assertBalanced) unless the lines net to zero with >=2
 * lines — the exact rule accounting.post_journal_entry enforces — so an unbalanced
 * template is rejected before any DB round-trip.
 */
export function buildRecurringJournalLines(
  payload: RecurringJournalPayload
): NewJournalLineInput[] {
  const lines: NewJournalLineInput[] = payload.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    lineMemo: l.lineMemo ?? null,
    jobId: l.jobId ?? null,
    customerId: l.customerId ?? null,
    vendorId: l.vendorId ?? null,
    classId: l.classId ?? null,
    locationId: l.locationId ?? null,
    departmentId: l.departmentId ?? null,
  }));
  assertBalanced(lines); // same balance + >=2-line rule the DB enforces
  return lines;
}
