import { describe, it, expect } from 'vitest';
import {
  applicableRowCount,
  buildDriftComparisonRows,
  confirmApplyMessage,
  confirmDismissMessage,
  driftChangeSummary,
  formatDriftDate,
  formatRateDecimal,
  formatRatePct,
  formatTimestamp,
  hasOpenDrift,
  lastCheckedLabel,
  openDriftBadgeLabel,
  severityBadgeClass,
  statusBadgeClass,
} from './taxTableSyncView';
import type { TaxRate, TaxTableDriftDiffEntry } from './types';

/** Build a diff entry with sensible defaults; override the fields a case cares about. */
function diffEntry(over: Partial<TaxTableDriftDiffEntry> = {}): TaxTableDriftDiffEntry {
  return {
    rateName: 'CA State',
    jurisdiction: 'CA',
    currentRate: 0.0725,
    newRate: 0.0775,
    effectiveDate: '2026-07-01',
    label: null,
    ...over,
  };
}

/** Build an active stored rate. */
function rate(name: string, value: number): TaxRate {
  return {
    id: `id-${name}`,
    name,
    rate: value,
    jurisdiction: 'CA',
    effectiveDate: '2020-01-01',
    endDate: null,
    isActive: true,
    createdAt: '2020-01-01T00:00:00Z',
  };
}

describe('formatRatePct', () => {
  it('formats a decimal rate as a percent (0.0725 → "7.25%")', () => {
    expect(formatRatePct(0.0725)).toBe('7.25%');
  });

  it('trims trailing zeros (0.075 → "7.5%", 0.08 → "8%")', () => {
    expect(formatRatePct(0.075)).toBe('7.5%');
    expect(formatRatePct(0.08)).toBe('8%');
  });

  it('handles a sub-percent rate', () => {
    expect(formatRatePct(0.001)).toBe('0.1%');
  });

  it('returns an em dash for null / non-finite', () => {
    expect(formatRatePct(null)).toBe('—');
    expect(formatRatePct(undefined)).toBe('—');
    expect(formatRatePct(Number.NaN)).toBe('—');
    expect(formatRatePct(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('honors a custom digit cap', () => {
    expect(formatRatePct(0.012345, 2)).toBe('1.23%');
  });
});

describe('formatRateDecimal', () => {
  it('shows the raw decimal verbatim', () => {
    expect(formatRateDecimal(0.0725)).toBe('0.0725');
  });
  it('em dash for null', () => {
    expect(formatRateDecimal(null)).toBe('—');
  });
});

describe('formatDriftDate', () => {
  it('passes a clean YYYY-MM-DD through', () => {
    expect(formatDriftDate('2026-07-01')).toBe('2026-07-01');
  });
  it('takes the date portion of an ISO timestamp', () => {
    expect(formatDriftDate('2026-07-01T12:00:00Z')).toBe('2026-07-01');
  });
  it('em dash for null/garbage', () => {
    expect(formatDriftDate(null)).toBe('—');
    expect(formatDriftDate('nope')).toBe('—');
  });
});

describe('formatTimestamp / lastCheckedLabel', () => {
  it('returns the fallback for an empty value', () => {
    expect(formatTimestamp(null, 'Never')).toBe('Never');
    expect(formatTimestamp('', 'Never')).toBe('Never');
  });

  it('passes through an unparseable string verbatim', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('renders a real timestamp (locale string is non-empty and not the fallback)', () => {
    const out = formatTimestamp('2026-07-01T12:00:00Z', '—');
    expect(out).not.toBe('—');
    expect(out.length).toBeGreaterThan(0);
  });

  it('lastCheckedLabel says "Never checked" when null', () => {
    expect(lastCheckedLabel(null)).toBe('Never checked');
  });

  it('lastCheckedLabel prefixes a real timestamp', () => {
    expect(lastCheckedLabel('2026-07-01T12:00:00Z')).toMatch(/^Last checked /);
  });
});

describe('severityBadgeClass / statusBadgeClass', () => {
  it('maps each severity to a distinct tone', () => {
    expect(severityBadgeClass('critical')).toContain('red');
    expect(severityBadgeClass('warning')).toContain('amber');
    expect(severityBadgeClass('info')).toContain('slate');
  });

  it('open status is primary (actionable); terminal states are muted', () => {
    expect(statusBadgeClass('open')).toContain('primary');
    expect(statusBadgeClass('applied')).toContain('emerald');
    expect(statusBadgeClass('dismissed')).toContain('slate');
    expect(statusBadgeClass('reviewed')).toContain('sky');
  });
});

describe('driftChangeSummary', () => {
  it('counts only APPLICABLE entries and pluralizes', () => {
    const diff = [
      diffEntry({ rateName: 'A', newRate: 0.05 }), // applicable
      diffEntry({ rateName: 'B', newRate: 0.06 }), // applicable
      diffEntry({ rateName: '', newRate: 0.07 }), // skipped (no name)
      diffEntry({ rateName: 'D', newRate: null }), // skipped (no rate)
    ];
    expect(driftChangeSummary(diff)).toBe('2 rate changes proposed');
  });

  it('singular for exactly one', () => {
    expect(driftChangeSummary([diffEntry({ rateName: 'A', newRate: 0.05 })])).toBe(
      '1 rate change proposed'
    );
  });

  it('explicit none when nothing is applicable', () => {
    expect(driftChangeSummary([diffEntry({ rateName: '', newRate: null })])).toBe(
      'No applicable rate changes'
    );
    expect(driftChangeSummary([])).toBe('No applicable rate changes');
  });
});

describe('openDriftBadgeLabel / hasOpenDrift', () => {
  it('null/zero/negative → no badge', () => {
    expect(openDriftBadgeLabel(0)).toBeNull();
    expect(openDriftBadgeLabel(null)).toBeNull();
    expect(openDriftBadgeLabel(-1)).toBeNull();
    expect(hasOpenDrift(0)).toBe(false);
    expect(hasOpenDrift(null)).toBe(false);
  });

  it('shows the count, capping at 9+', () => {
    expect(openDriftBadgeLabel(1)).toBe('1');
    expect(openDriftBadgeLabel(9)).toBe('9');
    expect(openDriftBadgeLabel(10)).toBe('9+');
    expect(openDriftBadgeLabel(250)).toBe('9+');
    expect(hasOpenDrift(3)).toBe(true);
  });
});

describe('buildDriftComparisonRows', () => {
  it('classifies an existing-rate change as an UPDATE that changed', () => {
    const diff = [diffEntry({ rateName: 'CA State', currentRate: 0.0725, newRate: 0.0775 })];
    const rows = buildDriftComparisonRows(diff, new Map([['CA State', rate('CA State', 0.0725)]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rateName: 'CA State',
      currentRate: 0.0725,
      newRate: 0.0775,
      action: 'update',
      changed: true,
    });
  });

  it('classifies a missing-name rate as an INSERT (always changed)', () => {
    const diff = [diffEntry({ rateName: 'Napa County', newRate: 0.08 })];
    const rows = buildDriftComparisonRows(diff, new Map()); // no stored rate of that name
    expect(rows[0]).toMatchObject({ action: 'insert', currentRate: null, changed: true });
  });

  it('an UPDATE to the same value is NOT a change', () => {
    const diff = [diffEntry({ rateName: 'CA State', newRate: 0.0725 })];
    const rows = buildDriftComparisonRows(diff, new Map([['CA State', rate('CA State', 0.0725)]]));
    expect(rows[0]).toMatchObject({ action: 'update', changed: false });
  });

  it('a non-applicable entry (no usable name) is SKIPPED and never changed', () => {
    const diff = [diffEntry({ rateName: '   ', newRate: 0.09 })];
    const rows = buildDriftComparisonRows(diff, new Map());
    expect(rows[0]).toMatchObject({ action: 'skip', changed: false });
  });

  it('a non-applicable entry (missing/negative new rate) is SKIPPED', () => {
    const nullRate = buildDriftComparisonRows([diffEntry({ newRate: null })], new Map());
    expect(nullRate[0].action).toBe('skip');
    const negRate = buildDriftComparisonRows([diffEntry({ newRate: -0.01 })], new Map());
    expect(negRate[0].action).toBe('skip');
  });

  it('preserves diff order and carries jurisdiction/effectiveDate/label through', () => {
    const diff = [
      diffEntry({ rateName: 'A', jurisdiction: 'CA', effectiveDate: '2026-07-01', label: 'up' }),
      diffEntry({ rateName: 'B', jurisdiction: 'NV', effectiveDate: null, label: null }),
    ];
    const rows = buildDriftComparisonRows(diff, new Map());
    expect(rows.map((r) => r.rateName)).toEqual(['A', 'B']);
    expect(rows[0]).toMatchObject({ jurisdiction: 'CA', effectiveDate: '2026-07-01', label: 'up' });
  });
});

describe('applicableRowCount', () => {
  it('counts rows whose action is not skip', () => {
    const diff = [
      diffEntry({ rateName: 'A', newRate: 0.05 }), // insert/update
      diffEntry({ rateName: 'B', newRate: 0.06 }),
      diffEntry({ rateName: '', newRate: 0.07 }), // skip
    ];
    const rows = buildDriftComparisonRows(diff, new Map());
    expect(applicableRowCount(rows)).toBe(2);
  });
});

describe('confirmApplyMessage', () => {
  it('names the source and the rate count (plural)', () => {
    const msg = confirmApplyMessage('CDTFA', 3);
    expect(msg).toContain('CDTFA');
    expect(msg).toContain('3 rates');
    // Reassures no money/JE moves.
    expect(msg).toMatch(/does NOT/i);
    expect(msg).toMatch(/journal entry/i);
  });

  it('singular for one rate', () => {
    expect(confirmApplyMessage('CDTFA', 1)).toContain('1 rate ');
  });

  it('explains the no-op when nothing is applicable', () => {
    const msg = confirmApplyMessage('CDTFA', 0);
    expect(msg).toMatch(/no applicable rate changes/i);
  });

  it('falls back to a generic source label when name is blank', () => {
    expect(confirmApplyMessage('', 2)).toContain('this source');
    expect(confirmApplyMessage(null, 2)).toContain('this source');
  });
});

describe('confirmDismissMessage', () => {
  it('names the source and reassures rates are unchanged', () => {
    const msg = confirmDismissMessage('CA EDD');
    expect(msg).toContain('CA EDD');
    expect(msg).toMatch(/stay exactly as they are/i);
  });
  it('generic fallback for a blank source', () => {
    expect(confirmDismissMessage(undefined)).toContain('this source');
  });
});
