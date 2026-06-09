import { describe, it, expect } from 'vitest';
import {
  IMPLEMENTED_DEPRECIATION_METHODS,
  isDepreciationMethodSupported,
  validateDepreciationMethod,
} from './fixedAssetFormat';
import { DEPRECIATION_METHODS } from '../types';

/**
 * P2-5 guard: `declining_balance` is an accepted enum value, but both the JS preview and the
 * DB generator emit a STRAIGHT-LINE schedule for it (interim expense/NBV would be wrong). The
 * create view must not let it be saved until a real generator lands. These tests pin the guard
 * so it can't silently regress.
 */
describe('isDepreciationMethodSupported', () => {
  it('accepts straight_line (the only implemented method)', () => {
    expect(isDepreciationMethodSupported('straight_line')).toBe(true);
  });

  it('rejects declining_balance (schedule generator not yet implemented)', () => {
    expect(isDepreciationMethodSupported('declining_balance')).toBe(false);
  });

  it('lists straight_line as implemented and excludes declining_balance', () => {
    expect(IMPLEMENTED_DEPRECIATION_METHODS).toContain('straight_line');
    expect(IMPLEMENTED_DEPRECIATION_METHODS).not.toContain('declining_balance');
  });
});

describe('validateDepreciationMethod', () => {
  it('returns null for straight_line (safe to save)', () => {
    expect(validateDepreciationMethod('straight_line')).toBeNull();
  });

  it('rejects declining_balance with a message steering to straight-line', () => {
    const error = validateDepreciationMethod('declining_balance');
    expect(error).not.toBeNull();
    // The message names the method and points the user at straight-line.
    expect(error).toMatch(/declining balance/i);
    expect(error).toMatch(/straight-line/i);
  });

  it('rejects every method that is not in the implemented set', () => {
    for (const method of DEPRECIATION_METHODS) {
      const expectedSupported = IMPLEMENTED_DEPRECIATION_METHODS.includes(method);
      expect(validateDepreciationMethod(method) === null).toBe(expectedSupported);
    }
  });
});
