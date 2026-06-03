import { describe, it, expect } from 'vitest';
import {
  BankImportError,
  detectFormat,
  normalizeDate,
  ofxTag,
  parseAmount,
  parseBankFile,
  parseCsv,
  parseOfx,
  syntheticExternalId,
} from './bankImportParsers';

describe('parseAmount', () => {
  it('reads a plain decimal', () => {
    expect(parseAmount('42.50')).toBe(42.5);
  });
  it('strips currency symbols and thousands separators', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });
  it('reads a European comma-decimal with dot grouping', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1.000,00')).toBe(1000);
  });
  it('keeps US grouping intact (comma + 3 digits is not a decimal)', () => {
    expect(parseAmount('1,234')).toBe(1234);
  });
  it('treats parentheses as negative', () => {
    expect(parseAmount('(45.00)')).toBe(-45);
  });
  it('handles a trailing minus', () => {
    expect(parseAmount('45.00-')).toBe(-45);
  });
  it('handles a leading minus', () => {
    expect(parseAmount('-12.34')).toBe(-12.34);
  });
  it('returns null for non-numeric input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe('normalizeDate', () => {
  it('passes through ISO', () => {
    expect(normalizeDate('2026-06-01')).toBe('2026-06-01');
  });
  it('parses an OFX compact datetime with tz suffix', () => {
    expect(normalizeDate('20260601120000.000[-8:PST]')).toBe('2026-06-01');
  });
  it('parses bare OFX YYYYMMDD', () => {
    expect(normalizeDate('20260601')).toBe('2026-06-01');
  });
  it('parses US MM/DD/YYYY', () => {
    expect(normalizeDate('06/01/2026')).toBe('2026-06-01');
  });
  it('parses US M/D/YY and expands the year', () => {
    expect(normalizeDate('6/1/26')).toBe('2026-06-01');
  });
  it('parses YYYY/MM/DD', () => {
    expect(normalizeDate('2026/06/01')).toBe('2026-06-01');
  });
  it('rejects an impossible month', () => {
    expect(normalizeDate('13/01/2026')).toBeNull();
  });
  it('rejects impossible calendar days (day-vs-month)', () => {
    expect(normalizeDate('02/30/2026')).toBeNull();
    expect(normalizeDate('04/31/2026')).toBeNull();
    expect(normalizeDate('02/29/2026')).toBeNull(); // 2026 is not a leap year
  });
  it('accepts a valid leap day', () => {
    expect(normalizeDate('02/29/2024')).toBe('2024-02-29');
  });
  it('returns null for junk', () => {
    expect(normalizeDate('not-a-date')).toBeNull();
  });
});

describe('detectFormat', () => {
  it('detects OFX from an <OFX> root', () => {
    expect(detectFormat('<OFX><BANKMSGSRSV1>')).toBe('ofx');
  });
  it('detects OFX from the OFXHEADER preamble', () => {
    expect(detectFormat('OFXHEADER:100\nDATA:OFXSGML\n')).toBe('ofx');
  });
  it('detects OFX by .qfx extension even without obvious markers', () => {
    expect(detectFormat('something', 'export.qfx')).toBe('ofx');
  });
  it('defaults to csv', () => {
    expect(detectFormat('Date,Amount,Description\n2026-06-01,10,Test')).toBe('csv');
  });
});

describe('parseCsv', () => {
  it('parses a signed-amount CSV with synonyms and quoted fields', () => {
    const csv = [
      'Transaction Date,Amount,Description,Payee',
      '06/01/2026,-42.50,"ACME HARDWARE, STORE #5",Acme Hardware',
      '06/02/2026,1000.00,Payroll deposit,Employer Inc',
    ].join('\n');
    const res = parseCsv(csv);
    expect(res.format).toBe('csv');
    expect(res.transactions).toHaveLength(2);
    expect(res.transactions[0]).toMatchObject({
      txnDate: '2026-06-01',
      amount: -42.5,
      description: 'ACME HARDWARE, STORE #5',
      merchant: 'Acme Hardware',
    });
    expect(res.transactions[1].amount).toBe(1000);
  });

  it('handles a split Debit/Credit pair (debit => negative, credit => positive)', () => {
    const csv = [
      'Date,Description,Debit,Credit',
      '2026-06-01,Coffee,4.25,',
      '2026-06-03,Refund,,15.00',
    ].join('\n');
    const res = parseCsv(csv);
    expect(res.transactions[0].amount).toBe(-4.25);
    expect(res.transactions[1].amount).toBe(15);
  });

  it('honors an explicit sign in a split Debit/Credit pair (reversal / chargeback)', () => {
    // A negative debit is a reversal/return (money IN); a negative credit is a
    // chargeback (money OUT). The sign must be preserved, not forced by Math.abs.
    const csv = [
      'Date,Description,Debit,Credit',
      '2026-06-01,Return,-50.00,',
      '2026-06-02,Chargeback,,-30.00',
    ].join('\n');
    const res = parseCsv(csv);
    expect(res.transactions[0].amount).toBe(50);
    expect(res.transactions[1].amount).toBe(-30);
  });

  it('carries an explicit FITID through as externalId', () => {
    const csv = ['Date,Amount,Description,FITID', '2026-06-01,-1.00,Fee,XID-99'].join('\n');
    const res = parseCsv(csv);
    expect(res.transactions[0].externalId).toBe('XID-99');
  });

  it('supports semicolon and tab delimiters', () => {
    const semi = parseCsv('Date;Amount;Description\n2026-06-01;-5.00;Test');
    expect(semi.transactions[0].amount).toBe(-5);
    const tab = parseCsv('Date\tAmount\tDescription\n2026-06-01\t-5.00\tTest');
    expect(tab.transactions[0].amount).toBe(-5);
  });

  it('reads a semicolon-delimited European row (comma decimal, dot grouping)', () => {
    // Common EU export: semicolon delimiter so the comma can be the decimal separator.
    const csv = [
      'Date;Amount;Description',
      '2026-06-01;1.234,56;Salary',
      '2026-06-02;-1.000,00;Rent',
    ].join('\n');
    const res = parseCsv(csv);
    expect(res.transactions[0].amount).toBe(1234.56);
    expect(res.transactions[1].amount).toBe(-1000);
  });

  it('warns and skips a row with an unreadable date instead of failing the batch', () => {
    const csv = [
      'Date,Amount,Description',
      'garbage,-5.00,Bad row',
      '2026-06-01,-6.00,Good row',
    ].join('\n');
    const res = parseCsv(csv);
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].amount).toBe(-6);
    expect(res.warnings.length).toBe(1);
  });

  it('throws when no date column is present', () => {
    expect(() => parseCsv('Amount,Description\n-5,Test')).toThrow(BankImportError);
  });

  it('throws when neither amount nor debit/credit is present', () => {
    expect(() => parseCsv('Date,Description\n2026-06-01,Test')).toThrow(BankImportError);
  });

  it('throws when there are no data rows', () => {
    expect(() => parseCsv('Date,Amount,Description')).toThrow(BankImportError);
  });
});

describe('ofxTag', () => {
  it('reads a closed tag', () => {
    expect(ofxTag('<FITID>123</FITID>', 'FITID')).toBe('123');
  });
  it('reads an SGML-unclosed tag (value runs to the next tag)', () => {
    expect(ofxTag('<TRNAMT>-42.50\n<FITID>123', 'TRNAMT')).toBe('-42.50');
  });
  it('returns null for a missing tag', () => {
    expect(ofxTag('<NAME>x</NAME>', 'MEMO')).toBeNull();
  });
});

describe('parseOfx', () => {
  const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260601120000.000[-8:PST]
<TRNAMT>-42.50
<FITID>2026060101
<NAME>ACME HARDWARE
<MEMO>ACME HARDWARE STORE #5
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260602
<TRNAMT>1000.00
<FITID>2026060202
<NAME>EMPLOYER INC
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it('extracts signed amounts, dates, FITIDs and names from SGML OFX', () => {
    const res = parseOfx(OFX_SGML);
    expect(res.format).toBe('ofx');
    expect(res.transactions).toHaveLength(2);
    expect(res.transactions[0]).toMatchObject({
      txnDate: '2026-06-01',
      amount: -42.5,
      externalId: '2026060101',
      merchant: 'ACME HARDWARE',
      description: 'ACME HARDWARE STORE #5',
    });
    expect(res.transactions[1]).toMatchObject({
      txnDate: '2026-06-02',
      amount: 1000,
      externalId: '2026060202',
      merchant: 'EMPLOYER INC',
    });
  });

  it('parses well-formed (XML/2.x) OFX with closing tags too', () => {
    const xml = `<OFX><STMTTRN><DTPOSTED>20260601</DTPOSTED><TRNAMT>-7.00</TRNAMT><FITID>A1</FITID><NAME>Fee</NAME></STMTTRN></OFX>`;
    const res = parseOfx(xml);
    expect(res.transactions[0]).toMatchObject({
      amount: -7,
      externalId: 'A1',
      txnDate: '2026-06-01',
    });
  });

  it('throws when there are no STMTTRN blocks', () => {
    expect(() => parseOfx('<OFX></OFX>')).toThrow(BankImportError);
  });
});

describe('parseBankFile dispatch', () => {
  it('routes OFX text to the OFX parser', () => {
    const res = parseBankFile(
      '<OFX><STMTTRN><DTPOSTED>20260601</DTPOSTED><TRNAMT>-1.00</TRNAMT></STMTTRN></OFX>'
    );
    expect(res.format).toBe('ofx');
    expect(res.transactions[0].amount).toBe(-1);
  });
  it('routes CSV text to the CSV parser', () => {
    const res = parseBankFile('Date,Amount,Description\n2026-06-01,-1.00,Test');
    expect(res.format).toBe('csv');
    expect(res.transactions[0].amount).toBe(-1);
  });
});

describe('syntheticExternalId', () => {
  const txn = { txnDate: '2026-06-01', amount: -42.5, description: 'ACME', merchant: 'Acme' };

  it('is deterministic for the same row + ordinal (so re-import dedups)', () => {
    expect(syntheticExternalId(txn, 0)).toBe(syntheticExternalId(txn, 0));
  });
  it('is prefixed gen: to distinguish from bank-supplied FITIDs', () => {
    expect(syntheticExternalId(txn, 0).startsWith('gen:')).toBe(true);
  });
  it('differs when the amount differs', () => {
    expect(syntheticExternalId(txn, 0)).not.toBe(syntheticExternalId({ ...txn, amount: -43.5 }, 0));
  });
  it('differs by ordinal so identical same-day rows stay distinct', () => {
    expect(syntheticExternalId(txn, 0)).not.toBe(syntheticExternalId(txn, 1));
  });
  it('ignores description whitespace/case differences', () => {
    expect(syntheticExternalId(txn, 0)).toBe(
      syntheticExternalId({ ...txn, description: '  acme ' }, 0)
    );
  });

  // The import() salt is a per-natural-key occurrence ordinal, not the absolute row
  // position, so a re-exported statement that prepends/reorders rows must yield the
  // SAME set of synthetic ids. This mirrors the ordinal assignment in
  // bankTransactions.import() exactly.
  const assignSyntheticIds = (
    rows: { txnDate: string; amount: number; description: string | null; merchant: string | null }[]
  ): string[] => {
    const occurrences = new Map<string, number>();
    return rows.map((t) => {
      const naturalKey = [
        t.txnDate,
        t.amount.toFixed(2),
        (t.description ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
        (t.merchant ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
      ].join('|');
      const ordinal = occurrences.get(naturalKey) ?? 0;
      occurrences.set(naturalKey, ordinal + 1);
      return syntheticExternalId(t, ordinal);
    });
  };

  it('produces the same set of ids for the same rows in a different order', () => {
    const a = { txnDate: '2026-06-01', amount: -42.5, description: 'ACME', merchant: 'Acme' };
    const b = { txnDate: '2026-06-02', amount: 1000, description: 'Payroll', merchant: 'Employer' };
    const c = { txnDate: '2026-06-03', amount: -7, description: 'Fee', merchant: null };
    const original = assignSyntheticIds([a, b, c]);
    // Re-export prepends a new row and reorders the rest.
    const prepended = { txnDate: '2026-05-31', amount: -3, description: 'New', merchant: null };
    const reordered = assignSyntheticIds([prepended, c, a, b]);
    // Every stable row keeps its id regardless of position: the original set is a
    // subset of the re-exported set (which only adds the prepended row's id).
    const reorderedSet = new Set(reordered);
    expect(original.every((id) => reorderedSet.has(id))).toBe(true);
    // And the ids for the rows present in both batches match exactly.
    expect([...original].sort()).toEqual([reordered[2], reordered[3], reordered[1]].sort());
  });

  it('disambiguates two genuinely identical same-day rows by occurrence ordinal', () => {
    const dup = { txnDate: '2026-06-01', amount: -9.99, description: 'Coffee', merchant: 'Cafe' };
    const ids = assignSyntheticIds([dup, dup]);
    expect(ids[0]).not.toBe(ids[1]);
    // Re-importing the same two rows reproduces the same two ids (order preserved).
    expect(assignSyntheticIds([dup, dup])).toEqual(ids);
  });
});
