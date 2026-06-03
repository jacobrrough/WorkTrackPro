import { describe, it, expect } from 'vitest';
import { reportToCsv, type ReportDocument } from './reportExport';

// ── CSV formula-injection hardening ──────────────────────────────────────────
//
// csvCell must neutralize spreadsheet formula injection (Excel/Sheets execute a
// cell whose text starts with = + @ tab or CR, or a non-numeric leading '-') by
// apostrophe-prefixing the dangerous value — WITHOUT corrupting legitimate
// negative-number cells like "-500.00".

/** Build a one-row report whose label cell + amount drive the CSV under test. */
function docWith(label: string, amount?: number): ReportDocument {
  return {
    title: 'Report',
    subtitle: 'Period',
    filenameBase: 'report',
    sections: [
      {
        title: 'Section',
        columns: ['Name'],
        rows: [{ cells: [label], amount }],
      },
    ],
  };
}

describe('reportToCsv formula-injection hardening', () => {
  it('apostrophe-prefixes a =HYPERLINK formula in a label cell', () => {
    const csv = reportToCsv(docWith('=HYPERLINK("x","y")'));
    expect(csv).toContain('"\'=HYPERLINK(""x"",""y"")"');
    // The raw, un-neutralized formula must not appear at a cell boundary.
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it.each([
    ['+1+1', '+'],
    ['@SUM(A1)', '@'],
    ['-1+1', '-'], // leading '-' not followed by a digit → dangerous
  ])('apostrophe-prefixes a cell starting with %s', (label) => {
    const csv = reportToCsv(docWith(label));
    expect(csv).toContain(`"'${label}"`);
  });

  it('neutralizes leading tab / carriage-return cells', () => {
    expect(reportToCsv(docWith('\t=1'))).toContain('"\'\t=1"');
    expect(reportToCsv(docWith('\r=1'))).toContain('"\'\r=1"');
  });

  it('leaves a negative amount like -500.00 numeric (no apostrophe)', () => {
    const csv = reportToCsv(docWith('Loss', -500));
    expect(csv).toContain('"-500.00"');
    expect(csv).not.toContain('"\'-500.00"');
  });

  it('leaves a negative number in a label cell numeric', () => {
    const csv = reportToCsv(docWith('-42.5'));
    expect(csv).toContain('"-42.5"');
    expect(csv).not.toContain('"\'-42.5"');
  });

  it('leaves ordinary text and positive amounts untouched', () => {
    const csv = reportToCsv(docWith('Acme Co', 500));
    expect(csv).toContain('"Acme Co"');
    expect(csv).toContain('"500.00"');
    expect(csv).not.toContain("'");
  });
});
