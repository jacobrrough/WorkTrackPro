import { describe, it, expect } from 'vitest';
import { cellsToTable, formatCell, isXlsxFile } from './spreadsheetImport';

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
