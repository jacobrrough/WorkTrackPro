import { describe, it, expect } from 'vitest';
import type { Customer, Vendor } from '../types';
import {
  autoDetectCustomerColumns,
  autoDetectVendorColumns,
  buildCustomerRows,
  buildVendorRows,
  parseYesNo,
  toNewCustomerInput,
  toNewVendorInput,
  findDuplicateParty,
} from './qboPartyMapping';

describe('autoDetectCustomerColumns', () => {
  it('maps a standard QBO customer export', () => {
    const map = autoDetectCustomerColumns(['Customer', 'Company', 'Email', 'Phone', 'Terms']);
    expect(map).toMatchObject({
      displayName: 'Customer',
      companyName: 'Company',
      email: 'Email',
      phone: 'Phone',
      terms: 'Terms',
    });
  });

  it('falls back to "Full name" / "Name" for the display name', () => {
    expect(autoDetectCustomerColumns(['Full name', 'Email address']).displayName).toBe('Full name');
    expect(autoDetectCustomerColumns(['Name']).displayName).toBe('Name');
  });
});

describe('autoDetectVendorColumns', () => {
  it('maps a standard QBO vendor export incl. 1099 + tax id', () => {
    const map = autoDetectVendorColumns([
      'Vendor',
      'Company',
      'Email',
      'Phone',
      'Track payments for 1099',
      'Business ID No.',
    ]);
    expect(map).toMatchObject({
      displayName: 'Vendor',
      companyName: 'Company',
      email: 'Email',
      phone: 'Phone',
      is1099: 'Track payments for 1099',
      taxId: 'Business ID No.',
    });
  });
});

describe('parseYesNo', () => {
  it.each(['Yes', 'Y', 'true', '1', 'X', '1099'])('treats "%s" as true', (v) => {
    expect(parseYesNo(v)).toBe(true);
  });
  it.each(['No', 'N', '', 'false', '0'])('treats "%s" as false', (v) => {
    expect(parseYesNo(v)).toBe(false);
  });
});

describe('buildCustomerRows', () => {
  const map = { displayName: 'Customer', companyName: 'Company', email: 'Email' };

  it('builds a clean customer row', () => {
    const [row] = buildCustomerRows(
      [{ Customer: 'Acme Co', Company: 'Acme', Email: 'ap@acme.com' }],
      map
    );
    expect(row).toMatchObject({
      rowNumber: 2,
      displayName: 'Acme Co',
      companyName: 'Acme',
      email: 'ap@acme.com',
      problem: null,
    });
  });

  it('falls back to company name when display name is blank', () => {
    const [row] = buildCustomerRows([{ Customer: '', Company: 'Acme', Email: '' }], map);
    expect(row.displayName).toBe('Acme');
    expect(row.problem).toBeNull();
  });

  it('flags a row with neither name nor company', () => {
    const [row] = buildCustomerRows([{ Customer: '', Company: '', Email: 'x@y.com' }], map);
    expect(row.problem).toBe('Missing customer name');
  });
});

describe('buildVendorRows', () => {
  const map = { displayName: 'Vendor', is1099: '1099', taxId: 'Tax ID' };

  it('parses the 1099 flag and tax id', () => {
    const [row] = buildVendorRows(
      [{ Vendor: 'Bolt Supply', '1099': 'Yes', 'Tax ID': '12-3456789' }],
      map
    );
    expect(row).toMatchObject({ displayName: 'Bolt Supply', is1099: true, taxId: '12-3456789' });
  });
});

describe('toNewCustomerInput / toNewVendorInput', () => {
  it('produces a customer create payload', () => {
    const [row] = buildCustomerRows([{ Customer: 'Acme', Email: 'a@b.com' }], {
      displayName: 'Customer',
      email: 'Email',
    });
    expect(toNewCustomerInput(row)).toMatchObject({ displayName: 'Acme', email: 'a@b.com' });
  });

  it('returns null without a name', () => {
    const [row] = buildCustomerRows([{ Customer: '' }], { displayName: 'Customer' });
    expect(toNewCustomerInput(row)).toBeNull();
  });

  it('produces a vendor create payload with 1099', () => {
    const [row] = buildVendorRows([{ Vendor: 'Bolt', '1099': 'Yes' }], {
      displayName: 'Vendor',
      is1099: '1099',
    });
    expect(toNewVendorInput(row)).toMatchObject({ displayName: 'Bolt', is1099: true });
  });
});

describe('findDuplicateParty', () => {
  const customers = [
    { id: 'c1', displayName: 'Acme Co', email: 'ap@acme.com' },
    { id: 'c2', displayName: 'Globex', email: null },
  ] as Customer[];

  it('matches on case-insensitive display name', () => {
    expect(findDuplicateParty({ displayName: 'acme co', email: null }, customers)?.id).toBe('c1');
  });

  it('matches on email when the name differs', () => {
    expect(
      findDuplicateParty({ displayName: 'Acme Corporation', email: 'AP@acme.com' }, customers)?.id
    ).toBe('c1');
  });

  it('returns null when neither matches', () => {
    expect(
      findDuplicateParty({ displayName: 'Initech', email: 'x@initech.com' }, customers)
    ).toBeNull();
  });

  it('works for vendors too', () => {
    const vendors = [{ id: 'v1', displayName: 'Bolt Supply', email: null }] as Vendor[];
    expect(findDuplicateParty({ displayName: 'BOLT SUPPLY', email: null }, vendors)?.id).toBe('v1');
  });
});
