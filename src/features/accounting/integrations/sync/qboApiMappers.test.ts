import { describe, it, expect } from 'vitest';
import {
  buildTermLookup,
  mapQboAccount,
  mapQboCustomer,
  mapQboItem,
  mapQboItemType,
  mapQboVendor,
  qboAddressToJson,
  refValue,
} from './qboApiMappers';

describe('refValue', () => {
  it('extracts the id from a QBO Ref object', () => {
    expect(refValue({ value: '79', name: 'Sales' })).toBe('79');
  });
  it('returns null for missing/blank/non-object refs', () => {
    expect(refValue(undefined)).toBeNull();
    expect(refValue(null)).toBeNull();
    expect(refValue('79')).toBeNull();
    expect(refValue({ value: '  ' })).toBeNull();
  });
});

describe('qboAddressToJson', () => {
  it('maps BillAddr to the flat shape parseCustomerAddress understands', () => {
    expect(
      qboAddressToJson({
        Id: '2',
        Line1: '123 Main St',
        Line2: 'Suite 4',
        City: 'Bakersfield',
        CountrySubDivisionCode: 'CA',
        PostalCode: '93301',
        Country: 'USA',
      })
    ).toEqual({
      line1: '123 Main St',
      line2: 'Suite 4',
      city: 'Bakersfield',
      state: 'CA',
      zip: '93301',
      country: 'USA',
    });
  });
  it('returns null when there is no usable component', () => {
    expect(qboAddressToJson({ Id: '2' })).toBeNull();
    expect(qboAddressToJson(undefined)).toBeNull();
  });
});

describe('buildTermLookup', () => {
  it('maps term ids to names, skipping malformed rows', () => {
    const lookup = buildTermLookup([
      { Id: '3', Name: 'Net 30' },
      { Id: '5', Name: 'Due on receipt' },
      { Name: 'No id' },
    ]);
    expect(lookup.get('3')).toBe('Net 30');
    expect(lookup.get('5')).toBe('Due on receipt');
    expect(lookup.size).toBe(2);
  });
});

describe('mapQboAccount', () => {
  it('maps a checking account with number + classification', () => {
    const mapped = mapQboAccount({
      Id: '35',
      Name: 'Checking',
      AcctNum: '1000',
      AccountType: 'Bank',
      AccountSubType: 'Checking',
      Description: 'Main operating account',
      Active: true,
    });
    expect(mapped.problem).toBeNull();
    expect(mapped.qboId).toBe('35');
    expect(mapped.accountNumber).toBe('1000');
    expect(mapped.input).toMatchObject({
      name: 'Checking',
      accountType: 'asset',
      accountSubtype: 'bank',
      normalBalance: 'debit',
      externalQboId: '35',
    });
  });

  it('classifies the API AccountType strings the same as CSV labels', () => {
    const ar = mapQboAccount({ Id: '1', Name: 'AR', AccountType: 'Accounts Receivable' });
    expect(ar.input?.accountSubtype).toBe('accounts_receivable');
    const cogs = mapQboAccount({ Id: '2', Name: 'COGS', AccountType: 'Cost of Goods Sold' });
    expect(cogs.input?.accountSubtype).toBe('cost_of_goods_sold');
    const dep = mapQboAccount({
      Id: '3',
      Name: 'Accum. Depreciation',
      AccountType: 'Fixed Asset',
      AccountSubType: 'AccumulatedDepreciation',
    });
    expect(dep.input?.accountSubtype).toBe('accumulated_depreciation');
    expect(dep.input?.normalBalance).toBe('credit');
  });

  it('flags an unclassifiable type as a problem', () => {
    const mapped = mapQboAccount({ Id: '9', Name: 'Weird', AccountType: 'Nonsense' });
    expect(mapped.input).toBeNull();
    expect(mapped.problem).toContain('Nonsense');
  });

  it('carries the inactive flag through', () => {
    const mapped = mapQboAccount({
      Id: '7',
      Name: 'Old bank',
      AccountType: 'Bank',
      Active: false,
    });
    expect(mapped.active).toBe(false);
  });
});

describe('mapQboItemType', () => {
  it.each([
    ['Inventory', 'inventory'],
    ['NonInventory', 'non_inventory'],
    ['Service', 'service'],
    ['Group', 'bundle'],
    ['Category', 'category'],
  ] as const)('maps %s → %s', (qbo, ours) => {
    expect(mapQboItemType(qbo)).toBe(ours);
  });
  it('returns null for unknown types', () => {
    expect(mapQboItemType('Mystery')).toBeNull();
  });
});

describe('mapQboItem', () => {
  const resolve = (qboAccountId: string | null) =>
    qboAccountId === '79' ? 'acct-income-uuid' : qboAccountId === '80' ? 'acct-cogs-uuid' : null;

  it('maps an inventory item with resolved account refs', () => {
    const mapped = mapQboItem(
      {
        Id: '11',
        Name: 'Widget',
        Sku: 'W-100',
        Type: 'Inventory',
        UnitPrice: 25.5,
        PurchaseCost: 10,
        IncomeAccountRef: { value: '79' },
        ExpenseAccountRef: { value: '80' },
        AssetAccountRef: { value: '81' },
        Active: true,
      },
      resolve
    );
    expect(mapped.problem).toBeNull();
    expect(mapped.input).toMatchObject({
      name: 'Widget',
      sku: 'W-100',
      itemType: 'inventory',
      incomeAccountId: 'acct-income-uuid',
      expenseAccountId: 'acct-cogs-uuid',
      inventoryAssetAccountId: null, // 81 unresolvable in this fixture
      salesPrice: 25.5,
      purchaseCost: 10,
      externalQboId: '11',
    });
  });

  it('skips Category rows as non-items', () => {
    const mapped = mapQboItem({ Id: '5', Name: 'Landscaping', Type: 'Category' }, resolve);
    expect(mapped.input).toBeNull();
    expect(mapped.problem).toContain('Category');
  });
});

describe('mapQboCustomer', () => {
  const termName = (id: string | null) => (id === '3' ? 'Net 30' : null);

  it('maps a full customer record', () => {
    const mapped = mapQboCustomer(
      {
        Id: '63',
        DisplayName: "Rough's Manufacturing",
        CompanyName: "Rough's Mfg LLC",
        GivenName: 'Jacob',
        FamilyName: 'Rough',
        PrimaryEmailAddr: { Address: 'jacob@example.com' },
        PrimaryPhone: { FreeFormNumber: '(661) 555-0100' },
        BillAddr: {
          Line1: '1 Shop Way',
          City: 'Bakersfield',
          CountrySubDivisionCode: 'CA',
          PostalCode: '93301',
        },
        Taxable: true,
        SalesTermRef: { value: '3' },
        Active: true,
      },
      termName
    );
    expect(mapped.problem).toBeNull();
    expect(mapped.input).toMatchObject({
      displayName: "Rough's Manufacturing",
      companyName: "Rough's Mfg LLC",
      contactName: 'Jacob Rough',
      email: 'jacob@example.com',
      phone: '(661) 555-0100',
      taxExempt: false,
      terms: 'Net 30',
      externalQboId: '63',
    });
    expect(mapped.input?.billingAddress).toMatchObject({ state: 'CA', zip: '93301' });
  });

  it('marks Taxable:false customers tax-exempt and defaults taxable when absent', () => {
    const exempt = mapQboCustomer({ Id: '1', DisplayName: 'School', Taxable: false }, termName);
    expect(exempt.input?.taxExempt).toBe(true);
    const normal = mapQboCustomer({ Id: '2', DisplayName: 'Shop' }, termName);
    expect(normal.input?.taxExempt).toBe(false);
  });

  it('falls back to FullyQualifiedName for sub-customers without a DisplayName', () => {
    const mapped = mapQboCustomer({ Id: '88', FullyQualifiedName: 'Parent Co:Site 12' }, termName);
    expect(mapped.input?.displayName).toBe('Parent Co:Site 12');
  });
});

describe('mapQboVendor', () => {
  it('maps a 1099 vendor with tax id', () => {
    const mapped = mapQboVendor(
      {
        Id: '41',
        DisplayName: 'Ace Welding',
        CompanyName: 'Ace Welding Inc',
        PrimaryEmailAddr: { Address: 'ap@aceweld.com' },
        TaxIdentifier: '12-3456789',
        Vendor1099: true,
        TermRef: { value: '3' },
        BillAddr: { Line1: '9 Industrial Rd', City: 'Fresno', CountrySubDivisionCode: 'CA' },
        Active: true,
      },
      (id) => (id === '3' ? 'Net 30' : null)
    );
    expect(mapped.problem).toBeNull();
    expect(mapped.input).toMatchObject({
      displayName: 'Ace Welding',
      taxId: '12-3456789',
      is1099: true,
      terms: 'Net 30',
      externalQboId: '41',
    });
    expect(mapped.input?.address).toMatchObject({ city: 'Fresno', state: 'CA' });
  });

  it('flags a vendor without a display name', () => {
    const mapped = mapQboVendor({ Id: '42' }, () => null);
    expect(mapped.input).toBeNull();
    expect(mapped.problem).toContain('display name');
  });
});
