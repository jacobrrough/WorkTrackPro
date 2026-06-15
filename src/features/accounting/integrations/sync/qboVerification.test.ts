import { describe, it, expect } from 'vitest';
import {
  diffRows,
  flattenQboReportRows,
  normalizeLabel,
  stripNumberPrefix,
} from './qboVerification';

describe('flattenQboReportRows', () => {
  it('extracts leaf data rows from a nested QBO report tree', () => {
    const report = {
      Header: { ReportName: 'ProfitAndLoss' },
      Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] },
      Rows: {
        Row: [
          {
            type: 'Section',
            Header: { ColData: [{ value: 'Income' }] },
            Rows: {
              Row: [
                { type: 'Data', ColData: [{ value: 'Sales' }, { value: '125000.50' }] },
                { type: 'Data', ColData: [{ value: 'Service income' }, { value: '8000' }] },
              ],
            },
            Summary: { ColData: [{ value: 'Total Income' }, { value: '133000.50' }] },
          },
          { type: 'Data', ColData: [{ value: 'Other income' }, { value: '12.25' }] },
        ],
      },
    };
    expect(flattenQboReportRows(report)).toEqual([
      { label: 'Sales', amount: 125000.5 },
      { label: 'Service income', amount: 8000 },
      { label: 'Other income', amount: 12.25 },
    ]);
  });

  it('tolerates blank amounts, currency junk, and missing rows', () => {
    expect(flattenQboReportRows({})).toEqual([]);
    const rows = flattenQboReportRows({
      Rows: { Row: [{ type: 'Data', ColData: [{ value: 'X' }, { value: '1,234.56' }] }] },
    });
    expect(rows).toEqual([{ label: 'X', amount: 1234.56 }]);
  });
});

describe('label normalization', () => {
  it('strips QBO account-number prefixes for matching', () => {
    expect(stripNumberPrefix('1000 Checking')).toBe('checking');
    expect(stripNumberPrefix('Checking')).toBe('checking');
    expect(normalizeLabel('  Sales ')).toBe('sales');
  });
});

describe('diffRows', () => {
  it('ties when both sides match to the penny', () => {
    const s = diffRows(
      'P&L',
      [
        { label: '4000 Sales', amount: 100.5 },
        { label: 'Service income', amount: 50 },
      ],
      [
        { label: 'Sales', amount: 100.5 },
        { label: 'Service income', amount: 50 },
      ]
    );
    expect(s.tied).toBe(true);
    expect(s.mismatches).toEqual([]);
    expect(s.qboTotal).toBe(150.5);
    expect(s.ourTotal).toBe(150.5);
  });

  it('lists per-line deltas and one-sided rows', () => {
    const s = diffRows(
      'BS',
      [
        { label: 'Checking', amount: 1000 },
        { label: 'Savings', amount: 250 },
      ],
      [
        { label: 'Checking', amount: 990 },
        { label: 'Petty cash', amount: 10 },
      ]
    );
    expect(s.tied).toBe(false);
    expect(s.mismatches).toContainEqual(
      expect.objectContaining({ label: 'Checking', deltaCents: 1000 })
    );
    expect(s.mismatches).toContainEqual(
      expect.objectContaining({ label: 'Savings', qboAmount: 250, ourAmount: null })
    );
    expect(s.mismatches).toContainEqual(
      expect.objectContaining({ label: 'Petty cash', qboAmount: null, deltaCents: -1000 })
    );
  });

  it('never reports a false tie from floating-point drift', () => {
    const s = diffRows(
      'P&L',
      [{ label: 'Sales', amount: 0.1 + 0.2 }],
      [{ label: 'Sales', amount: 0.3 }]
    );
    expect(s.tied).toBe(true);
  });
});
