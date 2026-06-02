/**
 * Pure books-closed (period lock) date math (D1). No React, no Supabase — trivially
 * unit-testable (see periodLock.test.ts).
 *
 * This is the JS analog of the date gate the DB adds in
 * accounting.guard_journal_entry / accounting.post_journal_entry /
 * accounting.void_journal_entry (migration 20260601000016): once the books are closed
 * "through" a date, NO journal entry dated ON OR BEFORE that date may be posted or
 * voided — the period is frozen.
 *
 * The DB is the source of truth and the only real enforcement (it rejects the write
 * regardless of what the client believes). This helper exists so the UI can warn the
 * user BEFORE they attempt a doomed post/void, disable the action, and explain why —
 * and so the boundary rule is covered by fast unit tests independent of a round-trip.
 *
 * Dates are compared as ISO `YYYY-MM-DD` strings, which is exactly what the DB stores
 * in accounting.settings.closed_through_date and what journal_entries.entry_date
 * serializes to. Lexicographic comparison of zero-padded ISO dates is equivalent to
 * chronological comparison, so we deliberately AVOID constructing JS `Date` objects
 * (which would drag in the runtime's timezone and could shift a date across midnight).
 */

/** A calendar date as an ISO `YYYY-MM-DD` string. */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a date-ish value to a bare `YYYY-MM-DD` string, or null when it is not a
 * usable date. Accepts an already-ISO string, or a longer ISO timestamp
 * ("2026-01-31T00:00:00Z") whose date portion we take verbatim (no timezone math).
 * Anything else (null, "", "garbage", a partial date) yields null.
 */
export function toIsoDate(value: string | null | undefined): IsoDate | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  // Take the date portion of an ISO timestamp without timezone conversion.
  const datePart = s.length > 10 && (s[10] === 'T' || s[10] === ' ') ? s.slice(0, 10) : s;
  return ISO_DATE_RE.test(datePart) ? datePart : null;
}

/**
 * Whether an entry dated `entryDate` falls in the closed period — i.e. the DB would
 * REJECT posting or voiding it.
 *
 * Mirrors the DB gate exactly: `closed is not null and entry_date <= closed`.
 *   • `closedThrough` null/blank ⇒ books are open ⇒ never closed ⇒ false.
 *   • entry ON the closed date ⇒ closed (the rule is "on or before") ⇒ true.
 *   • entry AFTER the closed date ⇒ open ⇒ false.
 *
 * Defensive: an unparseable `entryDate` is treated as NOT in the closed period (false)
 * so this helper never *blocks* an action on its own — the DB remains the authority and
 * will reject anything genuinely invalid. An unparseable `closedThrough` is treated as
 * "books open" (false).
 */
export function isDateInClosedPeriod(
  entryDate: string | null | undefined,
  closedThrough: string | null | undefined
): boolean {
  const closed = toIsoDate(closedThrough);
  if (!closed) return false; // books open → nothing is locked
  const entry = toIsoDate(entryDate);
  if (!entry) return false; // can't classify → don't block client-side; DB decides
  return entry <= closed; // on or before the closed date → frozen
}

/**
 * Inverse convenience: whether an entry dated `entryDate` may be posted/voided given
 * the current lock (true when the books are open through that date). Pure sugar over
 * isDateInClosedPeriod for readable call sites (e.g. enabling a "Post" button).
 */
export function isDatePostable(
  entryDate: string | null | undefined,
  closedThrough: string | null | undefined
): boolean {
  return !isDateInClosedPeriod(entryDate, closedThrough);
}
