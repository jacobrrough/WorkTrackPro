import { describe, it, expect } from 'vitest';
import {
  apportionCents,
  buildSalesTaxLiability,
  lineCollectedCents,
  type InvoiceTaxInput,
  type LiabilityLineInput,
  type SalesTaxLiabilityInput,
} from './salesTaxMath';
import type { TaxAgency } from '../types';
import { UNATTRIBUTED_AGENCY_ID } from '../types';

/** Compact agency factory. */
function agency(p: Partial<TaxAgency> & Pick<TaxAgency, 'id' | 'name' | 'rate'>): TaxAgency {
  return {
    id: p.id,
    name: p.name,
    rate: p.rate,
    liabilityAccountId: p.liabilityAccountId ?? '2200',
    filingFrequency: p.filingFrequency ?? 'quarterly',
    createdAt: p.createdAt ?? '2026-01-01',
  };
}

/** Compact liability-line factory (a posted 2200 credit). */
function credit(sourceId: string | null, amount: number, sourceType = 'invoice'): LiabilityLineInput {
  return { journalEntryId: `je-${sourceId ?? 'x'}`, sourceType, sourceId, debit: 0, credit: amount };
}

function baseInput(over: Partial<SalesTaxLiabilityInput>): SalesTaxLiabilityInput {
  return {
    range: { from: '2026-01-01', to: '2026-03-31' },
    liabilityAccountId: 'acct-2200',
    liabilityAccountNumber: '2200',
    liabilityLines: [],
    invoices: [],
    agencies: [],
    ...over,
  };
}

describe('lineCollectedCents', () => {
  it('is credit minus debit in cents', () => {
    expect(lineCollectedCents({ debit: 0, credit: 95 })).toBe(9500);
    expect(lineCollectedCents({ debit: 5.25, credit: 0 })).toBe(-525);
    expect(lineCollectedCents({ debit: 1.1, credit: 3.35 })).toBe(225);
  });
});

describe('apportionCents', () => {
  it('returns the whole for a single weight', () => {
    expect(apportionCents(9500, [725])).toEqual([9500]);
  });

  it('splits by weight and re-sums to the exact total (no rounding leak)', () => {
    // 9.5% invoice on $1000 → $95.00 collected, split 7.25 : 2.25.
    const shares = apportionCents(9500, [7250, 2250]);
    expect(shares.reduce((s, c) => s + c, 0)).toBe(9500);
    // Proportional: 9500 * 7250/9500 = 7250 ; 9500 * 2250/9500 = 2250.
    expect(shares).toEqual([7250, 2250]);
  });

  it('hands leftover cents to the largest fractional parts so parts re-sum exactly', () => {
    // 100 cents across three equal weights: 34 / 33 / 33.
    const shares = apportionCents(100, [1, 1, 1]);
    expect(shares.reduce((s, c) => s + c, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
  });

  it('apportions a negative total (refund / net debit) symmetrically', () => {
    const shares = apportionCents(-100, [1, 1, 1]);
    expect(shares.reduce((s, c) => s + c, 0)).toBe(-100);
    expect(shares).toEqual([-34, -33, -33]);
  });

  it('spreads evenly when all weights are zero', () => {
    const shares = apportionCents(10, [0, 0]);
    expect(shares.reduce((s, c) => s + c, 0)).toBe(10);
    expect(shares).toEqual([5, 5]);
  });

  it('returns [] for no weights', () => {
    expect(apportionCents(500, [])).toEqual([]);
  });
});

describe('buildSalesTaxLiability — single agency tie-back', () => {
  it('ties collected tax to the 2200 credit and splits taxable/non-taxable', () => {
    const cdtfa = agency({ id: 'cdtfa', name: 'CDTFA', rate: 0.095 });
    const inv: InvoiceTaxInput = {
      invoiceId: 'inv1',
      agencyIds: ['cdtfa'],
      taxableSales: 1000,
      nonTaxableSales: 200,
    };
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [credit('inv1', 95)],
        invoices: [inv],
        agencies: [cdtfa],
      })
    );

    expect(report.taxCollected).toBe(95);
    expect(report.taxableSales).toBe(1000);
    expect(report.nonTaxableSales).toBe(200);
    expect(report.grossSales).toBe(1200);
    expect(report.unattributedTax).toBe(0);
    expect(report.reconciled).toBe(true);
    expect(report.reconciliationDifference).toBe(0);

    expect(report.agencies).toHaveLength(1);
    expect(report.agencies[0]).toMatchObject({
      agencyId: 'cdtfa',
      agencyName: 'CDTFA',
      taxCollected: 95,
      taxableSales: 1000,
      nonTaxableSales: 200,
    });
  });
});

describe('buildSalesTaxLiability — multi-agency pro-rata', () => {
  it('splits one invoice’s collected tax across state + district by rate and re-sums exactly', () => {
    const state = agency({ id: 'state', name: 'CA State', rate: 0.0725 });
    const district = agency({ id: 'district', name: 'LA District', rate: 0.0225 });
    const inv: InvoiceTaxInput = {
      invoiceId: 'inv1',
      agencyIds: ['state', 'district'],
      taxableSales: 1000,
      nonTaxableSales: 0,
    };
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [credit('inv1', 95)],
        invoices: [inv],
        agencies: [state, district],
      })
    );

    expect(report.taxCollected).toBe(95);
    expect(report.reconciled).toBe(true);

    const byId = Object.fromEntries(report.agencies.map((a) => [a.agencyId, a]));
    expect(byId.state.taxCollected).toBe(72.5); // 9500 * 7250/9500
    expect(byId.district.taxCollected).toBe(22.5); // 9500 * 2250/9500
    // The split re-sums to the whole.
    expect(byId.state.taxCollected + byId.district.taxCollected).toBe(95);

    // Taxable base attributed in full to EACH agency (not additive across agencies).
    expect(byId.state.taxableSales).toBe(1000);
    expect(byId.district.taxableSales).toBe(1000);
    // …but the headline counts the invoice once.
    expect(report.taxableSales).toBe(1000);
  });

  it('keeps the cent that would round away (largest-remainder) so it ties', () => {
    // $33.33 collected on a 3-way equal split would naively give 11.11×3 = 33.33,
    // but an odd total like $0.01 must still tie.
    const a1 = agency({ id: 'a1', name: 'A1', rate: 0.01 });
    const a2 = agency({ id: 'a2', name: 'A2', rate: 0.01 });
    const a3 = agency({ id: 'a3', name: 'A3', rate: 0.01 });
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [credit('inv1', 0.01)],
        invoices: [{ invoiceId: 'inv1', agencyIds: ['a1', 'a2', 'a3'], taxableSales: 1, nonTaxableSales: 0 }],
        agencies: [a1, a2, a3],
      })
    );
    const sum = report.agencies.reduce((s, a) => s + a.taxCollected, 0);
    expect(sum).toBe(0.01);
    expect(report.reconciled).toBe(true);
  });
});

describe('buildSalesTaxLiability — unattributed / review bucket (stop-condition)', () => {
  it('routes a manual-JE 2200 credit into the unattributed bucket, never guessing', () => {
    const cdtfa = agency({ id: 'cdtfa', name: 'CDTFA', rate: 0.095 });
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [
          credit('inv1', 95), // tied
          credit(null, 10, 'manual'), // manual JE → unattributed
        ],
        invoices: [{ invoiceId: 'inv1', agencyIds: ['cdtfa'], taxableSales: 1000, nonTaxableSales: 0 }],
        agencies: [cdtfa],
      })
    );

    expect(report.taxCollected).toBe(105);
    expect(report.unattributedTax).toBe(10);
    const bucket = report.agencies.find((a) => a.agencyId === UNATTRIBUTED_AGENCY_ID);
    expect(bucket?.isUnattributed).toBe(true);
    expect(bucket?.taxCollected).toBe(10);
    // Total still reconciles (attributed 95 + bucket 10 = 105).
    expect(report.reconciled).toBe(true);
    expect(report.reconciliationDifference).toBe(0);
  });

  it('treats a 2200 credit whose source invoice is out of range as unattributed', () => {
    const cdtfa = agency({ id: 'cdtfa', name: 'CDTFA', rate: 0.095 });
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [credit('inv-missing', 12.34)],
        invoices: [], // the source invoice is not in the report's invoice set
        agencies: [cdtfa],
      })
    );
    expect(report.taxCollected).toBe(12.34);
    expect(report.unattributedTax).toBe(12.34);
    expect(report.agencies).toHaveLength(1);
    expect(report.agencies[0].isUnattributed).toBe(true);
    expect(report.reconciled).toBe(true);
  });

  it('treats a taxed invoice with NO resolvable agency as unattributed', () => {
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [credit('inv1', 7.25)],
        invoices: [{ invoiceId: 'inv1', agencyIds: [], taxableSales: 100, nonTaxableSales: 0 }],
        agencies: [], // no agency master at all
      })
    );
    expect(report.unattributedTax).toBe(7.25);
    expect(report.agencies[0].isUnattributed).toBe(true);
    // The invoice's sales still count in the headline (it was a real taxed sale).
    expect(report.taxableSales).toBe(100);
    expect(report.reconciled).toBe(true);
  });

  it('absorbs a net-debit (refund) line into the bucket and still ties', () => {
    const cdtfa = agency({ id: 'cdtfa', name: 'CDTFA', rate: 0.095 });
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [
          credit('inv1', 95),
          { journalEntryId: 'je-adj', sourceType: 'adjustment', sourceId: null, debit: 5, credit: 0 },
        ],
        invoices: [{ invoiceId: 'inv1', agencyIds: ['cdtfa'], taxableSales: 1000, nonTaxableSales: 0 }],
        agencies: [cdtfa],
      })
    );
    expect(report.taxCollected).toBe(90); // 95 collected − 5 debit
    expect(report.unattributedTax).toBe(-5);
    expect(report.reconciled).toBe(true);
  });
});

describe('buildSalesTaxLiability — aggregation across invoices', () => {
  it('sums collected + sales across many invoices and orders agencies by collected desc', () => {
    const cdtfa = agency({ id: 'cdtfa', name: 'CDTFA', rate: 0.0725 });
    const other = agency({ id: 'other', name: 'Other Agency', rate: 0.05 });
    const report = buildSalesTaxLiability(
      baseInput({
        liabilityLines: [credit('inv1', 72.5), credit('inv2', 10), credit('inv2', 5)],
        invoices: [
          { invoiceId: 'inv1', agencyIds: ['cdtfa'], taxableSales: 1000, nonTaxableSales: 50 },
          { invoiceId: 'inv2', agencyIds: ['other'], taxableSales: 300, nonTaxableSales: 0 },
        ],
        agencies: [cdtfa, other],
      })
    );

    expect(report.taxCollected).toBe(87.5);
    expect(report.taxableSales).toBe(1300);
    expect(report.nonTaxableSales).toBe(50);
    expect(report.grossSales).toBe(1350);
    // CDTFA (72.50) before Other (15.00).
    expect(report.agencies.map((a) => a.agencyId)).toEqual(['cdtfa', 'other']);
    expect(report.agencies[1].taxCollected).toBe(15);
    expect(report.reconciled).toBe(true);
  });

  it('returns an all-zero report for an empty period', () => {
    const report = buildSalesTaxLiability(baseInput({}));
    expect(report.taxCollected).toBe(0);
    expect(report.taxableSales).toBe(0);
    expect(report.agencies).toEqual([]);
    expect(report.reconciled).toBe(true);
  });
});
