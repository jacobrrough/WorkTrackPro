import { describe, it, expect } from 'vitest';
import {
  build1099Worklist,
  FORM_1099_THRESHOLD_CENTS,
  type Form1099VendorInput,
} from './form1099Math';

/** Compact vendor-input factory (a per-vendor yearly rollup row from the read-model). */
function vendor(
  p: Partial<Form1099VendorInput> & Pick<Form1099VendorInput, 'vendorId'>
): Form1099VendorInput {
  return {
    vendorId: p.vendorId,
    vendorName: p.vendorName ?? `Vendor ${p.vendorId}`,
    legalName: p.legalName ?? null,
    hasTaxId: p.hasTaxId ?? false,
    exempt: p.exempt ?? false,
    totalPaid: p.totalPaid ?? 0,
    paymentCount: p.paymentCount ?? 1,
  };
}

describe('build1099Worklist', () => {
  it('includes vendors AT OR OVER the $600 threshold and excludes those below', () => {
    const report = build1099Worklist(
      [
        vendor({ vendorId: 'a', totalPaid: 600 }), // exactly at threshold → reportable
        vendor({ vendorId: 'b', totalPaid: 599.99 }), // below → excluded
        vendor({ vendorId: 'c', totalPaid: 1200 }), // over → reportable
      ],
      { year: 2026 }
    );

    expect(report.year).toBe(2026);
    expect(report.thresholdAmount).toBe(600);
    expect(report.rows.map((r) => r.vendorId)).toEqual(['c', 'a']); // ranked desc
    expect(report.reportableTotal).toBe(1800);
    expect(report.belowThresholdCount).toBe(1);
    expect(report.belowThresholdTotal).toBeCloseTo(599.99, 2);
  });

  it('ranks by amount desc, breaking ties by vendor name', () => {
    const report = build1099Worklist(
      [
        vendor({ vendorId: 'z', vendorName: 'Zeta', totalPaid: 1000 }),
        vendor({ vendorId: 'a', vendorName: 'Alpha', totalPaid: 1000 }),
        vendor({ vendorId: 'm', vendorName: 'Mu', totalPaid: 5000 }),
      ],
      { year: 2026 }
    );
    expect(report.rows.map((r) => r.vendorName)).toEqual(['Mu', 'Alpha', 'Zeta']);
  });

  it('sums in integer cents so the total ties to the penny', () => {
    const report = build1099Worklist(
      [vendor({ vendorId: 'a', totalPaid: 700.1 }), vendor({ vendorId: 'b', totalPaid: 700.2 })],
      { year: 2026 }
    );
    expect(report.reportableTotal).toBeCloseTo(1400.3, 2);
  });

  it('flags wComplete only when BOTH a legal name and a tax id are present', () => {
    const report = build1099Worklist(
      [
        vendor({ vendorId: 'full', totalPaid: 800, legalName: 'Acme LLC', hasTaxId: true }),
        vendor({ vendorId: 'noTin', totalPaid: 800, legalName: 'Bravo Co', hasTaxId: false }),
        vendor({ vendorId: 'noName', totalPaid: 800, legalName: null, hasTaxId: true }),
        vendor({ vendorId: 'blankName', totalPaid: 800, legalName: '   ', hasTaxId: true }),
      ],
      { year: 2026 }
    );
    const byId = Object.fromEntries(report.rows.map((r) => [r.vendorId, r]));
    expect(byId.full.wComplete).toBe(true);
    expect(byId.full.hasTaxId).toBe(true);
    expect(byId.noTin.wComplete).toBe(false);
    expect(byId.noTin.hasTaxId).toBe(false);
    expect(byId.noName.wComplete).toBe(false);
    expect(byId.blankName.wComplete).toBe(false); // whitespace-only legal name is not "present"
    expect(byId.blankName.legalName).toBeNull();
    expect(report.incompleteCount).toBe(3);
  });

  it('exposes only a hasTaxId flag — the raw TIN never enters this layer', () => {
    const report = build1099Worklist([vendor({ vendorId: 'a', totalPaid: 800, hasTaxId: true })], {
      year: 2026,
    });
    const row = report.rows[0] as unknown as Record<string, unknown>;
    expect(row.hasTaxId).toBe(true);
    expect('taxId' in row).toBe(false);
  });

  it('carries the exempt flag through to reportable rows', () => {
    const report = build1099Worklist([vendor({ vendorId: 'a', totalPaid: 900, exempt: true })], {
      year: 2026,
    });
    expect(report.rows[0].exempt).toBe(true);
  });

  it('respects a custom threshold', () => {
    const report = build1099Worklist(
      [vendor({ vendorId: 'a', totalPaid: 600 }), vendor({ vendorId: 'b', totalPaid: 1500 })],
      { year: 2026, thresholdCents: 100000 } // $1,000
    );
    expect(report.rows.map((r) => r.vendorId)).toEqual(['b']);
    expect(report.belowThresholdCount).toBe(1);
    expect(report.thresholdAmount).toBe(1000);
  });

  it('handles an empty year (no payments) as a clean all-zero report', () => {
    const report = build1099Worklist([], { year: 2025 });
    expect(report.rows).toEqual([]);
    expect(report.reportableTotal).toBe(0);
    expect(report.belowThresholdCount).toBe(0);
    expect(report.incompleteCount).toBe(0);
  });

  it('exposes the documented $600 threshold constant', () => {
    expect(FORM_1099_THRESHOLD_CENTS).toBe(60000);
  });
});
