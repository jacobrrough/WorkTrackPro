import { describe, it, expect } from 'vitest';
import {
  bankScopedRules,
  buildEventRows,
  enableBlockedReason,
  enabledEventCount,
  eventPrefKey,
  formatThresholdSummary,
  recipientSummary,
  thresholdFieldSpec,
  thresholdKind,
  validateThreshold,
} from './notificationConfigView';
import { NOTIFICATION_EVENT_TYPES, type NotificationRule } from './types';

function rule(partial: Partial<NotificationRule>): NotificationRule {
  return {
    id: 'rule-1',
    eventType: 'invoice_overdue',
    enabled: false,
    threshold: null,
    bankAccountId: null,
    notes: null,
    createdBy: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...partial,
  };
}

describe('thresholdKind / thresholdFieldSpec', () => {
  it('classifies each event correctly', () => {
    expect(thresholdKind('invoice_sent')).toBe('none');
    expect(thresholdKind('invoice_overdue')).toBe('days');
    expect(thresholdKind('bill_due_soon')).toBe('days');
    expect(thresholdKind('low_bank_balance')).toBe('dollars');
    expect(thresholdKind('tax_deadline_upcoming')).toBe('days');
  });

  it('hides the threshold input only for invoice_sent', () => {
    expect(thresholdFieldSpec('invoice_sent').hidden).toBe(true);
    for (const e of NOTIFICATION_EVENT_TYPES.filter((x) => x !== 'invoice_sent')) {
      expect(thresholdFieldSpec(e).hidden).toBe(false);
    }
  });

  it('maps every event to its acct_* preference key', () => {
    expect(eventPrefKey('invoice_sent')).toBe('acct_invoice_sent');
    expect(eventPrefKey('low_bank_balance')).toBe('acct_low_bank_balance');
    expect(eventPrefKey('tax_deadline_upcoming')).toBe('acct_tax_deadline');
  });
});

describe('validateThreshold', () => {
  it('returns null value (no error) for the none-kind event', () => {
    expect(validateThreshold('invoice_sent', '5')).toEqual({ value: null, error: null });
  });

  it('treats empty input as clearing the threshold', () => {
    expect(validateThreshold('bill_due_soon', '')).toEqual({ value: null, error: null });
    expect(validateThreshold('low_bank_balance', '   ')).toEqual({ value: null, error: null });
  });

  it('accepts a whole-day count for day events', () => {
    expect(validateThreshold('invoice_overdue', '1')).toEqual({ value: 1, error: null });
    expect(validateThreshold('bill_due_soon', '30')).toEqual({ value: 30, error: null });
    expect(validateThreshold('invoice_overdue', '0')).toEqual({ value: 0, error: null });
  });

  it('rejects non-integer / negative day counts', () => {
    expect(validateThreshold('bill_due_soon', '7.5').value).toBeNull();
    expect(validateThreshold('bill_due_soon', '7.5').error).toMatch(/whole number/i);
    expect(validateThreshold('invoice_overdue', '-1').value).toBeNull();
    expect(validateThreshold('invoice_overdue', '-1').error).toMatch(/0 or more days/i);
  });

  it('accepts a dollar amount with up to two decimals', () => {
    expect(validateThreshold('low_bank_balance', '500')).toEqual({ value: 500, error: null });
    expect(validateThreshold('low_bank_balance', '500.25')).toEqual({ value: 500.25, error: null });
    expect(validateThreshold('low_bank_balance', '0')).toEqual({ value: 0, error: null });
  });

  it('rejects sub-cent precision and negative dollars', () => {
    expect(validateThreshold('low_bank_balance', '1.005').value).toBeNull();
    expect(validateThreshold('low_bank_balance', '1.005').error).toMatch(/two decimal/i);
    expect(validateThreshold('low_bank_balance', '-5').value).toBeNull();
    expect(validateThreshold('low_bank_balance', '-5').error).toMatch(/\$0 or more/i);
  });

  it('rejects non-numeric input', () => {
    expect(validateThreshold('bill_due_soon', 'abc')).toEqual({ value: null, error: 'Enter a number.' });
  });
});

describe('enableBlockedReason', () => {
  it('never blocks invoice_sent (no threshold needed)', () => {
    expect(enableBlockedReason('invoice_sent', null)).toBeNull();
  });

  it('blocks enabling a day/dollar event with no threshold', () => {
    expect(enableBlockedReason('bill_due_soon', null)).toMatch(/day threshold/i);
    expect(enableBlockedReason('low_bank_balance', null)).toMatch(/minimum balance/i);
  });

  it('allows enabling once a threshold is set (incl. zero)', () => {
    expect(enableBlockedReason('bill_due_soon', 7)).toBeNull();
    expect(enableBlockedReason('low_bank_balance', 0)).toBeNull();
  });
});

describe('formatThresholdSummary', () => {
  it('renders an em dash for the none event', () => {
    expect(formatThresholdSummary('invoice_sent', null)).toBe('—');
  });

  it('renders "not set" when the threshold is null', () => {
    expect(formatThresholdSummary('bill_due_soon', null)).toBe('not set');
  });

  it('renders day counts with singular/plural', () => {
    expect(formatThresholdSummary('invoice_overdue', 1)).toBe('1 day');
    expect(formatThresholdSummary('bill_due_soon', 30)).toBe('30 days');
  });

  it('renders dollars with two decimals and thousands separators', () => {
    expect(formatThresholdSummary('low_bank_balance', 500)).toBe('$500.00');
    expect(formatThresholdSummary('low_bank_balance', 1234.5)).toBe('$1,234.50');
  });
});

describe('buildEventRows', () => {
  it('returns all five events in canonical order, defaulting to disabled/unset', () => {
    const rows = buildEventRows([]);
    expect(rows.map((r) => r.event)).toEqual(NOTIFICATION_EVENT_TYPES);
    expect(rows.every((r) => r.enabled === false && r.threshold === null && r.ruleId === null)).toBe(true);
  });

  it('pairs each event with its base (NULL-account) rule', () => {
    const rows = buildEventRows([
      rule({ id: 'r-overdue', eventType: 'invoice_overdue', enabled: true, threshold: 5 }),
      rule({ id: 'r-low', eventType: 'low_bank_balance', enabled: false, threshold: 250 }),
    ]);
    const overdue = rows.find((r) => r.event === 'invoice_overdue')!;
    expect(overdue.ruleId).toBe('r-overdue');
    expect(overdue.enabled).toBe(true);
    expect(overdue.threshold).toBe(5);
    const low = rows.find((r) => r.event === 'low_bank_balance')!;
    expect(low.threshold).toBe(250);
  });

  it('does NOT use a bank-account-scoped rule as the base row', () => {
    const rows = buildEventRows([
      rule({ id: 'r-scoped', eventType: 'low_bank_balance', enabled: true, threshold: 100, bankAccountId: 'bank-1' }),
    ]);
    const low = rows.find((r) => r.event === 'low_bank_balance')!;
    // No NULL-account base rule present → row stays unconfigured.
    expect(low.ruleId).toBeNull();
    expect(low.enabled).toBe(false);
    expect(low.threshold).toBeNull();
  });
});

describe('bankScopedRules / enabledEventCount', () => {
  it('lists only non-null-account rules, sorted by hydrated name', () => {
    const scoped = bankScopedRules([
      rule({ id: 'base', eventType: 'low_bank_balance', bankAccountId: null }),
      rule({ id: 'b', eventType: 'low_bank_balance', bankAccountId: 'bank-b', bankAccountName: 'Zeta' }),
      rule({ id: 'a', eventType: 'low_bank_balance', bankAccountId: 'bank-a', bankAccountName: 'Alpha' }),
    ]);
    expect(scoped.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('counts distinct enabled events', () => {
    expect(
      enabledEventCount([
        rule({ eventType: 'invoice_overdue', enabled: true }),
        rule({ eventType: 'invoice_overdue', enabled: true, bankAccountId: 'x' }),
        rule({ eventType: 'bill_due_soon', enabled: false }),
      ])
    ).toBe(1);
  });
});

describe('recipientSummary', () => {
  it('handles empty / singular / plural', () => {
    expect(recipientSummary(0)).toMatch(/No recipients/i);
    expect(recipientSummary(1)).toMatch(/^1 person/);
    expect(recipientSummary(4)).toMatch(/^4 people/);
  });
});
