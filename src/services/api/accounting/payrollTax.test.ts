import { describe, it, expect } from 'vitest';
import {
  applyRateCents,
  taxableUnderBaseCents,
  taxableOverThresholdCents,
  annualTaxFromBracketsCents,
  buildTaxTableSet,
  resolvePercentageRow,
  computeFederalIncomeWithholding,
  computeCaliforniaWithholding,
  computePaycheckTaxes,
  assemblePaycheck,
  type PayrollTaxTableSet,
} from './payrollTax';
import type {
  Employee,
  PayrollTaxTable,
  PercentageBracket,
  FlatRateTaxTable,
  PercentageMethodTaxTable,
} from '../../../features/accounting/types';

// ── Fixtures: the OFFICIAL-seeded rows (migration 028), as parsed PayrollTaxTable objects ──

function flatRow(
  id: string,
  taxKind: PayrollTaxTable['taxKind'],
  jurisdiction: PayrollTaxTable['jurisdiction'],
  body: FlatRateTaxTable
): PayrollTaxTable {
  return {
    id,
    jurisdiction,
    taxKind,
    taxYear: 2025,
    effectiveDate: '2025-01-01',
    filingStatus: 'any',
    payFrequency: 'any',
    body,
    sourceCitation: 'test',
    sourceRevision: '2025',
    notes: null,
    isActive: true,
    createdBy: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

function pctRow(
  id: string,
  taxKind: 'fed_income_pit' | 'ca_pit',
  jurisdiction: PayrollTaxTable['jurisdiction'],
  filingStatus: PayrollTaxTable['filingStatus'],
  brackets: PercentageBracket[]
): PayrollTaxTable {
  const body: PercentageMethodTaxTable = {
    method: 'percentage',
    payPeriodsPerYear: 1,
    standardDeductionCents: null,
    brackets,
  };
  return {
    id,
    jurisdiction,
    taxKind,
    taxYear: 2025,
    effectiveDate: '2025-01-01',
    filingStatus,
    payFrequency: 'annual',
    body,
    sourceCitation: 'test',
    sourceRevision: '2025',
    notes: null,
    isActive: true,
    createdBy: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

// 2025 Single / STANDARD federal annual brackets (Pub 15-T Worksheet 1A), in cents.
const FED_SINGLE_BRACKETS: PercentageBracket[] = [
  { overCents: 0, butNotOverCents: 640000, baseCents: 0, rate: 0.0, ofExcessOverCents: 0 },
  {
    overCents: 640000,
    butNotOverCents: 1832500,
    baseCents: 0,
    rate: 0.1,
    ofExcessOverCents: 640000,
  },
  {
    overCents: 1832500,
    butNotOverCents: 5487500,
    baseCents: 119250,
    rate: 0.12,
    ofExcessOverCents: 1832500,
  },
  {
    overCents: 5487500,
    butNotOverCents: 10975000,
    baseCents: 557850,
    rate: 0.22,
    ofExcessOverCents: 5487500,
  },
  {
    overCents: 10975000,
    butNotOverCents: 20370000,
    baseCents: 1765100,
    rate: 0.24,
    ofExcessOverCents: 10975000,
  },
  {
    overCents: 20370000,
    butNotOverCents: 25692500,
    baseCents: 4019900,
    rate: 0.32,
    ofExcessOverCents: 20370000,
  },
  {
    overCents: 25692500,
    butNotOverCents: 63275000,
    baseCents: 5723100,
    rate: 0.35,
    ofExcessOverCents: 25692500,
  },
  {
    overCents: 63275000,
    butNotOverCents: null,
    baseCents: 18876975,
    rate: 0.37,
    ofExcessOverCents: 63275000,
  },
];

// 2025 Single CA DE 44 Method B Table 5 annual brackets, in cents.
const CA_SINGLE_BRACKETS: PercentageBracket[] = [
  { overCents: 0, butNotOverCents: 1075600, baseCents: 0, rate: 0.011, ofExcessOverCents: 0 },
  {
    overCents: 1075600,
    butNotOverCents: 2549900,
    baseCents: 11832,
    rate: 0.022,
    ofExcessOverCents: 1075600,
  },
  {
    overCents: 2549900,
    butNotOverCents: 4024500,
    baseCents: 44267,
    rate: 0.044,
    ofExcessOverCents: 2549900,
  },
  {
    overCents: 4024500,
    butNotOverCents: 5586600,
    baseCents: 109149,
    rate: 0.066,
    ofExcessOverCents: 4024500,
  },
  {
    overCents: 5586600,
    butNotOverCents: 7060600,
    baseCents: 212248,
    rate: 0.088,
    ofExcessOverCents: 5586600,
  },
  {
    overCents: 7060600,
    butNotOverCents: 36065900,
    baseCents: 341960,
    rate: 0.1023,
    ofExcessOverCents: 7060600,
  },
  {
    overCents: 36065900,
    butNotOverCents: 43278700,
    baseCents: 3309402,
    rate: 0.1133,
    ofExcessOverCents: 36065900,
  },
  {
    overCents: 43278700,
    butNotOverCents: 72131400,
    baseCents: 4126413,
    rate: 0.1243,
    ofExcessOverCents: 43278700,
  },
  {
    overCents: 72131400,
    butNotOverCents: 100000000,
    baseCents: 7712418,
    rate: 0.1353,
    ofExcessOverCents: 72131400,
  },
  {
    overCents: 100000000,
    butNotOverCents: null,
    baseCents: 11484597,
    rate: 0.1463,
    ofExcessOverCents: 100000000,
  },
];

function fullTaxSet(): PayrollTaxTableSet {
  const rows: PayrollTaxTable[] = [
    flatRow('ss', 'fica_ss', 'federal', {
      rate: 0.062,
      employerRate: 0.062,
      wageBaseCents: 17610000,
      thresholdCents: null,
      employeePaid: true,
      employerPaid: true,
    }),
    flatRow('med', 'fica_medicare', 'federal', {
      rate: 0.0145,
      employerRate: 0.0145,
      wageBaseCents: null,
      thresholdCents: null,
      employeePaid: true,
      employerPaid: true,
    }),
    flatRow('addl', 'medicare_addl', 'federal', {
      rate: 0.009,
      employerRate: null,
      wageBaseCents: null,
      thresholdCents: 20000000,
      employeePaid: true,
      employerPaid: false,
    }),
    flatRow('futa', 'futa', 'federal', {
      rate: 0.006,
      employerRate: 0.006,
      wageBaseCents: 700000,
      thresholdCents: null,
      employeePaid: false,
      employerPaid: true,
    }),
    flatRow('ui', 'ca_ui', 'CA', {
      rate: 0.034,
      employerRate: 0.034,
      wageBaseCents: 700000,
      thresholdCents: null,
      employeePaid: false,
      employerPaid: true,
    }),
    flatRow('ett', 'ca_ett', 'CA', {
      rate: 0.001,
      employerRate: 0.001,
      wageBaseCents: 700000,
      thresholdCents: null,
      employeePaid: false,
      employerPaid: true,
    }),
    flatRow('sdi', 'ca_sdi', 'CA', {
      rate: 0.012,
      employerRate: null,
      wageBaseCents: null,
      thresholdCents: null,
      employeePaid: true,
      employerPaid: false,
    }),
    pctRow('fed-single', 'fed_income_pit', 'federal', 'single', FED_SINGLE_BRACKETS),
    pctRow('ca-single', 'ca_pit', 'CA', 'single', CA_SINGLE_BRACKETS),
  ];
  return buildTaxTableSet(2025, rows);
}

const baseEmployee: Pick<
  Employee,
  | 'employmentType'
  | 'fedFilingStatus'
  | 'fedMultipleJobs'
  | 'fedDependentsAmountCents'
  | 'fedOtherIncomeCents'
  | 'fedDeductionsCents'
  | 'fedExtraWithholdingCents'
  | 'caFilingStatus'
  | 'caAllowances'
  | 'caExtraWithholdingCents'
> = {
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
};

// ── applyRateCents ──────────────────────────────────────────────────────────

describe('applyRateCents', () => {
  it('rounds half up to the nearest cent', () => {
    expect(applyRateCents(100000, 0.062)).toBe(6200); // $1000 * 6.2% = $62.00
    expect(applyRateCents(100050, 0.0145)).toBe(1451); // 100050 * 0.0145 = 1450.725 → 1451
  });
  it('returns 0 for non-positive wage or rate', () => {
    expect(applyRateCents(0, 0.062)).toBe(0);
    expect(applyRateCents(100000, 0)).toBe(0);
    expect(applyRateCents(-5, 0.1)).toBe(0);
  });
});

// ── wage-base + threshold slicing ─────────────────────────────────────────────

describe('taxableUnderBaseCents', () => {
  it('caps the period wage at the remaining base', () => {
    // SS base 17,610,000 cents; YTD 17,500,000 → only 110,000 of a 200,000 period is taxable.
    expect(taxableUnderBaseCents(200000, 17500000, 17610000)).toBe(110000);
  });
  it('returns the full period wage when uncapped', () => {
    expect(taxableUnderBaseCents(200000, 99999999, null)).toBe(200000);
  });
  it('returns 0 once the base is fully consumed', () => {
    expect(taxableUnderBaseCents(200000, 17610000, 17610000)).toBe(0);
  });
});

describe('taxableOverThresholdCents', () => {
  it('returns only the slice above the threshold', () => {
    // threshold $200k = 20,000,000; YTD 19,900,000; period 200,000 → ends at 20,100,000.
    // Slice above = 20,100,000 − 20,000,000 = 100,000.
    expect(taxableOverThresholdCents(200000, 19900000, 20000000)).toBe(100000);
  });
  it('returns 0 entirely under the threshold', () => {
    expect(taxableOverThresholdCents(200000, 0, 20000000)).toBe(0);
  });
  it('returns the whole period once entirely over the threshold', () => {
    expect(taxableOverThresholdCents(200000, 25000000, 20000000)).toBe(200000);
  });
});

// ── bracket walk ──────────────────────────────────────────────────────────────

describe('annualTaxFromBracketsCents (federal single)', () => {
  it('is 0 below the first taxable bracket', () => {
    expect(annualTaxFromBracketsCents(500000, FED_SINGLE_BRACKETS)).toBe(0); // $5,000 < $6,400
  });
  it('computes the 10% bracket', () => {
    // $10,000 annual: base 0 + 10% of (1,000,000 − 640,000) = 36,000 cents.
    expect(annualTaxFromBracketsCents(1000000, FED_SINGLE_BRACKETS)).toBe(36000);
  });
  it('computes the 22% bracket exactly at a known point', () => {
    // $60,000 annual = 6,000,000 cents → bracket [5,487,500–10,975,000]:
    // base 557,850 + 22% of (6,000,000 − 5,487,500) = 557,850 + 112,750 = 670,600.
    expect(annualTaxFromBracketsCents(6000000, FED_SINGLE_BRACKETS)).toBe(670600);
  });
  it('computes the top open-ended bracket', () => {
    // $700,000 = 70,000,000 cents → top bracket: 18,876,975 + 37% of (70,000,000 − 63,275,000)
    // = 18,876,975 + 2,488,250 = 21,365,225.
    expect(annualTaxFromBracketsCents(70000000, FED_SINGLE_BRACKETS)).toBe(21365225);
  });
});

describe('annualTaxFromBracketsCents (CA single)', () => {
  it('computes the 1.1% first bracket', () => {
    // $10,000 = 1,000,000 cents → 1.1% of 1,000,000 = 11,000.
    expect(annualTaxFromBracketsCents(1000000, CA_SINGLE_BRACKETS)).toBe(11000);
  });
  it('computes a mid bracket exactly', () => {
    // $50,000 = 5,000,000 cents → [4,024,500–5,586,600]: 109,149 + 6.6% of (5,000,000 − 4,024,500)
    // = 109,149 + 64,383 = 173,532.
    expect(annualTaxFromBracketsCents(5000000, CA_SINGLE_BRACKETS)).toBe(173532);
  });
});

// ── lookup + fallback ─────────────────────────────────────────────────────────

describe('buildTaxTableSet + resolvePercentageRow', () => {
  it('indexes flat + percentage rows', () => {
    const set = fullTaxSet();
    expect(set.flat.fica_ss?.id).toBe('ss');
    expect(set.percentage['fed_income_pit:single']?.id).toBe('fed-single');
  });
  it('falls back married_separate → single and HOH → single', () => {
    const set = fullTaxSet();
    expect(resolvePercentageRow(set, 'fed_income_pit', 'married_separate')?.id).toBe('fed-single');
    expect(resolvePercentageRow(set, 'fed_income_pit', 'head_of_household')?.id).toBe('fed-single');
  });
  it('returns the latest-effective row when two share a key', () => {
    const older = pctRow('old', 'fed_income_pit', 'federal', 'single', FED_SINGLE_BRACKETS);
    const newer = {
      ...pctRow('new', 'fed_income_pit', 'federal', 'single', FED_SINGLE_BRACKETS),
      effectiveDate: '2025-07-01',
    };
    const set = buildTaxTableSet(2025, [older, newer]);
    expect(set.percentage['fed_income_pit:single']?.id).toBe('new');
  });
});

// ── per-tax computation ─────────────────────────────────────────────────────

describe('computeFederalIncomeWithholding', () => {
  it('annualizes a biweekly check, walks brackets, de-annualizes', () => {
    const set = fullTaxSet();
    // $2,000 biweekly → annual 52,000 (26 periods) = 5,200,000 cents.
    // Federal single: [1,832,500–5,487,500]: 119,250 + 12% of (5,200,000 − 1,832,500)
    //   = 119,250 + 404,100 = 523,350 annual. /26 = 20,128.8… → 20,129 per period.
    const line = computeFederalIncomeWithholding(
      { grossCents: 200000, ytdGrossCents: 0, employee: baseEmployee, frequency: 'biweekly' },
      set
    );
    expect(line?.kind).toBe('fed_income_pit');
    expect(line?.employerCents).toBe(0);
    expect(line?.employeeCents).toBe(20129);
  });
  it('adds the per-period Step 4(c) extra withholding', () => {
    const set = fullTaxSet();
    const line = computeFederalIncomeWithholding(
      {
        grossCents: 200000,
        ytdGrossCents: 0,
        employee: { ...baseEmployee, fedExtraWithholdingCents: 5000 },
        frequency: 'biweekly',
      },
      set
    );
    expect(line?.employeeCents).toBe(20129 + 5000);
  });
  it('returns null when no federal bracket row is seeded', () => {
    const set = buildTaxTableSet(2025, []);
    expect(
      computeFederalIncomeWithholding(
        { grossCents: 200000, ytdGrossCents: 0, employee: baseEmployee, frequency: 'biweekly' },
        set
      )
    ).toBeNull();
  });
});

describe('computeCaliforniaWithholding', () => {
  it('annualizes + de-annualizes CA Method B Table 5', () => {
    const set = fullTaxSet();
    // $2,000 biweekly → annual 5,200,000 cents.
    // CA single: [4,024,500–5,586,600]: 109,149 + 6.6% of (5,200,000 − 4,024,500)
    //   = 109,149 + 77,583 = 186,732 annual. /26 = 7,182.0 → 7,182 per period.
    const line = computeCaliforniaWithholding(
      { grossCents: 200000, ytdGrossCents: 0, employee: baseEmployee, frequency: 'biweekly' },
      set
    );
    expect(line?.kind).toBe('ca_pit');
    expect(line?.employeeCents).toBe(7182);
    expect(line?.employerCents).toBe(0);
  });
});

describe('computePaycheckTaxes', () => {
  it('computes the full federal + CA set for a typical biweekly W-2 check', () => {
    const set = fullTaxSet();
    const r = computePaycheckTaxes(
      { grossCents: 200000, ytdGrossCents: 0, employee: baseEmployee, frequency: 'biweekly' },
      set
    );
    const byKind = Object.fromEntries(r.lines.map((l) => [l.kind, l]));
    // SS 6.2% of 200,000 = 12,400 employee + 12,400 employer.
    expect(byKind.fica_ss.employeeCents).toBe(12400);
    expect(byKind.fica_ss.employerCents).toBe(12400);
    // Medicare 1.45% of 200,000 = 2,900 each side.
    expect(byKind.fica_medicare.employeeCents).toBe(2900);
    expect(byKind.fica_medicare.employerCents).toBe(2900);
    // Additional Medicare 0 (well under $200k YTD).
    expect(byKind.medicare_addl.employeeCents).toBe(0);
    // FUTA 0.6% of 200,000 = 1,200 employer-only.
    expect(byKind.futa.employerCents).toBe(1200);
    expect(byKind.futa.employeeCents).toBe(0);
    // CA UI 3.4% of 200,000 = 6,800 employer-only.
    expect(byKind.ca_ui.employerCents).toBe(6800);
    // CA ETT 0.1% of 200,000 = 200 employer-only.
    expect(byKind.ca_ett.employerCents).toBe(200);
    // CA SDI 1.2% of 200,000 = 2,400 employee-only.
    expect(byKind.ca_sdi.employeeCents).toBe(2400);
    expect(byKind.ca_sdi.employerCents).toBe(0);

    // Employee total = fed 20,129 + CA 7,182 + SS 12,400 + Medicare 2,900 + SDI 2,400 = 45,011.
    expect(r.employeeTaxesCents).toBe(20129 + 7182 + 12400 + 2900 + 2400);
    // Employer total = SS 12,400 + Medicare 2,900 + FUTA 1,200 + UI 6,800 + ETT 200 = 23,500.
    expect(r.employerTaxesCents).toBe(12400 + 2900 + 1200 + 6800 + 200);
    expect(r.missingTables).toEqual([]);
  });

  it('caps Social Security at the wage base across YTD', () => {
    const set = fullTaxSet();
    // YTD 17,600,000; base 17,610,000 → only 10,000 of a 200,000 check is SS-taxable.
    const r = computePaycheckTaxes(
      {
        grossCents: 200000,
        ytdGrossCents: 17600000,
        employee: baseEmployee,
        frequency: 'biweekly',
      },
      set
    );
    const ss = r.lines.find((l) => l.kind === 'fica_ss')!;
    expect(ss.taxableWageCents).toBe(10000);
    expect(ss.employeeCents).toBe(applyRateCents(10000, 0.062)); // 620
    // Medicare has no cap → full 200,000 taxable.
    const med = r.lines.find((l) => l.kind === 'fica_medicare')!;
    expect(med.taxableWageCents).toBe(200000);
  });

  it('withholds Additional Medicare on the slice over $200k YTD', () => {
    const set = fullTaxSet();
    // YTD 19,900,000; check 200,000 → 100,000 over the 20,000,000 threshold.
    const r = computePaycheckTaxes(
      {
        grossCents: 200000,
        ytdGrossCents: 19900000,
        employee: baseEmployee,
        frequency: 'biweekly',
      },
      set
    );
    const addl = r.lines.find((l) => l.kind === 'medicare_addl')!;
    expect(addl.taxableWageCents).toBe(100000);
    expect(addl.employeeCents).toBe(applyRateCents(100000, 0.009)); // 900
    expect(addl.employerCents).toBe(0);
  });

  it('returns NO taxes for a 1099 contractor (gross, no withholding)', () => {
    const set = fullTaxSet();
    const r = computePaycheckTaxes(
      {
        grossCents: 200000,
        ytdGrossCents: 0,
        employee: { ...baseEmployee, employmentType: '1099' },
        frequency: 'biweekly',
      },
      set
    );
    expect(r.lines).toEqual([]);
    expect(r.employeeTaxesCents).toBe(0);
    expect(r.employerTaxesCents).toBe(0);
  });

  it('surfaces missing tax tables instead of silently zeroing', () => {
    const set = buildTaxTableSet(2025, [
      flatRow('ss', 'fica_ss', 'federal', {
        rate: 0.062,
        employerRate: 0.062,
        wageBaseCents: 17610000,
        thresholdCents: null,
        employeePaid: true,
        employerPaid: true,
      }),
    ]);
    const r = computePaycheckTaxes(
      { grossCents: 200000, ytdGrossCents: 0, employee: baseEmployee, frequency: 'biweekly' },
      set
    );
    // Only SS computed; everything else is reported missing.
    expect(r.lines.map((l) => l.kind)).toEqual(['fica_ss']);
    expect(r.missingTables).toContain('fed_income_pit');
    expect(r.missingTables).toContain('ca_pit');
    expect(r.missingTables).toContain('ca_sdi');
  });
});

// ── whole-paycheck assembly: the cents identity ───────────────────────────────

describe('assemblePaycheck', () => {
  it('net = gross − employeeTaxes − otherDeductions (exact cents identity)', () => {
    const set = fullTaxSet();
    const p = assemblePaycheck(200000, 0, baseEmployee, 'biweekly', set, [
      { code: 'health', label: 'Health', amountCents: 5000, pretax: false },
    ]);
    expect(p.grossCents).toBe(200000);
    expect(p.otherDeductionsCents).toBe(5000);
    // employee taxes = 45,011 (from the prior test).
    expect(p.employeeTaxesCents).toBe(45011);
    expect(p.netCents).toBe(200000 - 45011 - 5000);
    // The identity the commit RPC asserts must hold EXACTLY.
    expect(p.netCents).toBe(p.grossCents - p.employeeTaxesCents - p.otherDeductionsCents);
  });

  it('a zero-gross check yields all-zero cents (no taxes)', () => {
    const set = fullTaxSet();
    const p = assemblePaycheck(0, 0, baseEmployee, 'biweekly', set);
    expect(p.grossCents).toBe(0);
    expect(p.employeeTaxesCents).toBe(0);
    expect(p.employerTaxesCents).toBe(0);
    expect(p.netCents).toBe(0);
  });

  it('warns (does not silently clamp) when withholding exceeds gross', () => {
    const set = fullTaxSet();
    // A tiny gross with a huge extra-withholding → negative net, surfaced as a warning.
    const p = assemblePaycheck(
      1000,
      0,
      { ...baseEmployee, fedExtraWithholdingCents: 500000 },
      'biweekly',
      set
    );
    expect(p.netCents).toBeLessThan(0);
    expect(p.warnings.some((w) => w.includes('negative'))).toBe(true);
  });

  it('surfaces a warning when tax tables are missing', () => {
    const set = buildTaxTableSet(2025, []);
    const p = assemblePaycheck(200000, 0, baseEmployee, 'biweekly', set);
    expect(p.warnings.some((w) => w.includes('Missing tax tables'))).toBe(true);
  });
});
