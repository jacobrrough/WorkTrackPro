import { describe, it, expect } from 'vitest';
import {
  centsToDollars,
  dollarsToCents,
  formatCents,
  formatCentsAccounting,
  formatHundredthHours,
  formatRatePct,
  hoursToHundredthHours,
  hundredthHoursToHours,
  payRunPeriodLabel,
  payRunStatusBadgeClass,
  formatPayrollDate,
} from './payrollFormat';

describe('formatCents', () => {
  it('renders integer cents as localized dollars', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
  });

  it('treats non-finite input as zero', () => {
    expect(formatCents(Number.NaN)).toBe('$0.00');
  });
});

describe('formatCentsAccounting', () => {
  it('parenthesizes a negative cents amount', () => {
    expect(formatCentsAccounting(-1200)).toBe('($12.00)');
  });

  it('renders a non-negative amount plainly', () => {
    expect(formatCentsAccounting(1200)).toBe('$12.00');
    expect(formatCentsAccounting(0)).toBe('$0.00');
  });
});

describe('cents ⇄ dollars round-trip', () => {
  it('converts cents to a dollar number', () => {
    expect(centsToDollars(123456)).toBe(1234.56);
    expect(centsToDollars(0)).toBe(0);
  });

  it('converts a dollar number to integer cents, rounding', () => {
    expect(dollarsToCents(1234.56)).toBe(123456);
    // floating-point dollars round to the nearest cent (no drift).
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });
});

describe('hours helpers', () => {
  it('formats hundredths-of-an-hour with an h suffix', () => {
    expect(formatHundredthHours(150)).toBe('1.50 h');
    expect(formatHundredthHours(0)).toBe('0.00 h');
    expect(formatHundredthHours(4000)).toBe('40.00 h');
  });

  it('round-trips hours ⇄ hundredths', () => {
    expect(hundredthHoursToHours(150)).toBe(1.5);
    expect(hoursToHundredthHours(1.5)).toBe(150);
    expect(hoursToHundredthHours(40)).toBe(4000);
  });
});

describe('formatRatePct', () => {
  it('formats a decimal rate as a trimmed percentage', () => {
    expect(formatRatePct(0.062)).toBe('6.2%');
    expect(formatRatePct(0.0145)).toBe('1.45%');
    expect(formatRatePct(0.001)).toBe('0.1%');
    expect(formatRatePct(0.009)).toBe('0.9%');
    expect(formatRatePct(0)).toBe('0%');
  });
});

describe('formatPayrollDate', () => {
  it('formats an ISO date as a short local date without TZ drift', () => {
    expect(formatPayrollDate('2026-06-15')).toBe('Jun 15, 2026');
  });

  it('handles a longer timestamp by taking the date portion', () => {
    expect(formatPayrollDate('2026-06-15T08:30:00Z')).toBe('Jun 15, 2026');
  });

  it('renders an em-dash for null/empty and passes through garbage', () => {
    expect(formatPayrollDate(null)).toBe('—');
    expect(formatPayrollDate('')).toBe('—');
    expect(formatPayrollDate('not-a-date')).toBe('not-a-date');
  });
});

describe('payRunPeriodLabel', () => {
  it('builds a compact period + pay-date label', () => {
    expect(payRunPeriodLabel('2026-06-01', '2026-06-14', '2026-06-19')).toBe(
      'Jun 1, 2026 … Jun 14, 2026 · pay Jun 19, 2026'
    );
  });
});

describe('payRunStatusBadgeClass', () => {
  it('maps each status to a distinct tone', () => {
    expect(payRunStatusBadgeClass('draft')).toContain('slate');
    expect(payRunStatusBadgeClass('calculated')).toContain('amber');
    expect(payRunStatusBadgeClass('committed')).toContain('emerald');
    expect(payRunStatusBadgeClass('void')).toContain('red');
  });
});
