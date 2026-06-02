import { describe, it, expect } from 'vitest';
import {
  buildPaystub,
  buildReportRow,
  buildPayrollReportStub,
  buildNachaStub,
  maskSsn,
  PAYROLL_UNVERIFIED_DISCLAIMER,
} from './payrollReportStubs';
import type { Employee, Paycheck, PayRun } from '../../../features/accounting/types';

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp1',
    profileId: null,
    displayName: 'Jane Worker',
    email: null,
    employmentType: 'w2',
    fedFilingStatus: 'single',
    fedMultipleJobs: false,
    fedDependentsAmountCents: 0,
    fedOtherIncomeCents: 0,
    fedDeductionsCents: 0,
    fedExtraWithholdingCents: 0,
    caFilingStatus: 'single',
    caAllowances: 0,
    caExtraWithholdingCents: 0,
    payType: 'hourly',
    payRateCents: 3000,
    defaultJobId: null,
    ssn: null,
    bankRoutingMasked: null,
    bankAccountMasked: null,
    isActive: true,
    notes: null,
    createdBy: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function paycheck(overrides: Partial<Paycheck> = {}): Paycheck {
  return {
    id: 'pc1',
    payRunId: 'run1',
    employeeId: 'emp1',
    hoursRegularHundredthHours: 4000,
    hoursOtHundredthHours: 0,
    grossCents: 200000,
    taxes: {
      fed_income_pit: { employeeCents: 20129, employerCents: 0 },
      ca_pit: { employeeCents: 7182, employerCents: 0 },
      fica_ss: { employeeCents: 12400, employerCents: 12400, taxableWageCents: 200000 },
      fica_medicare: { employeeCents: 2900, employerCents: 2900, taxableWageCents: 200000 },
      ca_sdi: { employeeCents: 2400, employerCents: 0 },
      futa: { employeeCents: 0, employerCents: 1200 },
      ca_ui: { employeeCents: 0, employerCents: 6800 },
      ca_ett: { employeeCents: 0, employerCents: 200 },
    },
    deductions: [{ code: 'health', label: 'Health', amountCents: 5000, pretax: false }],
    employerTaxesCents: 23500,
    employeeTaxesCents: 45011,
    otherDeductionsCents: 5000,
    netCents: 149989,
    sourceShiftIds: ['s1'],
    memo: null,
    createdAt: '2026-06-19',
    updatedAt: '2026-06-19',
    ...overrides,
  };
}

function run(overrides: Partial<PayRun> = {}): PayRun {
  return {
    id: 'run1',
    payScheduleId: 'sch1',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-14',
    payDate: '2026-06-19',
    taxYear: 2026,
    status: 'committed',
    summary: {},
    postedJournalEntryId: 'je1',
    committedAt: '2026-06-19',
    committedBy: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    createdBy: null,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-19',
    ...overrides,
  };
}

describe('maskSsn', () => {
  it('masks to the last 4 digits', () => {
    expect(maskSsn('123-45-6789')).toBe('•••-••-6789');
    expect(maskSsn('123456789')).toBe('•••-••-6789');
  });
  it('fully masks a too-short value', () => {
    expect(maskSsn('12')).toBe('•••-••-••••');
  });
});

describe('buildPaystub', () => {
  it('orders tax lines and preserves the cents identity', () => {
    const stub = buildPaystub(paycheck(), employee(), run());
    expect(stub.employeeName).toBe('Jane Worker');
    expect(stub.periodStart).toBe('2026-06-01');
    expect(stub.payDate).toBe('2026-06-19');
    // Employee income taxes lead the ordering.
    expect(stub.taxLines[0].taxKind).toBe('fed_income_pit');
    expect(stub.taxLines[1].taxKind).toBe('ca_pit');
    expect(stub.taxLines[2].taxKind).toBe('fica_ss');
    // Cents identity held straight from the paycheck.
    expect(stub.netCents).toBe(
      stub.grossCents - stub.employeeTaxesCents - stub.otherDeductionsCents
    );
    expect(stub.deductions[0].code).toBe('health');
  });
  it('falls back to a name and blank period when employee/run are null', () => {
    const stub = buildPaystub(paycheck({ employeeName: undefined }), null, null);
    expect(stub.employeeName).toBe('emp1'.slice(0, 8));
    expect(stub.periodStart).toBe('');
  });
  it('omits tax lines a paycheck does not carry', () => {
    const stub = buildPaystub(
      paycheck({ taxes: { fed_income_pit: { employeeCents: 100, employerCents: 0 } } }),
      employee(),
      run()
    );
    expect(stub.taxLines).toHaveLength(1);
    expect(stub.taxLines[0].taxKind).toBe('fed_income_pit');
  });
});

describe('buildReportRow', () => {
  it('aggregates two paychecks into a W-2-style stub row', () => {
    const rows = buildReportRow(
      employee({ ssn: '123-45-6789' }),
      [paycheck(), paycheck({ id: 'pc2' })],
      2026
    );
    expect(rows.grossWagesCents).toBe(400000); // 2 * 200,000
    expect(rows.fedIncomeWithheldCents).toBe(40258); // 2 * 20,129
    expect(rows.ssWithheldCents).toBe(24800); // 2 * 12,400
    expect(rows.ssWagesCents).toBe(400000); // 2 * taxable 200,000
    expect(rows.caPitWithheldCents).toBe(14364); // 2 * 7,182
    expect(rows.caSdiWithheldCents).toBe(4800); // 2 * 2,400
    expect(rows.ssnMasked).toBe('•••-••-6789');
  });
  it('folds Additional Medicare into the Medicare-withheld box', () => {
    const pc = paycheck({
      taxes: {
        fica_medicare: { employeeCents: 2900, employerCents: 2900 },
        medicare_addl: { employeeCents: 900, employerCents: 0 },
      },
    });
    const rows = buildReportRow(employee(), [pc], 2026);
    expect(rows.medicareWithheldCents).toBe(3800); // 2900 + 900
  });
});

describe('buildPayrollReportStub', () => {
  it('builds a W-2 stub from w2 employees only, always unverified', () => {
    const report = buildPayrollReportStub('w2', 2026, [
      { employee: employee({ id: 'a', displayName: 'Aaron' }), paychecks: [paycheck()] },
      { employee: employee({ id: 'z', displayName: 'Zoe' }), paychecks: [paycheck()] },
      {
        employee: employee({ id: 'c', displayName: 'Carl', employmentType: '1099' }),
        paychecks: [paycheck()],
      },
    ]);
    expect(report.kind).toBe('w2');
    expect(report.unverified).toBe(true);
    expect(report.disclaimer).toBe(PAYROLL_UNVERIFIED_DISCLAIMER);
    // 1099 contractor excluded; rows sorted by name.
    expect(report.rows.map((r) => r.employeeName)).toEqual(['Aaron', 'Zoe']);
  });
  it('builds a 1099-NEC stub from 1099 contractors only', () => {
    const report = buildPayrollReportStub('1099_nec', 2026, [
      { employee: employee({ id: 'a', displayName: 'W2 person' }), paychecks: [paycheck()] },
      {
        employee: employee({ id: 'c', displayName: 'Carl', employmentType: '1099' }),
        paychecks: [paycheck()],
      },
    ]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].employeeName).toBe('Carl');
  });
  it('stamps the quarter on a DE-9C stub', () => {
    const report = buildPayrollReportStub(
      'de9c',
      2026,
      [{ employee: employee(), paychecks: [paycheck()] }],
      2
    );
    expect(report.kind).toBe('de9c');
    expect(report.quarter).toBe(2);
  });
});

describe('buildNachaStub', () => {
  it('produces a clearly-marked NON-FILEABLE placeholder, never bankable', () => {
    const r = buildNachaStub(run(), [paycheck(), paycheck({ id: 'pc2', netCents: 0 })]);
    expect(r.bankable).toBe(false);
    expect(r.entryCount).toBe(1); // the net=0 check is excluded
    expect(r.totalNetCents).toBe(149989);
    expect(r.content).toContain('NOT FILEABLE');
    expect(r.content).toContain('BANK DETAILS WITHHELD');
    expect(r.content).not.toMatch(/\b\d{9}\b/); // no real 9-digit routing number leaked
  });
});
