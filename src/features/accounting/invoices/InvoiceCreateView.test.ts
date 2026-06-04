import { describe, it, expect } from 'vitest';
import { resolveEffectiveTaxCodeId } from './InvoiceCreateView';

/**
 * Precedence for the header tax code on the New Invoice screen:
 *   customer's preferred code  >  org default code  >  none
 * but only until the user has explicitly chosen a code, after which their raw
 * choice (including an intentional "No tax" = '') is honored verbatim.
 */
describe('resolveEffectiveTaxCodeId', () => {
  it('seeds the org default when untouched and no customer is selected', () => {
    expect(
      resolveEffectiveTaxCodeId({
        rawTaxCodeId: '',
        touched: false,
        customerDefaultTaxCodeId: null,
        orgDefaultTaxCodeId: 'org-default',
      })
    ).toBe('org-default');
  });

  it('prefers the customer default over the org default when untouched', () => {
    expect(
      resolveEffectiveTaxCodeId({
        rawTaxCodeId: '',
        touched: false,
        customerDefaultTaxCodeId: 'cust-code',
        orgDefaultTaxCodeId: 'org-default',
      })
    ).toBe('cust-code');
  });

  it('falls back to the org default when the customer has no preferred code', () => {
    expect(
      resolveEffectiveTaxCodeId({
        rawTaxCodeId: '',
        touched: false,
        customerDefaultTaxCodeId: undefined,
        orgDefaultTaxCodeId: 'org-default',
      })
    ).toBe('org-default');
  });

  it('resolves to none ("") when untouched and neither default exists', () => {
    expect(
      resolveEffectiveTaxCodeId({
        rawTaxCodeId: '',
        touched: false,
        customerDefaultTaxCodeId: null,
        orgDefaultTaxCodeId: null,
      })
    ).toBe('');
  });

  it('honors an explicit "No tax" selection over the available default', () => {
    // The core regression the fix guards against: once the user picks the empty
    // option, the default must NOT be re-seeded.
    expect(
      resolveEffectiveTaxCodeId({
        rawTaxCodeId: '',
        touched: true,
        customerDefaultTaxCodeId: 'cust-code',
        orgDefaultTaxCodeId: 'org-default',
      })
    ).toBe('');
  });

  it('honors an explicit code choice verbatim, ignoring the defaults', () => {
    expect(
      resolveEffectiveTaxCodeId({
        rawTaxCodeId: 'user-picked',
        touched: true,
        customerDefaultTaxCodeId: 'cust-code',
        orgDefaultTaxCodeId: 'org-default',
      })
    ).toBe('user-picked');
  });
});
