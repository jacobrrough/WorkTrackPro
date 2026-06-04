import { describe, it, expect } from 'vitest';
import { cellsToTable, findHeaderRow, formatCell, isXlsxFile } from './spreadsheetImport';

describe('formatCell', () => {
  it('trims strings', () => {
    expect(formatCell('  hi  ')).toBe('hi');
  });
  it('stringifies finite numbers, blanks non-finite', () => {
    expect(formatCell(1234.56)).toBe('1234.56');
    expect(formatCell(0)).toBe('0');
    expect(formatCell(NaN)).toBe('');
    expect(formatCell(Infinity)).toBe('');
  });
  it('maps booleans', () => {
    expect(formatCell(true)).toBe('true');
    expect(formatCell(false)).toBe('false');
  });
  it('blanks null/undefined', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });
  it('formats an Excel date cell as yyyy-mm-dd (UTC, no drift)', () => {
    expect(formatCell(new Date(Date.UTC(2023, 0, 15)))).toBe('2023-01-15');
    expect(formatCell(new Date(Date.UTC(2024, 11, 31)))).toBe('2024-12-31');
  });
});

describe('cellsToTable', () => {
  it('builds header-keyed rows from a cell matrix', () => {
    const { headers, rows } = cellsToTable([
      ['Name', 'Type'],
      ['Cash', 'Bank'],
      ['Sales', 'Income'],
    ]);
    expect(headers).toEqual(['Name', 'Type']);
    expect(rows).toEqual([
      { Name: 'Cash', Type: 'Bank' },
      { Name: 'Sales', Type: 'Income' },
    ]);
  });

  it('coerces numbers, dates, booleans, and nulls to the string pipeline', () => {
    const { rows } = cellsToTable([
      ['Date', 'Account', 'Debit', '1099'],
      [new Date(Date.UTC(2023, 0, 15)), 'Checking', 1234.5, true],
      [null, 'Empty', null, false],
    ]);
    expect(rows[0]).toEqual({
      Date: '2023-01-15',
      Account: 'Checking',
      Debit: '1234.5',
      '1099': 'true',
    });
    expect(rows[1]).toEqual({ Date: '', Account: 'Empty', Debit: '', '1099': 'false' });
  });

  it('drops fully-empty rows and pads short rows', () => {
    const { rows } = cellsToTable([
      ['Name', 'Type', 'Memo'],
      ['Cash', 'Bank'],
      [null, null, null],
      ['', '', ''],
      ['Sales', 'Income', 'note'],
    ]);
    expect(rows).toEqual([
      { Name: 'Cash', Type: 'Bank', Memo: '' },
      { Name: 'Sales', Type: 'Income', Memo: 'note' },
    ]);
  });

  it('trims header whitespace', () => {
    const { headers } = cellsToTable([[' Name ', ' Type ']]);
    expect(headers).toEqual(['Name', 'Type']);
  });

  it('returns empty for an empty matrix', () => {
    expect(cellsToTable([])).toEqual({ headers: [], rows: [] });
    expect(
      cellsToTable([
        [null, ''],
        ['', null],
      ])
    ).toEqual({ headers: [], rows: [] });
  });
});

describe('findHeaderRow', () => {
  it('finds the header below a QuickBooks report preamble', () => {
    const rows = [
      ['Your Company LLC'],
      ['Journal'],
      ['January 1 - December 31, 2023'],
      ['Date', 'Transaction Type', 'Num', 'Name', 'Account', 'Debit', 'Credit'],
      ['01/15/2023', 'Invoice', '1001', 'Acme', 'Accounts Receivable', '100.00', ''],
    ];
    expect(findHeaderRow(rows)).toBe(3);
  });

  it('returns 0 when the header is the first row', () => {
    expect(
      findHeaderRow([
        ['Date', 'Account', 'Debit', 'Credit'],
        ['x', 'y', '1', ''],
      ])
    ).toBe(0);
  });

  it('falls back to 0 when nothing looks like a header', () => {
    expect(
      findHeaderRow([
        ['foo', 'bar'],
        ['1', '2'],
      ])
    ).toBe(0);
  });

  it('is not fooled by a single-token preamble row', () => {
    // "Your Company LLC" matches only "company"; not enough to be the header.
    const rows = [['Your Company LLC'], ['Name', 'Email', 'Phone']];
    expect(findHeaderRow(rows)).toBe(1);
  });
});

describe('cellsToTable with a report preamble', () => {
  it('skips title rows and parses the real transactions', () => {
    const { headers, rows } = cellsToTable([
      ['Your Company LLC'],
      ['Journal'],
      ['January 1 - December 31, 2023'],
      [],
      ['Date', 'Transaction Type', 'Account', 'Debit', 'Credit'],
      ['01/15/2023', 'Invoice', 'Accounts Receivable', 100, null],
      [null, null, 'Sales Income', null, 100],
    ]);
    expect(headers).toEqual(['Date', 'Transaction Type', 'Account', 'Debit', 'Credit']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Date: '01/15/2023',
      Account: 'Accounts Receivable',
      Debit: '100',
    });
    expect(rows[1]).toMatchObject({ Account: 'Sales Income', Credit: '100' });
  });
});

describe('isXlsxFile', () => {
  const f = (name: string, type = '') => ({ name, type }) as File;
  it('detects .xlsx by extension (case-insensitive)', () => {
    expect(isXlsxFile(f('Journal.xlsx'))).toBe(true);
    expect(isXlsxFile(f('JOURNAL.XLSX'))).toBe(true);
  });
  it('detects by mime type', () => {
    expect(
      isXlsxFile(f('export', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    ).toBe(true);
  });
  it('is false for csv and legacy xls', () => {
    expect(isXlsxFile(f('accounts.csv', 'text/csv'))).toBe(false);
    expect(isXlsxFile(f('old.xls'))).toBe(false);
  });
});
