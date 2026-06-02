/**
 * Pure presentation helpers for the TAX-SYNC "Tax table updates" screens (UI lane).
 * No React, no Supabase — trivially unit-testable (see taxTableSyncView.test.ts).
 *
 * TAX-SYNC is ADVISORY-ONLY: a quarterly server function snapshots fresh CDTFA/EDD tables
 * and records a DRIFT row (the in-app admin alert) when they differ from the active
 * accounting.tax_rates. Nothing here moves money. The ONLY books change is a stored
 * reference rate, and only via the explicit accounting_admin Apply path.
 *
 * This module turns the raw drift/diff/source data into the human strings, the old-vs-new
 * comparison rows, and the tone classes the screens render — kept here (not inline in the
 * components) so the rate formatting, the insert-vs-update classification, and the "N of M
 * rates will change" wording are covered by fast tests and match the DB RPC's behavior.
 *
 * A tax RATE here is a small fixed-precision decimal compared for DISPLAY only (e.g.
 * 0.0725 → "7.25%"). Unlike money it is never summed as currency, so there is no
 * integer-cents treatment (which would be wrong for a fractional rate).
 */

import type {
  TaxRate,
  TaxTableDriftDiffEntry,
  TaxTableDriftSeverity,
  TaxTableDriftStatus,
} from './types';
import { applicableDiffEntries, isApplicableDiffEntry } from './taxTableDiff';
import { toIsoDate } from './periodLock';

// ── Rate / date / number formatting ───────────────────────────────────────────

/**
 * Format a decimal rate as a percent string for display (0.0725 → "7.25%"). `digits`
 * is the max fraction digits on the PERCENT value (default 3, so 0.001 → "0.1%" reads
 * cleanly and a 0.07250 rate shows as "7.25%"). A null/non-finite rate → "—".
 */
export function formatRatePct(rate: number | null | undefined, digits = 3): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  // Trim trailing zeros but keep up to `digits` places; toFixed then strip.
  const fixed = pct.toFixed(digits);
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return `${trimmed}%`;
}

/** Format the raw decimal rate verbatim for a secondary/mono display (0.0725 → "0.0725"). */
export function formatRateDecimal(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return String(rate);
}

/** A bare `YYYY-MM-DD` for display, or "—" when absent/unparseable. */
export function formatDriftDate(value: string | null | undefined): string {
  return toIsoDate(value) ?? '—';
}

/**
 * Format a timestamp (the `last_checked_at` / `detected_at` ISO strings) for display as a
 * locale date-time. Returns a "Never" fallback for null `lastCheckedAt`. `locale`/`now`
 * are not injected — this is display only and tolerates the host locale.
 */
export function formatTimestamp(value: string | null | undefined, fallback = '—'): string {
  if (value == null || String(value).trim() === '') return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

/** "Last checked" line for a source row: a real timestamp or an explicit "Never checked". */
export function lastCheckedLabel(lastCheckedAt: string | null | undefined): string {
  return lastCheckedAt ? `Last checked ${formatTimestamp(lastCheckedAt)}` : 'Never checked';
}

// ── Severity / status tone (Tailwind class fragments) ──────────────────────────

/**
 * Badge classes for a drift severity. Critical = red, warning = amber, info = slate.
 * Mirrors the TaxDisclaimer/period-lock amber convention so the screens feel native.
 */
export function severityBadgeClass(severity: TaxTableDriftSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/15 text-red-300 border border-red-500/30';
    case 'warning':
      return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
    case 'info':
    default:
      return 'bg-slate-500/15 text-slate-300 border border-slate-500/30';
  }
}

/** Badge classes for a drift lifecycle status. Open = primary (actionable); terminal = muted. */
export function statusBadgeClass(status: TaxTableDriftStatus): string {
  switch (status) {
    case 'open':
      return 'bg-primary/15 text-primary border border-primary/30';
    case 'reviewed':
      return 'bg-sky-500/15 text-sky-300 border border-sky-500/30';
    case 'applied':
      return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    case 'dismissed':
    default:
      return 'bg-slate-500/15 text-slate-400 border border-slate-500/30';
  }
}

// ── Drift summary wording ──────────────────────────────────────────────────────

/**
 * Short, pluralized summary of how many rate changes a drift's diff proposes that Apply
 * would actually act on (the RPC skips entries lacking a usable name or a numeric,
 * non-negative new rate). e.g. "3 rate changes proposed" / "1 rate change proposed" /
 * "No applicable rate changes".
 */
export function driftChangeSummary(diff: readonly TaxTableDriftDiffEntry[]): string {
  const n = applicableDiffEntries(diff).length;
  if (n === 0) return 'No applicable rate changes';
  return `${n} rate ${n === 1 ? 'change' : 'changes'} proposed`;
}

/**
 * The badge text for the open-drift count on the Settings entry + the screen header.
 * Returns null when there is nothing open (so the caller renders no badge). Caps the
 * displayed number at "9+" to keep the badge compact.
 */
export function openDriftBadgeLabel(count: number | null | undefined): string | null {
  if (count == null || count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** Whether the badge should be shown at all (a strictly-positive open count). */
export function hasOpenDrift(count: number | null | undefined): boolean {
  return count != null && count > 0;
}

// ── Old-vs-new comparison rows (the detail screen's core table) ────────────────

/** How Apply would change the rate store for one diff entry. */
export type DriftRowAction = 'update' | 'insert' | 'skip';

/**
 * One presented old-vs-new row on the drift detail screen. `current` is the active stored
 * rate of this name (null when none → Apply would INSERT). `action` mirrors the RPC:
 *   • 'update' — an active rate of this name exists; its rate is overwritten on Apply.
 *   • 'insert' — no active rate of this name; a new active rate is created on Apply.
 *   • 'skip'   — the entry is NOT applicable (no usable name, or a missing/negative new
 *                rate), so Apply ignores it. We still SHOW it (transparency) but flag it.
 * `changed` is true only for an applicable row whose new rate actually differs from the
 * stored rate (an insert is always a change; an update to the same value is not).
 */
export interface DriftComparisonRow {
  rateName: string;
  jurisdiction: string | null;
  /** The currently-stored active rate of this name (decimal), or null when none. */
  currentRate: number | null;
  /** The proposed new rate (decimal), or null when the parser could not read it. */
  newRate: number | null;
  effectiveDate: string | null;
  label: string | null;
  action: DriftRowAction;
  /** True when an applicable row's new rate differs from what is stored (or is an insert). */
  changed: boolean;
}

/**
 * Build the old-vs-new comparison rows for a drift's diff against the currently-stored
 * active rates (the Map the service's getCurrentRatesForDrift returns, keyed by exact
 * rate name — the RPC also matches by exact name). Order follows the diff. This is the
 * single source the detail table renders, so the on-screen "would change" set exactly
 * matches what accounting.apply_tax_table_drift will do.
 */
export function buildDriftComparisonRows(
  diff: readonly TaxTableDriftDiffEntry[],
  currentRates: ReadonlyMap<string, TaxRate>
): DriftComparisonRow[] {
  return diff.map((entry) => {
    const current = currentRates.get(entry.rateName) ?? null;
    const currentRate = current ? current.rate : null;
    const applicable = isApplicableDiffEntry(entry);

    let action: DriftRowAction;
    if (!applicable) action = 'skip';
    else if (current) action = 'update';
    else action = 'insert';

    // An applicable insert is always a change; an applicable update is a change only when
    // the proposed rate differs from the stored one. A skipped entry never "changes".
    const changed =
      applicable && (action === 'insert' || (action === 'update' && entry.newRate !== currentRate));

    return {
      rateName: entry.rateName,
      jurisdiction: entry.jurisdiction,
      currentRate,
      newRate: entry.newRate,
      effectiveDate: entry.effectiveDate,
      label: entry.label,
      action,
      changed,
    };
  });
}

/** Count of rows Apply will actually act on (action !== 'skip'). */
export function applicableRowCount(rows: readonly DriftComparisonRow[]): number {
  return rows.filter((r) => r.action !== 'skip').length;
}

/**
 * Confirmation body text for the Apply dialog, tailored to how many rates change. Names
 * the source so the admin is sure what they are applying. Always reiterates that ONLY the
 * stored rate changes (no money/JE) and that future invoices use the new rate.
 */
export function confirmApplyMessage(
  sourceName: string | null | undefined,
  applicableCount: number
): string {
  const src = sourceName && sourceName.trim() !== '' ? sourceName : 'this source';
  if (applicableCount === 0) {
    return (
      `This drift from ${src} has no applicable rate changes (each proposed entry is missing a ` +
      `usable rate name or a valid new rate), so applying it would change nothing. Review the ` +
      `source data, or dismiss the alert.`
    );
  }
  const noun = applicableCount === 1 ? 'rate' : 'rates';
  return (
    `Apply ${applicableCount} ${noun} from ${src} to your stored tax rates? This overwrites the ` +
    `matching active rate (or creates it if missing) and marks this alert applied. It does NOT ` +
    `post any journal entry or move money — only FUTURE invoices that use these rates are affected. ` +
    `Always verify the new rates with a CPA/EA first.`
  );
}

/** Confirmation body text for the Dismiss dialog (no rate change). */
export function confirmDismissMessage(sourceName: string | null | undefined): string {
  const src = sourceName && sourceName.trim() !== '' ? sourceName : 'this source';
  return (
    `Dismiss this drift alert from ${src} without changing any stored rate? Your tax rates stay ` +
    `exactly as they are. A future quarterly check (or a manual "check now") will re-detect the ` +
    `difference and open a new alert if it still exists.`
  );
}
