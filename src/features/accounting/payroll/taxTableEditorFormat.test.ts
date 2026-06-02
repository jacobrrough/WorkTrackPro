import { describe, it, expect } from 'vitest';
import {
  groupTaxTables,
  isPercentageBody,
  missingTaxKindLabels,
  missingTaxKinds,
  summarizeBody,
} from './taxTableEditorFormat';
import { PAYROLL_TAX_KINDS, type PayrollTaxTable, type PayrollTaxTableBody } from '../types';

const flatBody: PayrollTaxTableBody = {
  method: 'flat',
  rate: 0.062,
  employerRate: 0.062,
  wageBaseCents: 16810000, // $168,100
  thresholdCents: null,
  employeePaid: true,
  employerPaid: true,
};

const pctBody: PayrollTaxTableBody = {
  method: 'percentage',
  payPeriodsPerYear: 1,
  standardDeductionCents: 1500000,
  brackets: [
    { overCents: 0, butNotOverCents: 1160000, baseCents: 0, rate: 0.1, ofExcessOverCents: 0 },
    { overCents: 1160000, butNotOverCents: null, baseCents: 116000, rate: 0.12, ofExcessOverCents: 1160000 },
  ],
};

function row(over: Partial<PayrollTaxTable>): PayrollTaxTable {
  return {
    id: 'r1',
    jurisdiction: 'federal',
    taxKind: 'fica_ss',
    taxYear: 2026,
    effectiveDate: '2026-01-01',
    filingStatus: 'any',
    payFrequency: 'any',
    body: flatBody,
    sourceCitation: 'IRS Pub 15',
    sourceRevision: '2026',
    notes: null,
    isActive: true,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('missingTaxKinds', () => {
  it('returns every kind when none are seeded', () => {
    expect(missingTaxKinds([])).toEqual(PAYROLL_TAX_KINDS);
  });

  it('returns the complement of the seeded kinds', () => {
    const seeded = PAYROLL_TAX_KINDS.filter((k) => k !== 'futa' && k !== 'ca_ett');
    expect(missingTaxKinds(seeded)).toEqual(['futa', 'ca_ett']);
  });

  it('returns nothing when every kind is seeded', () => {
    expect(missingTaxKinds([...PAYROLL_TAX_KINDS])).toEqual([]);
  });

  it('exposes human labels for the gaps', () => {
    const seeded = PAYROLL_TAX_KINDS.filter((k) => k !== 'futa');
    expect(missingTaxKindLabels(seeded)).toEqual(['Federal Unemployment (FUTA)']);
  });
});

describe('isPercentageBody', () => {
  it('narrows the percentage-method body', () => {
    expect(isPercentageBody(pctBody)).toBe(true);
    expect(isPercentageBody(flatBody)).toBe(false);
  });
});

describe('summarizeBody', () => {
  it('summarizes a flat-rate body with rate + cap', () => {
    expect(summarizeBody(flatBody)).toBe('6.2% employee · 6.2% employer · cap $168,100');
  });

  it('summarizes a flat-rate body with an over-threshold (Additional Medicare style)', () => {
    const addl: PayrollTaxTableBody = {
      method: 'flat',
      rate: 0.009,
      employerRate: 0,
      wageBaseCents: null,
      thresholdCents: 20000000,
      employeePaid: true,
      employerPaid: false,
    };
    expect(summarizeBody(addl)).toBe('0.9% employee · over $200,000');
  });

  it('summarizes a percentage-method body by bracket count', () => {
    expect(summarizeBody(pctBody)).toBe('Percentage method · 2 brackets');
  });
});

describe('groupTaxTables', () => {
  it('splits rows into federal then CA, dropping empty groups', () => {
    const rows = [row({ jurisdiction: 'federal' }), row({ id: 'r2', jurisdiction: 'CA', taxKind: 'ca_sdi' })];
    const groups = groupTaxTables(rows);
    expect(groups.map((g) => g.jurisdiction)).toEqual(['federal', 'CA']);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[1].rows).toHaveLength(1);
  });

  it('omits a jurisdiction with no rows', () => {
    const groups = groupTaxTables([row({ jurisdiction: 'federal' })]);
    expect(groups.map((g) => g.jurisdiction)).toEqual(['federal']);
  });
});
