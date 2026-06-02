/**
 * Pure presentation helpers for the books-closed (period lock) screen (D1, UI lane).
 * No React, no Supabase — trivially unit-testable (see periodLockView.test.ts).
 *
 * The DB is the source of truth and the only real enforcement (migration
 * 20260601000016). This module just turns the current lock state + a proposed new date
 * into the human-readable strings and the simple client-side validation the screen
 * renders, and centralizes the timezone-safe "today" string the date input defaults to.
 * Keeping the wording/validation here (not inline in the component) means the boundary
 * rules ("on or before", year edges) are covered by fast tests without rendering React.
 */

import { isDateInClosedPeriod, toIsoDate, type IsoDate } from './periodLock';

/**
 * Today's calendar date as `YYYY-MM-DD`, derived from the LOCAL date parts (not
 * toISOString(), which would shift to UTC and could read as "tomorrow"/"yesterday"
 * near midnight). Used to default + cap the date input on the screen. `now` is
 * injectable for deterministic tests.
 */
export function todayIsoLocal(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Result of validating a proposed close date the admin typed into the screen. */
export interface ProposedCloseValidation {
  /** The normalized `YYYY-MM-DD` to send to the RPC, or null when invalid. */
  date: IsoDate | null;
  /** A user-facing reason the date can't be used, or null when it's fine. */
  error: string | null;
}

/**
 * Validate the date the admin wants to close the books through, before we open the
 * confirmation dialog. We intentionally do NOT block future dates here: closing through
 * a future date is unusual but legitimate (and the DB allows it) — that is what the
 * confirmation dialog's explicit warning is for. We only reject a structurally invalid
 * date so the RPC always receives a clean `YYYY-MM-DD`.
 */
export function validateProposedCloseDate(raw: string | null | undefined): ProposedCloseValidation {
  const date = toIsoDate(raw);
  if (!date) {
    return { date: null, error: 'Choose a valid date (YYYY-MM-DD) to close the books through.' };
  }
  return { date, error: null };
}

/**
 * One-line summary of the current lock state for the screen header / status card.
 * `closedThrough` is the value from accounting.settings (null/blank = books open).
 */
export function lockStatusSummary(closedThrough: string | null | undefined): string {
  const closed = toIsoDate(closedThrough);
  return closed
    ? `Books are closed through ${closed}. Entries dated on or before ${closed} can't be posted or voided.`
    : 'Books are open. No period lock is set — entries can be posted and voided on any date.';
}

/**
 * The body text for the confirmation dialog, tailored to the action.
 *   • A non-null `nextDate` closes (or moves) the lock to that date.
 *   • A null `nextDate` re-opens the books (clears the lock).
 * When moving an existing lock EARLIER, we add a heads-up that previously frozen
 * later-dated entries become editable again.
 */
export function confirmCloseMessage(
  nextDate: IsoDate | null,
  currentClosed: string | null | undefined
): string {
  const current = toIsoDate(currentClosed);

  if (nextDate == null) {
    return current
      ? `Re-open the books? This clears the lock currently set at ${current}. Entries on or before ${current} will become editable (postable / voidable) again.`
      : 'Re-open the books? No lock is currently set, so this leaves the books open.';
  }

  const base =
    `Close the books through ${nextDate}? ` +
    `Once closed, no journal entry dated on or before ${nextDate} can be posted or voided — ` +
    `including invoices, bills, payments, and bank matches that would post into that period. ` +
    `Correct a closed period by re-opening it, fixing the entry, then closing again.`;

  // Moving the lock EARLIER unfreezes the gap between the new and old dates.
  if (current && nextDate < current) {
    return (
      `${base} This moves the existing lock earlier (from ${current} to ${nextDate}), so entries ` +
      `dated after ${nextDate} and on or before ${current} will become editable again.`
    );
  }
  return base;
}

/**
 * Whether a proposed new close date actually changes the current lock (so the screen
 * can disable a no-op "Update" action). Compares normalized dates; null == null (both
 * "books open") is no change.
 */
export function isLockChange(
  nextDate: IsoDate | null,
  currentClosed: string | null | undefined
): boolean {
  return (toIsoDate(nextDate) ?? null) !== (toIsoDate(currentClosed) ?? null);
}

/**
 * Re-export of the shared gate so post/void surfaces (e.g. the Journal) can warn before
 * attempting a doomed action without importing two modules. Pure pass-through.
 */
export { isDateInClosedPeriod };
