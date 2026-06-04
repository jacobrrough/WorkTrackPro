import { describe, it, expect } from 'vitest';
import {
  coerceCustomFieldValue,
  dataTypeUsesOptions,
  formatCustomFieldValue,
  isEmptyValue,
  isISODateString,
  normalizeKey,
  normalizeOptions,
  sortDefs,
  validateCustomFieldValue,
} from './customFields';
import type { CustomFieldDataType, CustomFieldDef, CustomFieldOption } from './types';

/** Minimal def factory — only the fields the pure helpers read. */
function def(
  dataType: CustomFieldDataType,
  opts: Partial<Pick<CustomFieldDef, 'label' | 'options'>> = {}
): Pick<CustomFieldDef, 'dataType' | 'label' | 'options'> {
  return { dataType, label: opts.label ?? 'Field', options: opts.options ?? [] };
}

const SELECT_OPTIONS: CustomFieldOption[] = [
  { value: 'hi', label: 'High' },
  { value: 'lo', label: 'Low' },
];

describe('isISODateString', () => {
  it('accepts a real calendar day', () => {
    expect(isISODateString('2026-06-01')).toBe(true);
    expect(isISODateString('2024-02-29')).toBe(true); // leap day
  });
  it('rejects impossible or malformed dates', () => {
    expect(isISODateString('2026-02-30')).toBe(false);
    expect(isISODateString('2026-13-01')).toBe(false);
    expect(isISODateString('2026-00-10')).toBe(false);
    expect(isISODateString('2026-6-1')).toBe(false); // not zero-padded
    expect(isISODateString('06/01/2026')).toBe(false);
    expect(isISODateString('')).toBe(false);
  });
});

describe('isEmptyValue', () => {
  it('treats null/undefined/blank string as empty', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue('   ')).toBe(true);
  });
  it('treats 0 and false as NOT empty (they are real values)', () => {
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue('x')).toBe(false);
  });
});

describe('validateCustomFieldValue — empty/unset', () => {
  it('coerces any empty input to null and is valid, for every data type', () => {
    for (const dt of ['text', 'number', 'date', 'boolean', 'select'] as CustomFieldDataType[]) {
      const r = validateCustomFieldValue(def(dt, { options: SELECT_OPTIONS }), '');
      expect(r).toEqual({ valid: true, coerced: null });
    }
    expect(validateCustomFieldValue(def('text'), null)).toEqual({ valid: true, coerced: null });
    expect(validateCustomFieldValue(def('text'), '   ')).toEqual({ valid: true, coerced: null });
  });
});

describe('validateCustomFieldValue — text', () => {
  it('trims and boxes a string', () => {
    expect(validateCustomFieldValue(def('text'), '  hello  ')).toEqual({
      valid: true,
      coerced: 'hello',
    });
  });
});

describe('validateCustomFieldValue — number', () => {
  it('accepts a number and a numeric string', () => {
    expect(validateCustomFieldValue(def('number'), 42).coerced).toBe(42);
    expect(validateCustomFieldValue(def('number'), '3.5').coerced).toBe(3.5);
    expect(validateCustomFieldValue(def('number'), '-7').coerced).toBe(-7);
    // Zero is a real value (not "empty").
    expect(validateCustomFieldValue(def('number'), 0)).toEqual({ valid: true, coerced: 0 });
  });
  it('rejects a non-numeric string', () => {
    const r = validateCustomFieldValue(def('number', { label: 'Amount' }), 'abc');
    expect(r.valid).toBe(false);
    expect(r.coerced).toBeNull();
    expect(r.error).toMatch(/Amount must be a number/);
  });
});

describe('validateCustomFieldValue — date', () => {
  it('accepts and boxes an ISO date string', () => {
    expect(validateCustomFieldValue(def('date'), '2026-06-01')).toEqual({
      valid: true,
      coerced: '2026-06-01',
    });
  });
  it('rejects a non-ISO / impossible date', () => {
    expect(validateCustomFieldValue(def('date'), '2026-02-30').valid).toBe(false);
    expect(validateCustomFieldValue(def('date'), 'June 1').valid).toBe(false);
  });
});

describe('validateCustomFieldValue — boolean', () => {
  it('coerces truthy/falsy forms to a JSON boolean', () => {
    expect(validateCustomFieldValue(def('boolean'), true).coerced).toBe(true);
    expect(validateCustomFieldValue(def('boolean'), 'true').coerced).toBe(true);
    expect(validateCustomFieldValue(def('boolean'), 'yes').coerced).toBe(true);
    expect(validateCustomFieldValue(def('boolean'), 1).coerced).toBe(true);
    // 'false'/0 are real (not empty) → coerce to false, still valid.
    expect(validateCustomFieldValue(def('boolean'), 'false')).toEqual({
      valid: true,
      coerced: false,
    });
    expect(validateCustomFieldValue(def('boolean'), 0)).toEqual({ valid: true, coerced: false });
  });
});

describe('validateCustomFieldValue — select', () => {
  it('accepts a value that is one of the def options', () => {
    expect(validateCustomFieldValue(def('select', { options: SELECT_OPTIONS }), 'hi').coerced).toBe(
      'hi'
    );
  });
  it('rejects a value not in the options', () => {
    const r = validateCustomFieldValue(
      def('select', { label: 'Priority', options: SELECT_OPTIONS }),
      'mid'
    );
    expect(r.valid).toBe(false);
    expect(r.coerced).toBeNull();
    expect(r.error).toMatch(/not one of the choices/);
  });
});

describe('coerceCustomFieldValue', () => {
  it('returns the boxed value for a valid input', () => {
    expect(coerceCustomFieldValue(def('number'), '12')).toBe(12);
  });
  it('returns null (unset) for an invalid input rather than throwing', () => {
    expect(coerceCustomFieldValue(def('number'), 'nope')).toBeNull();
    expect(coerceCustomFieldValue(def('select', { options: SELECT_OPTIONS }), 'zzz')).toBeNull();
  });
});

describe('formatCustomFieldValue', () => {
  it('formats booleans as Yes/No', () => {
    expect(formatCustomFieldValue(def('boolean'), true)).toBe('Yes');
    expect(formatCustomFieldValue(def('boolean'), false)).toBe('No');
  });
  it('formats a select value as its option label, falling back to the raw value', () => {
    expect(formatCustomFieldValue(def('select', { options: SELECT_OPTIONS }), 'hi')).toBe('High');
    expect(formatCustomFieldValue(def('select', { options: SELECT_OPTIONS }), 'removed')).toBe(
      'removed'
    );
  });
  it('formats number/text and returns emptyText for null', () => {
    expect(formatCustomFieldValue(def('number'), 9)).toBe('9');
    expect(formatCustomFieldValue(def('text'), 'hi')).toBe('hi');
    expect(formatCustomFieldValue(def('text'), null)).toBe('');
    expect(formatCustomFieldValue(def('text'), null, '—')).toBe('—');
  });
});

describe('sortDefs', () => {
  const mk = (sortOrder: number, label: string, key: string) => ({ sortOrder, label, key });
  it('orders by sortOrder asc, then label, then key — and does not mutate input', () => {
    const input = [
      mk(2, 'Beta', 'b'),
      mk(1, 'Zed', 'z'),
      mk(1, 'Alpha', 'a2'),
      mk(1, 'Alpha', 'a1'),
    ];
    const out = sortDefs(input);
    expect(out.map((d) => d.key)).toEqual(['a1', 'a2', 'z', 'b']);
    // input untouched (still original order)
    expect(input.map((d) => d.key)).toEqual(['b', 'z', 'a2', 'a1']);
  });
});

describe('normalizeKey', () => {
  it('snake_cases free-typed labels', () => {
    expect(normalizeKey('PO Number')).toBe('po_number');
    expect(normalizeKey('  Customer  Ref # ')).toBe('customer_ref');
    expect(normalizeKey('already_ok')).toBe('already_ok');
    expect(normalizeKey('--weird__input--')).toBe('weird_input');
  });
  it('returns empty string for garbage-only input', () => {
    expect(normalizeKey('  ###  ')).toBe('');
  });
});

describe('normalizeOptions', () => {
  it('trims, drops empties, dedupes by value, defaults label to value', () => {
    const out = normalizeOptions([
      { value: ' a ', label: ' Apple ' },
      { value: 'a', label: 'Dup' }, // duplicate value, dropped
      { value: '', label: 'Empty' }, // empty value, dropped
      { value: 'b', label: '' }, // empty label → defaults to value
    ]);
    expect(out).toEqual([
      { value: 'a', label: 'Apple' },
      { value: 'b', label: 'b' },
    ]);
  });
  it('returns [] for undefined/empty', () => {
    expect(normalizeOptions(undefined)).toEqual([]);
    expect(normalizeOptions([])).toEqual([]);
  });
});

describe('dataTypeUsesOptions', () => {
  it('is true only for select', () => {
    expect(dataTypeUsesOptions('select')).toBe(true);
    for (const dt of ['text', 'number', 'date', 'boolean'] as CustomFieldDataType[]) {
      expect(dataTypeUsesOptions(dt)).toBe(false);
    }
  });
});
