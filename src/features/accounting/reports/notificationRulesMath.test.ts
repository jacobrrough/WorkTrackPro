import { describe, it, expect } from 'vitest';
import {
  buildInvoiceSentCandidate,
  daysBetween,
  detectBillsDueSoon,
  detectLowBankBalances,
  detectOverdueInvoices,
  detectTaxDeadlines,
  overdueBucket,
  todayIsoUtc,
  UNVERIFIED_PREFIX,
  withUnverified,
} from './notificationRulesMath';
import type { BankAccount, Bill, Invoice, TaxCalendarEntry } from '../types';

// ── Fixture builders (only the fields the detectors read are meaningful) ─────────
function invoice(partial: Partial<Invoice>): Invoice {
  return {
    id: 'inv-1',
    invoiceNumber: '1001',
    customerId: 'cust-1',
    jobId: null,
    invoiceDate: '2026-05-01',
    dueDate: '2026-05-31',
    terms: null,
    status: 'sent',
    subtotal: 100,
    discountTotal: 0,
    taxTotal: 0,
    total: 100,
    amountPaid: 0,
    balanceDue: 100,
    taxCodeId: null,
    journalEntryId: null,
    memo: null,
    notes: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...partial,
  };
}

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'bill-1',
    vendorId: 'vend-1',
    billNumber: 'B-1',
    billDate: '2026-05-01',
    dueDate: '2026-06-10',
    terms: null,
    status: 'open',
    subtotal: 200,
    taxTotal: 0,
    total: 200,
    amountPaid: 0,
    balanceDue: 200,
    jobId: null,
    journalEntryId: null,
    memo: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...partial,
  };
}

function bankAccount(partial: Partial<BankAccount>): BankAccount {
  return {
    id: 'ba-1',
    name: 'Operating Checking',
    accountId: 'gl-1010',
    accountType: 'checking',
    institution: null,
    mask: null,
    currentBalance: 1000,
    lastReconciledAt: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function taxEntry(partial: Partial<TaxCalendarEntry>): TaxCalendarEntry {
  return {
    agencyId: 'agency-1',
    agencyName: 'CDTFA',
    frequency: 'quarterly',
    periodLabel: 'Q2 2026 (Apr–Jun)',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    dueDate: '2026-07-31',
    daysUntilDue: 10,
    overdue: false,
    notes: null,
    ...partial,
  };
}

describe('date + prefix helpers', () => {
  it('daysBetween counts whole UTC days (positive when b is after a)', () => {
    expect(daysBetween('2026-05-31', '2026-06-10')).toBe(10);
    expect(daysBetween('2026-06-10', '2026-05-31')).toBe(-10);
    expect(daysBetween('2026-06-01', '2026-06-01')).toBe(0);
  });

  it('daysBetween is timezone-stable across a month/DST boundary', () => {
    // 31 days March→ regardless of the runtime local zone (computed in UTC).
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('todayIsoUtc returns the UTC calendar date of the given instant', () => {
    // 23:30 UTC is still the same UTC day (a local-time impl could roll over).
    expect(todayIsoUtc(new Date('2026-06-15T23:30:00Z'))).toBe('2026-06-15');
    expect(todayIsoUtc(new Date('2026-06-15T00:00:00Z'))).toBe('2026-06-15');
  });

  it('withUnverified prefixes once and is idempotent', () => {
    const once = withUnverified('Invoice sent');
    expect(once.startsWith(UNVERIFIED_PREFIX)).toBe(true);
    expect(withUnverified(once)).toBe(once); // no double prefix
  });
});

describe('overdueBucket', () => {
  it('returns the deepest crossed bucket bound', () => {
    expect(overdueBucket(0, 1)).toBe(1); // threshold floor
    expect(overdueBucket(5, 1)).toBe(1);
    expect(overdueBucket(30, 1)).toBe(30);
    expect(overdueBucket(45, 1)).toBe(30);
    expect(overdueBucket(60, 1)).toBe(60);
    expect(overdueBucket(120, 1)).toBe(90);
  });

  it('honors a higher threshold as the floor', () => {
    expect(overdueBucket(3, 5)).toBe(5);
  });
});

describe('detectOverdueInvoices', () => {
  const asOf = '2026-06-15';

  it('flags a sent invoice past due by >= threshold days with a balance', () => {
    const out = detectOverdueInvoices(
      [invoice({ dueDate: '2026-05-31', balanceDue: 100 })],
      1,
      asOf
    );
    expect(out).toHaveLength(1);
    expect(out[0].eventType).toBe('invoice_overdue');
    expect(out[0].subjectId).toBe('inv-1');
    // 15 days past due (May 31 → Jun 15) → bucket 1.
    expect(out[0].dedupeKey).toBe('invoice_overdue:inv-1:bucket1');
    expect(out[0].title.startsWith(UNVERIFIED_PREFIX)).toBe(true);
    expect(out[0].message).toContain('15 days past due');
    expect(out[0].metadata.days_past_due).toBe(15);
  });

  it('does NOT flag an invoice not yet past the threshold', () => {
    // Due Jun 14, asOf Jun 15 → 1 day past due; threshold 5 → not yet.
    const out = detectOverdueInvoices([invoice({ dueDate: '2026-06-14' })], 5, asOf);
    expect(out).toHaveLength(0);
  });

  it('skips draft / paid / void invoices and zero-balance invoices', () => {
    const inputs: Invoice[] = [
      invoice({ id: 'd', status: 'draft', dueDate: '2026-01-01' }),
      invoice({ id: 'p', status: 'paid', dueDate: '2026-01-01', balanceDue: 0 }),
      invoice({ id: 'v', status: 'void', dueDate: '2026-01-01' }),
      invoice({ id: 'z', status: 'sent', dueDate: '2026-01-01', balanceDue: 0 }),
    ];
    expect(detectOverdueInvoices(inputs, 1, asOf)).toHaveLength(0);
  });

  it('flags a partially_paid invoice with a remaining balance', () => {
    const out = detectOverdueInvoices(
      [
        invoice({
          status: 'partially_paid',
          dueDate: '2026-05-31',
          amountPaid: 40,
          balanceDue: 60,
        }),
      ],
      1,
      asOf
    );
    expect(out).toHaveLength(1);
    expect(out[0].metadata.balance_due).toBe(60);
  });

  it('advances the dedupe bucket as the invoice ages (re-notify on worsening, not daily)', () => {
    const deep = detectOverdueInvoices(
      [invoice({ dueDate: '2026-04-10', balanceDue: 100 })],
      1,
      asOf
    );
    // Apr 10 → Jun 15 = 66 days → bucket 60.
    expect(deep[0].dedupeKey).toBe('invoice_overdue:inv-1:bucket60');
  });

  it('ignores an invoice with no due date', () => {
    expect(detectOverdueInvoices([invoice({ dueDate: null })], 1, asOf)).toHaveLength(0);
  });
});

describe('detectBillsDueSoon', () => {
  const asOf = '2026-06-05';

  it('flags an open bill due within the window', () => {
    const out = detectBillsDueSoon([bill({ dueDate: '2026-06-10', balanceDue: 200 })], 7, asOf);
    expect(out).toHaveLength(1);
    expect(out[0].eventType).toBe('bill_due_soon');
    expect(out[0].dedupeKey).toBe('bill_due_soon:bill-1:2026-06-10');
    expect(out[0].metadata.days_until_due).toBe(5);
    expect(out[0].message).toContain('in 5 days');
  });

  it('uses "today" wording when due today (0 days)', () => {
    const out = detectBillsDueSoon([bill({ dueDate: asOf })], 7, asOf);
    expect(out[0].metadata.days_until_due).toBe(0);
    expect(out[0].message).toContain('due today');
  });

  it('does NOT flag a bill beyond the window', () => {
    expect(detectBillsDueSoon([bill({ dueDate: '2026-06-20' })], 7, asOf)).toHaveLength(0);
  });

  it('does NOT flag a bill already past due (upcoming event only)', () => {
    expect(detectBillsDueSoon([bill({ dueDate: '2026-06-01' })], 7, asOf)).toHaveLength(0);
  });

  it('skips draft / paid / void / zero-balance bills', () => {
    const inputs: Bill[] = [
      bill({ id: 'd', status: 'draft', dueDate: '2026-06-06' }),
      bill({ id: 'p', status: 'paid', dueDate: '2026-06-06', balanceDue: 0 }),
      bill({ id: 'v', status: 'void', dueDate: '2026-06-06' }),
      bill({ id: 'z', status: 'open', dueDate: '2026-06-06', balanceDue: 0 }),
    ];
    expect(detectBillsDueSoon(inputs, 7, asOf)).toHaveLength(0);
  });
});

describe('detectLowBankBalances', () => {
  const asOf = '2026-06-15';

  it('flags an active account strictly below the dollar floor (compared in cents)', () => {
    const out = detectLowBankBalances([bankAccount({ currentBalance: 499.99 })], 500, null, asOf);
    expect(out).toHaveLength(1);
    expect(out[0].eventType).toBe('low_bank_balance');
    expect(out[0].dedupeKey).toBe('low_bank_balance:ba-1:2026-06-15');
    expect(out[0].metadata.current_balance).toBe(499.99);
    expect(out[0].metadata.threshold).toBe(500);
  });

  it('does NOT flag an account exactly AT the floor (>= is safe)', () => {
    // 500.00 dollars == 50000 cents == threshold 50000 cents → not below.
    expect(
      detectLowBankBalances([bankAccount({ currentBalance: 500 })], 500, null, asOf)
    ).toHaveLength(0);
  });

  it('uses integer cents (a fractional-cent balance just above does not falsely trigger)', () => {
    // 500.001 rounds to 50000 cents == floor → not below. Proves no float drift.
    expect(
      detectLowBankBalances([bankAccount({ currentBalance: 500.001 })], 500, null, asOf)
    ).toHaveLength(0);
  });

  it('flags a negative (overdrawn) balance', () => {
    const out = detectLowBankBalances([bankAccount({ currentBalance: -25 })], 0, null, asOf);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('-$25.00');
  });

  it('honors a single-account scope', () => {
    const accounts = [
      bankAccount({ id: 'ba-1', currentBalance: 100 }),
      bankAccount({ id: 'ba-2', currentBalance: 100 }),
    ];
    const out = detectLowBankBalances(accounts, 500, 'ba-2', asOf);
    expect(out).toHaveLength(1);
    expect(out[0].subjectId).toBe('ba-2');
  });

  it('skips inactive accounts and returns nothing when no threshold is configured', () => {
    expect(
      detectLowBankBalances([bankAccount({ isActive: false, currentBalance: 0 })], 500, null, asOf)
    ).toHaveLength(0);
    expect(
      detectLowBankBalances([bankAccount({ currentBalance: 0 })], null, null, asOf)
    ).toHaveLength(0);
  });
});

describe('detectTaxDeadlines', () => {
  it('flags an upcoming deadline within the window', () => {
    const out = detectTaxDeadlines([taxEntry({ daysUntilDue: 10, overdue: false })], 14);
    expect(out).toHaveLength(1);
    expect(out[0].eventType).toBe('tax_deadline_upcoming');
    expect(out[0].subjectId).toBeNull(); // tax deadlines have no single row id
    expect(out[0].dedupeKey).toBe('tax_deadline_upcoming:agency-1:2026-07-31');
    expect(out[0].message).toContain('Representative cadence');
  });

  it('keys by agency NAME when the agency id is null (config-only agency)', () => {
    const out = detectTaxDeadlines(
      [taxEntry({ agencyId: null, agencyName: 'City of X', daysUntilDue: 3 })],
      14
    );
    expect(out[0].dedupeKey).toBe('tax_deadline_upcoming:City of X:2026-07-31');
  });

  it('does NOT flag a deadline beyond the window or one already overdue', () => {
    expect(detectTaxDeadlines([taxEntry({ daysUntilDue: 30 })], 14)).toHaveLength(0);
    expect(detectTaxDeadlines([taxEntry({ daysUntilDue: -2, overdue: true })], 14)).toHaveLength(0);
  });

  it('includes a deadline due today (0 days)', () => {
    const out = detectTaxDeadlines([taxEntry({ daysUntilDue: 0 })], 14);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('due today');
  });
});

describe('buildInvoiceSentCandidate', () => {
  it('builds one per-invoice candidate with an UNVERIFIED title + per-invoice dedupe key', () => {
    const c = buildInvoiceSentCandidate(
      invoice({ id: 'inv-9', invoiceNumber: '2002', total: 1234.56, customerName: 'Acme' })
    );
    expect(c.eventType).toBe('invoice_sent');
    expect(c.subjectId).toBe('inv-9');
    expect(c.dedupeKey).toBe('invoice_sent:inv-9'); // re-sending the same invoice will not re-notify
    expect(c.title.startsWith(UNVERIFIED_PREFIX)).toBe(true);
    expect(c.message).toContain('to Acme');
    expect(c.message).toContain('$1,234.56');
    expect(c.metadata.invoice_id).toBe('inv-9');
  });
});
