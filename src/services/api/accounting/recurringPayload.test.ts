import { describe, it, expect } from 'vitest';
import {
  buildRecurringBillInput,
  buildRecurringInvoiceInput,
  buildRecurringJournalLines,
} from './recurringPayload';
import { assertBalanced } from '../../../features/accounting/posting';
import type {
  RecurringBillPayload,
  RecurringInvoicePayload,
  RecurringJournalPayload,
} from '../../../features/accounting/types';

describe('buildRecurringInvoiceInput', () => {
  const payload: RecurringInvoicePayload = {
    customerId: 'cust-1',
    jobId: 'job-9',
    terms: 'Net 30',
    dueInDays: 30,
    taxCodeId: 'tax-1',
    memo: 'Monthly retainer',
    lines: [
      {
        description: 'Retainer',
        quantity: 1,
        unitPrice: 500,
        taxable: false,
        incomeAccountId: 'acc-service',
        classId: 'cl-1',
        locationId: 'lo-1',
        departmentId: 'de-1',
      },
    ],
  };

  it('maps header fields and computes the due date from dueInDays', () => {
    const input = buildRecurringInvoiceInput(payload, '2026-06-01');
    expect(input.customerId).toBe('cust-1');
    expect(input.jobId).toBe('job-9');
    expect(input.invoiceDate).toBe('2026-06-01');
    expect(input.dueDate).toBe('2026-07-01'); // +30 days
    expect(input.taxCodeId).toBe('tax-1');
  });

  it('carries line dimensions straight through to the invoice line', () => {
    const input = buildRecurringInvoiceInput(payload, '2026-06-01');
    expect(input.lines[0]).toMatchObject({
      quantity: 1,
      unitPrice: 500,
      incomeAccountId: 'acc-service',
      classId: 'cl-1',
      locationId: 'lo-1',
      departmentId: 'de-1',
    });
  });

  it('leaves due date null when no offset is given', () => {
    const input = buildRecurringInvoiceInput({ ...payload, dueInDays: null }, '2026-06-01');
    expect(input.dueDate).toBeNull();
  });
});

describe('buildRecurringBillInput', () => {
  const payload: RecurringBillPayload = {
    vendorId: 'v-1',
    terms: 'Net 15',
    dueInDays: 15,
    taxTotal: 8.25,
    memo: 'Monthly rent',
    lines: [
      {
        accountId: 'acc-opex',
        description: 'Shop rent',
        quantity: 1,
        unitCost: 1200,
        classId: 'cl-1',
        locationId: 'lo-2',
      },
    ],
  };

  it('maps header fields, tax, and due date', () => {
    const input = buildRecurringBillInput(payload, '2026-06-01');
    expect(input.vendorId).toBe('v-1');
    expect(input.billDate).toBe('2026-06-01');
    expect(input.dueDate).toBe('2026-06-16'); // +15 days
    expect(input.taxTotal).toBe(8.25);
  });

  it('carries line dimensions through to the bill line', () => {
    const input = buildRecurringBillInput(payload, '2026-06-01');
    expect(input.lines[0]).toMatchObject({
      accountId: 'acc-opex',
      unitCost: 1200,
      classId: 'cl-1',
      locationId: 'lo-2',
    });
  });
});

describe('buildRecurringJournalLines', () => {
  it('maps a balanced payload to journal lines (carrying dimensions + parties)', () => {
    const payload: RecurringJournalPayload = {
      memo: 'Monthly depreciation',
      lines: [
        { accountId: 'acc-deprec-exp', debit: 250, credit: 0, classId: 'cl-1' },
        { accountId: 'acc-accum-deprec', debit: 0, credit: 250, classId: 'cl-1' },
      ],
    };
    const lines = buildRecurringJournalLines(payload);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountId: 'acc-deprec-exp', debit: 250, classId: 'cl-1' });
    // The result is something the DB-mirroring guard accepts.
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('THROWS on an unbalanced journal payload (mirrors post_journal_entry rejection)', () => {
    const payload: RecurringJournalPayload = {
      lines: [
        { accountId: 'a', debit: 100, credit: 0 },
        { accountId: 'b', debit: 0, credit: 90 },
      ],
    };
    expect(() => buildRecurringJournalLines(payload)).toThrow(/unbalanced/i);
  });

  it('THROWS on a single-line journal payload', () => {
    const payload: RecurringJournalPayload = {
      lines: [{ accountId: 'a', debit: 100, credit: 0 }],
    };
    expect(() => buildRecurringJournalLines(payload)).toThrow(/two lines/i);
  });
});
