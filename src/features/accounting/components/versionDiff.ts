import type { DocumentVersion } from '@/services/api/accounting';

/**
 * Pure diff engine for the Google-Docs-style version history. Given the ordered version list
 * (oldest→newest, from accounting.document_versions), it computes the highlighted field- and
 * line-level changes between each adjacent pair and returns one entry PER VERSION, newest first.
 *
 * Snapshots are captured BEFORE each save, so a version's changes are framed as "what this saved
 * version changed vs. the previous one"; attribution (at/actor) is the version's own. The oldest
 * version is a baseline (nothing precedes it). Header columns are raw DB names; we surface only the
 * human-readable ones and skip system/bookkeeping noise. Foreign-key columns are shown generically
 * (added / changed / removed) rather than leaking UUIDs.
 */

export type FieldFormat = 'currency' | 'date' | 'text' | 'number' | 'ref';

export interface FieldDef {
  key: string;
  label: string;
  format: FieldFormat;
}

/**
 * One changed value. `before`/`after` are display strings; a null side means "absent" — render the
 * present side alone (an addition when only `after`, a removal when only `before`).
 */
export interface FieldChange {
  label: string;
  before: string | null;
  after: string | null;
}

export type LineChangeKind = 'added' | 'removed' | 'modified';

export interface LineChange {
  kind: LineChangeKind;
  /** The line's description (or a fallback) for the row heading. */
  label: string;
  /** Populated for 'modified'; the per-field deltas within the line. */
  fields: FieldChange[];
}

export interface VersionChange {
  /**
   * Stable row identity = the pre-edit snapshot's id (the diff/attribution anchor). Always set —
   * the live "current" entry is only ever the right side of a pair, never a row of its own.
   */
  id: string;
  /**
   * The snapshot to restore to in order to return to the state THIS row displays (its "after"),
   * or null when that state is the live current document (the latest row — nothing to restore).
   */
  restoreId: string | null;
  /** When this edit was made (the pre-edit snapshot's capture time = when its save ran). */
  at: string;
  /** Who made this edit (the pre-edit snapshot's author = who triggered that save). */
  actor: string | null;
  /** True for the most recent edit — the one that produced the current live state. */
  isLatest: boolean;
  kind: string;
  note: string | null;
  headerChanges: FieldChange[];
  lineChanges: LineChange[];
  /** headerChanges.length + lineChanges.length — the summary count. */
  totalChanges: number;
}

const HEADER_FIELDS: Record<'invoice' | 'estimate', FieldDef[]> = {
  estimate: [
    { key: 'customer_id', label: 'Customer', format: 'ref' },
    { key: 'estimate_date', label: 'Estimate date', format: 'date' },
    { key: 'expiry_date', label: 'Expiry date', format: 'date' },
    { key: 'terms', label: 'Terms', format: 'text' },
    { key: 'memo', label: 'Memo', format: 'text' },
    { key: 'notes', label: 'Notes', format: 'text' },
    { key: 'subtotal', label: 'Subtotal', format: 'currency' },
    { key: 'discount_total', label: 'Discount', format: 'currency' },
    { key: 'tax_total', label: 'Tax', format: 'currency' },
    { key: 'total', label: 'Total', format: 'currency' },
    { key: 'tax_code_id', label: 'Tax code', format: 'ref' },
    { key: 'job_id', label: 'Job', format: 'ref' },
  ],
  invoice: [
    { key: 'customer_id', label: 'Customer', format: 'ref' },
    { key: 'invoice_date', label: 'Invoice date', format: 'date' },
    { key: 'due_date', label: 'Due date', format: 'date' },
    { key: 'terms', label: 'Terms', format: 'text' },
    { key: 'memo', label: 'Memo', format: 'text' },
    { key: 'notes', label: 'Notes', format: 'text' },
    { key: 'subtotal', label: 'Subtotal', format: 'currency' },
    { key: 'discount_total', label: 'Discount', format: 'currency' },
    { key: 'tax_total', label: 'Tax', format: 'currency' },
    { key: 'total', label: 'Total', format: 'currency' },
    { key: 'tax_code_id', label: 'Tax code', format: 'ref' },
    { key: 'job_id', label: 'Job', format: 'ref' },
  ],
};

const LINE_FIELDS: FieldDef[] = [
  { key: 'description', label: 'Description', format: 'text' },
  { key: 'quantity', label: 'Qty', format: 'number' },
  { key: 'unit_price', label: 'Unit price', format: 'currency' },
  { key: 'discount', label: 'Discount', format: 'currency' },
  { key: 'line_total', label: 'Amount', format: 'currency' },
];

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function isEmpty(v: unknown): boolean {
  return v == null || v === '';
}

function format(value: unknown, fmt: FieldFormat): string {
  switch (fmt) {
    case 'currency': {
      const n = Number(value);
      return Number.isFinite(n) ? currencyFmt.format(n) : String(value);
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : String(value);
    }
    default:
      return String(value);
  }
}

/** Compare one field across two states; null if unchanged. */
function diffField(def: FieldDef, prev: unknown, next: unknown): FieldChange | null {
  if (def.format === 'ref') {
    const had = !isEmpty(prev);
    const has = !isEmpty(next);
    if (String(prev ?? '') === String(next ?? '')) return null;
    if (!had && has) return { label: def.label, before: null, after: 'set' };
    if (had && !has) return { label: def.label, before: 'set', after: null };
    return { label: def.label, before: null, after: 'changed' };
  }
  const before = isEmpty(prev) ? null : format(prev, def.format);
  const after = isEmpty(next) ? null : format(next, def.format);
  if (before === after) return null;
  return { label: def.label, before, after };
}

function diffHeader(
  defs: FieldDef[],
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const def of defs) {
    const change = diffField(def, prev[def.key], next[def.key]);
    if (change) out.push(change);
  }
  return out;
}

function lineLabel(line: Record<string, unknown>): string {
  const desc = line.description;
  return typeof desc === 'string' && desc.trim() ? desc : 'Line item';
}

function byId(lines: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  lines.forEach((l, i) => {
    // Snapshot lines carry their row id; fall back to position so id-less rows still diff.
    const id = l.id == null ? `idx:${i}` : String(l.id);
    map.set(id, l);
  });
  return map;
}

function diffLines(
  prev: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>
): LineChange[] {
  const prevMap = byId(prev);
  const nextMap = byId(next);
  const out: LineChange[] = [];

  // Removed (in prev, not in next).
  for (const [id, line] of prevMap) {
    if (!nextMap.has(id)) out.push({ kind: 'removed', label: lineLabel(line), fields: [] });
  }
  // Added + modified (walk next to preserve display order).
  for (const [id, line] of nextMap) {
    const before = prevMap.get(id);
    if (!before) {
      out.push({ kind: 'added', label: lineLabel(line), fields: [] });
      continue;
    }
    const fields: FieldChange[] = [];
    for (const def of LINE_FIELDS) {
      const change = diffField(def, before[def.key], line[def.key]);
      if (change) fields.push(change);
    }
    if (fields.length > 0) out.push({ kind: 'modified', label: lineLabel(line), fields });
  }
  return out;
}

/**
 * Build the change feed (newest first) from the ordered version list (oldest→newest).
 *
 * Snapshots are captured BEFORE each save, so `versions[k]` holds the state as it was just before
 * the save at `versions[k].at` (by `versions[k].actor`), and that save's result is the content of
 * `versions[k+1]` (or the live "current" entry for the last one). So one edit = one adjacent pair
 * `(versions[k] → versions[k+1])`, and the edit is correctly attributed to `versions[k]`'s metadata
 * (the save that produced the change) — NOT the next version's. Restoring `versions[k]` undoes it.
 */
export function buildVersionChanges(
  versions: DocumentVersion[],
  docType: 'invoice' | 'estimate'
): VersionChange[] {
  const headerDefs = HEADER_FIELDS[docType];
  const out: VersionChange[] = [];

  for (let k = 0; k < versions.length - 1; k++) {
    const base = versions[k]; // pre-edit state + who/when made this edit
    const next = versions[k + 1]; // post-edit state
    const headerChanges = diffHeader(headerDefs, base.snapshot.header, next.snapshot.header);
    const lineChanges = diffLines(base.snapshot.lines, next.snapshot.lines);
    out.push({
      // base.id is non-null (base is always a real snapshot, never the live entry).
      id: base.id as string,
      // Restoring returns to the displayed "after" = next's content; the live entry has no id.
      restoreId: next.isCurrent ? null : next.id,
      at: base.at,
      actor: base.actor,
      isLatest: next.isCurrent,
      kind: base.kind,
      note: base.note,
      headerChanges,
      lineChanges,
      totalChanges: headerChanges.length + lineChanges.length,
    });
  }

  return out.reverse(); // newest first
}
