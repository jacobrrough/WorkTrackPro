import { describe, it, expect } from 'vitest';
import {
  buildSalesByCustomer,
  buildSalesByItem,
  buildPurchasesByVendor,
  UNCATEGORIZED_KEY,
  UNCATEGORIZED_LABEL,
  type ManagementLineInput,
} from './managementReportMath';

const line = (key: string, name: string, amount: number): ManagementLineInput => ({
  key,
  name,
  amount,
});

describe('buildSalesByCustomer', () => {
  it('groups by key, sums in cents, ranks desc, and totals to the penny', () => {
    const report = buildSalesByCustomer([
      line('c1', 'Acme', 100.1),
      line('c1', 'Acme', 200.2),
      line('c2', 'Globex', 50.05),
    ]);
    expect(report.rows.map((r) => r.customerId)).toEqual(['c1', 'c2']);
    expect(report.rows[0]).toMatchObject({ customerName: 'Acme', invoiceCount: 2, amount: 300.3 });
    expect(report.rows[1]).toMatchObject({
      customerName: 'Globex',
      invoiceCount: 1,
      amount: 50.05,
    });
    expect(report.total).toBeCloseTo(350.35, 2);
  });

  it('breaks amount ties by name', () => {
    const report = buildSalesByCustomer([line('z', 'Zeta', 100), line('a', 'Alpha', 100)]);
    expect(report.rows.map((r) => r.customerName)).toEqual(['Alpha', 'Zeta']);
  });

  it('maps the uncategorized sentinel key to a null id + label', () => {
    const report = buildSalesByCustomer([line(UNCATEGORIZED_KEY, '', 75)]);
    expect(report.rows[0].customerId).toBeNull();
    expect(report.rows[0].customerName).toBe(UNCATEGORIZED_LABEL);
  });
});

describe('buildSalesByItem', () => {
  it('rolls lines up per item with a line count and grand total', () => {
    const report = buildSalesByItem([
      line('i1', 'Widget', 10),
      line('i2', 'Gadget', 30),
      line('i1', 'Widget', 5),
    ]);
    expect(report.rows.map((r) => r.itemId)).toEqual(['i2', 'i1']);
    expect(report.rows.find((r) => r.itemId === 'i1')).toMatchObject({
      itemName: 'Widget',
      lineCount: 2,
      amount: 15,
    });
    expect(report.total).toBe(45);
  });
});

describe('buildPurchasesByVendor', () => {
  it('rolls lines up per vendor with a bill count and grand total', () => {
    const report = buildPurchasesByVendor([
      line('v1', 'Supplier A', 500),
      line('v1', 'Supplier A', 250),
      line('v2', 'Supplier B', 1000),
    ]);
    expect(report.rows.map((r) => r.vendorId)).toEqual(['v2', 'v1']);
    expect(report.rows.find((r) => r.vendorId === 'v1')).toMatchObject({
      vendorName: 'Supplier A',
      billCount: 2,
      amount: 750,
    });
    expect(report.total).toBe(1750);
  });

  it('carries the date range through onto the report', () => {
    const range = { from: '2026-01-01', to: '2026-03-31' };
    const report = buildPurchasesByVendor([line('v1', 'A', 1)], range);
    expect(report.range).toEqual(range);
  });

  it('returns an all-zero report for no lines', () => {
    const report = buildPurchasesByVendor([]);
    expect(report.rows).toEqual([]);
    expect(report.total).toBe(0);
  });
});
