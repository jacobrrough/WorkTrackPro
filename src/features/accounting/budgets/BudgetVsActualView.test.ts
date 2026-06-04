import { describe, it, expect } from 'vitest';
import { varianceColorClass } from './BudgetVsActualView';

/**
 * Variance colour must reflect *favorability* for the account's natural direction, not the
 * raw sign of `actual − budget`. The regression these tests guard: expense overruns were
 * coloured green (positive variance) when they should read red, and the mixed-type Total
 * row must stay neutral because favorability is undefined.
 */
describe('varianceColorClass', () => {
  const GREEN = 'text-emerald-400';
  const RED = 'text-red-400';
  const NEUTRAL = 'text-slate-300';

  describe('income / revenue accounts', () => {
    it('colours a beat (actual over budget, variance > 0) green', () => {
      expect(varianceColorClass(200, 'income')).toBe(GREEN);
    });

    it('colours a shortfall (actual under budget, variance < 0) red', () => {
      expect(varianceColorClass(-200, 'income')).toBe(RED);
    });
  });

  describe('expense accounts (inverted)', () => {
    it('colours an overrun (actual over budget, variance > 0) red — not green', () => {
      expect(varianceColorClass(150, 'expense')).toBe(RED);
    });

    it('colours under budget (variance < 0) green', () => {
      expect(varianceColorClass(-150, 'expense')).toBe(GREEN);
    });
  });

  describe('asset / liability / equity rows', () => {
    it.each(['asset', 'liability', 'equity'] as const)(
      'renders %s rows neutral because favorability is undefined',
      (accountType) => {
        expect(varianceColorClass(500, accountType)).toBe(NEUTRAL);
        expect(varianceColorClass(-500, accountType)).toBe(NEUTRAL);
      }
    );
  });

  describe('mixed / unknown type (e.g. the grand Total row)', () => {
    it('renders neutral when no account type is supplied', () => {
      expect(varianceColorClass(1000)).toBe(NEUTRAL);
      expect(varianceColorClass(-1000)).toBe(NEUTRAL);
    });
  });

  describe('zero variance', () => {
    it.each([undefined, 'income', 'expense', 'asset'] as const)(
      'is always neutral regardless of account type (%s)',
      (accountType) => {
        expect(varianceColorClass(0, accountType)).toBe(NEUTRAL);
      }
    );
  });
});
