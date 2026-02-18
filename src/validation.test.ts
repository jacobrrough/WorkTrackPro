import { describe, it, expect } from 'vitest';
import {
  validateJobCode,
  validateBinLocation,
  validateQuantity,
  validateEmail,
} from './core/validation';

describe('validateJobCode', () => {
  it('accepts valid codes', () => {
    expect(validateJobCode(1)).toBeNull();
    expect(validateJobCode(123)).toBeNull();
    expect(validateJobCode(999999)).toBeNull();
  });

  it('rejects invalid codes', () => {
    expect(validateJobCode(0)).not.toBeNull();
    expect(validateJobCode(-1)).not.toBeNull();
    expect(validateJobCode(1000000)).not.toBeNull();
    expect(validateJobCode(NaN)).not.toBeNull();
  });
});

describe('validateBinLocation', () => {
  it('accepts valid bin locations', () => {
    expect(validateBinLocation('A4c')).toBeNull();
    expect(validateBinLocation('B12a')).toBeNull();
    expect(validateBinLocation('Z99z')).toBeNull();
  });

  it('accepts empty (optional)', () => {
    expect(validateBinLocation('')).toBeNull();
  });

  it('rejects invalid bin locations', () => {
    expect(validateBinLocation('a4c')).not.toBeNull(); // lowercase rack
    expect(validateBinLocation('A4')).not.toBeNull(); // missing section
    expect(validateBinLocation('A4C')).not.toBeNull(); // uppercase section
    expect(validateBinLocation('4c')).not.toBeNull(); // missing rack
  });
});

describe('validateQuantity', () => {
  it('accepts valid quantities', () => {
    expect(validateQuantity(0)).toBeNull();
    expect(validateQuantity(1)).toBeNull();
    expect(validateQuantity(100)).toBeNull();
  });

  it('rejects invalid quantities', () => {
    expect(validateQuantity(-1)).not.toBeNull();
    expect(validateQuantity(1.5)).not.toBeNull(); // must be integer
    expect(validateQuantity(NaN)).not.toBeNull();
  });
});

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('user.name@company.co.uk')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(validateEmail('notanemail')).toBe(false);
    expect(validateEmail('missing@domain')).toBe(false);
    expect(validateEmail('@nodomain.com')).toBe(false);
  });
});
