import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvMatrix, detectDelimiter } from './csvImport';

describe('detectDelimiter', () => {
  it('detects commas', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
  it('detects tabs', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });
  it('detects semicolons', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });
  it('ignores delimiters inside quotes on the header line', () => {
    expect(detectDelimiter('"a,b"\tc\td')).toBe('\t');
  });
  it('defaults to comma when there is nothing to split', () => {
    expect(detectDelimiter('single')).toBe(',');
  });
});

describe('parseCsv', () => {
  it('parses a simple comma file into header-keyed rows', () => {
    const { headers, rows } = parseCsv('Name,Type\nCash,Bank\nSales,Income');
    expect(headers).toEqual(['Name', 'Type']);
    expect(rows).toEqual([
      { Name: 'Cash', Type: 'Bank' },
      { Name: 'Sales', Type: 'Income' },
    ]);
  });

  it('handles quoted fields containing the delimiter', () => {
    const { rows } = parseCsv('Name,Type\n"Smith, John",Customer');
    expect(rows[0]).toEqual({ Name: 'Smith, John', Type: 'Customer' });
  });

  it('handles escaped double-quotes ("")', () => {
    const { rows } = parseCsv('Name\n"He said ""hi"""');
    expect(rows[0].Name).toBe('He said "hi"');
  });

  it('handles newlines inside quoted fields', () => {
    const { rows } = parseCsv('Name,Memo\nCash,"line1\nline2"');
    expect(rows).toHaveLength(1);
    expect(rows[0].Memo).toBe('line1\nline2');
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const { headers } = parseCsv('﻿Name,Type\nCash,Bank');
    expect(headers[0]).toBe('Name');
  });

  it('parses CRLF line endings', () => {
    const { rows } = parseCsv('Name,Type\r\nCash,Bank\r\n');
    expect(rows).toEqual([{ Name: 'Cash', Type: 'Bank' }]);
  });

  it('drops fully-empty rows', () => {
    const { rows } = parseCsv('Name,Type\nCash,Bank\n,\n\nSales,Income');
    expect(rows).toEqual([
      { Name: 'Cash', Type: 'Bank' },
      { Name: 'Sales', Type: 'Income' },
    ]);
  });

  it('pads short rows so every header key exists', () => {
    const { rows } = parseCsv('Name,Type,Description\nCash,Bank');
    expect(rows[0]).toEqual({ Name: 'Cash', Type: 'Bank', Description: '' });
  });

  it('parses a tab-delimited file', () => {
    const { headers, rows } = parseCsv('Name\tType\nCash\tBank');
    expect(headers).toEqual(['Name', 'Type']);
    expect(rows[0]).toEqual({ Name: 'Cash', Type: 'Bank' });
  });

  it('trims surrounding whitespace from headers and cells', () => {
    const { headers, rows } = parseCsv(' Name , Type \n  Cash ,  Bank ');
    expect(headers).toEqual(['Name', 'Type']);
    expect(rows[0]).toEqual({ Name: 'Cash', Type: 'Bank' });
  });

  it('returns empty result for blank input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('   \n  \n')).toEqual({ headers: [], rows: [] });
  });
});

describe('parseCsvMatrix', () => {
  it('flushes a final row with no trailing newline', () => {
    expect(parseCsvMatrix('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
