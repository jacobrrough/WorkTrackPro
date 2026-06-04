/**
 * Pure helpers for TAX-SYNC drift `diff` payloads (no React, no Supabase — trivially
 * unit-testable, see taxTableDiff.test.ts).
 *
 * A drift row (accounting.tax_table_drift) carries a jsonb `diff`: an array of proposed
 * per-rate changes the admin reviews old-vs-new and may APPLY. The diff is built from
 * external, best-effort parsed CDTFA/EDD data, so every consumer must defend against
 * missing/garbage fields. This module is the single normalizer so the mapper, the
 * apply-preview the service shows, and the UI all interpret a diff entry identically — and
 * crucially so the client's "what would Apply do?" preview matches what the DB RPC
 * `accounting.apply_tax_table_drift` actually does.
 *
 * It mirrors the RPC's apply rules EXACTLY (migration 022): an entry is applied only when
 *   • it has a usable `rate_name` (non-empty after trim), AND
 *   • `new_rate` is JSON-numeric and >= 0.
 * Entries failing either test are skipped by the RPC (the whole apply does not fail), so
 * applicableDiffEntries() filters to precisely the set the RPC will act on. Keeping this
 * rule in one tested place is what lets the UI show an accurate "N of M rates will change"
 * without a round-trip and prevents the preview from drifting away from the DB behavior.
 *
 * Decimal rates here are plain JS numbers (e.g. 0.0725). Unlike money, a tax RATE is a
 * small fixed-precision decimal compared for *display/preview* only; the authoritative
 * write is `numeric(7,5)` in the DB. We never sum rates as currency, so no integer-cents
 * treatment is needed (and would be wrong for a fractional rate).
 */

import type { TaxTableDriftDiffEntry } from './types';
import { toIsoDate } from './periodLock';

/** Coerce a raw cell to a finite number, or null when it is not numeric. Tolerates a
 * numeric string ("0.0725") since jsonb usually pre-parses but external data may not. */
export function toRate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const nstr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Normalize ONE raw diff-array element (an arbitrary jsonb object) into the canonical
 * TaxTableDriftDiffEntry the UI renders and the apply preview reasons over. Accepts both
 * snake_case (as the DB/scheduled-function writes it) and camelCase (defensive) keys for
 * each field. A non-object element yields an entry with an empty rateName + null values
 * (which applicableDiffEntries then filters out) rather than throwing.
 */
export function normalizeDiffEntry(raw: unknown): TaxTableDriftDiffEntry {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rateName = nstr(o.rate_name ?? o.rateName) ?? '';
  const jurisdiction = nstr(o.jurisdiction);
  const currentRate = toRate(o.current_rate ?? o.currentRate);
  const newRate = toRate(o.new_rate ?? o.newRate);
  const effectiveDate = toIsoDate(
    (o.effective_date ?? o.effectiveDate) as string | null | undefined
  );
  const label = nstr(o.label);
  return { rateName, jurisdiction, currentRate, newRate, effectiveDate, label };
}

/**
 * Normalize a whole `diff` jsonb cell into a clean TaxTableDriftDiffEntry[]. supabase-js
 * returns jsonb pre-parsed, but we defend against a stringified array (or a null/garbage
 * cell) so a malformed value degrades to [] rather than throwing. Order is preserved.
 */
export function parseDiff(value: unknown): TaxTableDriftDiffEntry[] {
  let arr: unknown = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeDiffEntry);
}

/**
 * Whether a single (already-normalized) diff entry would be acted on by the apply RPC:
 * a usable rateName and a numeric, non-negative newRate. This is the exact gate the DB
 * RPC uses to skip bad entries.
 */
export function isApplicableDiffEntry(entry: TaxTableDriftDiffEntry): boolean {
  return entry.rateName.trim() !== '' && entry.newRate != null && entry.newRate >= 0;
}

/**
 * The subset of a diff that Apply will actually change in accounting.tax_rates (the rest
 * are skipped by the RPC). Use its length for an accurate "N rate(s) will change" preview.
 */
export function applicableDiffEntries(
  diff: readonly TaxTableDriftDiffEntry[]
): TaxTableDriftDiffEntry[] {
  return diff.filter(isApplicableDiffEntry);
}

/** Whether a diff has at least one entry the Apply RPC would act on. */
export function hasApplicableChanges(diff: readonly TaxTableDriftDiffEntry[]): boolean {
  return diff.some(isApplicableDiffEntry);
}

/**
 * Classify how a single applicable entry would change the rate store on Apply: an
 * 'update' (an active rate of that name already exists → its rate is overwritten) or an
 * 'insert' (no active rate of that name → a new active rate is created). Mirrors the RPC's
 * UPDATE-then-INSERT-on-zero-rows branch. `existingRateNames` is the set of currently
 * active accounting.tax_rates.name values (lower-cased compare is NOT used — the RPC
 * matches on exact name, so we do too). Returns null for a non-applicable entry.
 */
export function classifyDiffEntry(
  entry: TaxTableDriftDiffEntry,
  existingRateNames: ReadonlySet<string>
): 'update' | 'insert' | null {
  if (!isApplicableDiffEntry(entry)) return null;
  return existingRateNames.has(entry.rateName) ? 'update' : 'insert';
}
