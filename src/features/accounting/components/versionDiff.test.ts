import { describe, it, expect } from 'vitest';
import { buildVersionChanges } from './versionDiff';
import type { DocumentVersion } from '@/services/api/accounting';

/**
 * The change feed turns the ordered snapshot list (oldest→newest, each carrying a full
 * {header, lines} payload) into one highlighted row PER EDIT, newest first. Because snapshots are
 * captured BEFORE each save, an edit is the pair (versions[k] → versions[k+1]) and is attributed to
 * versions[k]'s metadata (the save that produced it) — these tests pin that attribution, plus the
 * before→after rendering, line add/remove/modify, the no-UUID foreign-key rule, and noise skipping.
 */

function version(over: Partial<DocumentVersion>): DocumentVersion {
  return {
    id: over.id ?? 's1',
    at: over.at ?? '2026-06-26T12:00:00+00',
    actor: over.actor ?? 'a@b.com',
    kind: over.kind ?? 'autosave',
    note: over.note ?? null,
    isCurrent: over.isCurrent ?? false,
    snapshot: over.snapshot ?? { header: {}, lines: [] },
  };
}

const line = (over: Record<string, unknown>) => ({
  id: 'L1',
  description: 'Widget',
  quantity: 1,
  unit_price: 100,
  discount: 0,
  line_total: 100,
  ...over,
});

describe('buildVersionChanges', () => {
  it('emits one row per edit, newest first, attributed to the save that MADE each edit', () => {
    const out = buildVersionChanges(
      [
        version({
          id: 's0',
          at: '2026-06-26T10:00:00+00',
          actor: 'alice@x.com',
          snapshot: { header: { total: 100 }, lines: [] },
        }),
        version({
          id: 's1',
          at: '2026-06-26T11:00:00+00',
          actor: 'bob@x.com',
          snapshot: { header: { total: 150 }, lines: [] },
        }),
        version({
          id: null,
          isCurrent: true,
          at: '2026-06-26T11:00:30+00',
          actor: 'bob@x.com',
          snapshot: { header: { total: 200 }, lines: [] },
        }),
      ],
      'estimate'
    );
    expect(out).toHaveLength(2); // two edits → two rows (the live entry is never its own row)

    // Newest edit first: snapshot s1's save (Bob) produced the current total of 200. Its "after"
    // is the live document, so there is nothing to restore to.
    expect(out[0].isLatest).toBe(true);
    expect(out[0].id).toBe('s1');
    expect(out[0].restoreId).toBeNull();
    expect(out[0].actor).toBe('bob@x.com');
    expect(out[0].at).toBe('2026-06-26T11:00:00+00');
    expect(out[0].headerChanges).toEqual([{ label: 'Total', before: '$150.00', after: '$200.00' }]);

    // Older edit: snapshot s0's save (Alice) is the one that changed 100 → 150 — NOT Bob. Restoring
    // this row returns to the state it DISPLAYS ($150 = snapshot s1), not the pre-edit $100.
    expect(out[1].isLatest).toBe(false);
    expect(out[1].id).toBe('s0');
    expect(out[1].restoreId).toBe('s1');
    expect(out[1].actor).toBe('alice@x.com');
    expect(out[1].at).toBe('2026-06-26T10:00:00+00');
    expect(out[1].headerChanges).toEqual([{ label: 'Total', before: '$100.00', after: '$150.00' }]);
  });

  it('returns nothing when there is only the live entry (no edits yet)', () => {
    const out = buildVersionChanges([version({ id: null, isCurrent: true })], 'estimate');
    expect(out).toEqual([]);
  });

  it('ignores unchanged and numerically-equal values', () => {
    const out = buildVersionChanges(
      [
        version({ snapshot: { header: { total: 100, subtotal: 100.0 }, lines: [] } }),
        version({
          id: null,
          isCurrent: true,
          snapshot: { header: { total: 100, subtotal: 100 }, lines: [] },
        }),
      ],
      'estimate'
    );
    expect(out[0].totalChanges).toBe(0);
  });

  it('classifies added, removed, and modified lines', () => {
    const out = buildVersionChanges(
      [
        version({
          snapshot: {
            header: {},
            lines: [line({ id: 'L1', quantity: 1 }), line({ id: 'L2', description: 'Gone' })],
          },
        }),
        version({
          id: null,
          isCurrent: true,
          snapshot: {
            header: {},
            lines: [
              line({ id: 'L1', quantity: 5, line_total: 500 }),
              line({ id: 'L3', description: 'New' }),
            ],
          },
        }),
      ],
      'estimate'
    );
    const kinds = out[0].lineChanges.map((c) => `${c.kind}:${c.label}`);
    expect(kinds).toContain('removed:Gone');
    expect(kinds).toContain('added:New');
    const modified = out[0].lineChanges.find((c) => c.kind === 'modified');
    expect(modified?.fields).toContainEqual({ label: 'Qty', before: '1', after: '5' });
  });

  it('shows foreign-key changes generically without leaking UUIDs', () => {
    const out = buildVersionChanges(
      [
        version({ snapshot: { header: { customer_id: null }, lines: [] } }),
        version({
          id: null,
          isCurrent: true,
          snapshot: { header: { customer_id: 'uuid-123' }, lines: [] },
        }),
      ],
      'estimate'
    );
    expect(out[0].headerChanges).toEqual([{ label: 'Customer', before: null, after: 'set' }]);
  });
});
