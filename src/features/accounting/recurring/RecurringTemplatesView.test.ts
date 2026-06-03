import { describe, it, expect } from 'vitest';
import { isTemplateEnded } from './RecurringTemplatesView';

/**
 * Guards the duplicate-posting fix on the Recurring list: an ENDED template (one whose
 * schedule advanced past its end_date, so generateDue deactivated it and froze the cursor
 * at next_run_date === last_run_date) must be recognised so the UI routes Resume to the
 * editor instead of re-activating in place — re-activating would make the already-run final
 * period "Due" again and let Generate re-post a duplicate invoice/bill/JE.
 *
 * `isTemplateEnded` only reads the four schedule columns it needs, so we test it with a
 * minimal fixture rather than a full RecurringTemplate.
 */
type EndedInput = Parameters<typeof isTemplateEnded>[0];

const tpl = (over: Partial<EndedInput>): EndedInput => ({
  active: false,
  endDate: '2026-03-31',
  // The signature of an end-of-schedule auto-pause: cursor frozen at the last run.
  nextRunDate: '2026-03-01',
  lastRunDate: '2026-03-01',
  ...over,
});

describe('isTemplateEnded', () => {
  it('flags a template auto-paused at its final period (cursor frozen == last run)', () => {
    expect(isTemplateEnded(tpl({}))).toBe(true);
  });

  it('flags it when the frozen cursor equals the end date exactly', () => {
    expect(
      isTemplateEnded(
        tpl({ endDate: '2026-03-01', nextRunDate: '2026-03-01', lastRunDate: '2026-03-01' })
      )
    ).toBe(true);
  });

  it('does NOT flag an active template (never an ended/blocked Resume)', () => {
    expect(isTemplateEnded(tpl({ active: true }))).toBe(false);
  });

  it('does NOT flag an open-ended template (no end_date)', () => {
    expect(isTemplateEnded(tpl({ endDate: null }))).toBe(false);
  });

  it('does NOT flag a template paused mid-schedule (cursor advanced past last run)', () => {
    // Manually paused: the cursor moved on to the next period, so Resume is safe.
    expect(isTemplateEnded(tpl({ nextRunDate: '2026-02-01', lastRunDate: '2026-01-01' }))).toBe(
      false
    );
  });

  it('does NOT flag a template that never ran (no last_run_date)', () => {
    expect(isTemplateEnded(tpl({ lastRunDate: null }))).toBe(false);
  });

  it('does NOT flag when the frozen cursor is already past the end date', () => {
    // Cursor pushed beyond end_date (e.g. via an edit) — resuming would not re-fire the
    // ended window, so this predicate stays out of the way.
    expect(
      isTemplateEnded(
        tpl({ nextRunDate: '2026-04-01', lastRunDate: '2026-04-01', endDate: '2026-03-31' })
      )
    ).toBe(false);
  });

  it('is NaN-safe for malformed dates (treats them as not-ended rather than throwing)', () => {
    expect(isTemplateEnded(tpl({ nextRunDate: 'not-a-date' }))).toBe(false);
    expect(isTemplateEnded(tpl({ endDate: 'garbage' }))).toBe(false);
  });
});
