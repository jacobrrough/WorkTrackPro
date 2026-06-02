/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Pure, framework-free presenters shared by
 *     every C2 payroll screen, paystub, report STUB, and export. No React, no Supabase — trivially
 *     unit-testable (payrollFormat.test.ts).
 *
 * MONEY (G6): the persisted payroll domain is INTEGER CENTS (`*Cents`) and HUNDREDTHS-OF-AN-HOUR
 * (`*HundredthHours`). These helpers convert at the DISPLAY boundary only — `formatCents` divides
 * by 100 for `Intl` formatting; `formatHundredthHours` divides by 100 for an "h" label;
 * `centsToDollars`/`dollarsToCents` round-trip a CurrencyInput's dollar number. Nothing here does
 * money MATH (sums live in the engine/RPC in cents) — these only render.
 */
import { formatMoney } from '../accountingViewModel';
import {
  PAY_FREQUENCY_LABELS,
  PAY_RUN_STATUS_LABELS,
  PAY_TYPE_LABELS,
  PAYROLL_FILING_STATUS_LABELS,
  PAYROLL_TAX_KIND_LABELS,
  type PayFrequency,
  type PayrollFilingStatus,
  type PayRunStatus,
  type PayType,
  type PayrollTaxKind,
} from '../types';

/**
 * The single source-of-truth LOUD disclaimer for every payroll surface/export. Mirrors the API
 * lane's PAYROLL_UNVERIFIED_DISCLAIMER (payrollReportStubs.ts) so an exported PDF/CSV and the
 * on-screen UnverifiedBanner say the same thing. The UnverifiedBanner component renders the headline
 * + sign-off; this string is the long-form caveat embedded in exports.
 */
export const PAYROLL_EXPORT_DISCLAIMER =
  'UNVERIFIED — NOT FOR FILING. This payroll output is a STUB built from official published rates ' +
  'that have NOT been verified for the applicable tax year. It is NOT a filing-grade form, and ' +
  'direct deposit (NACHA/ACH) is a non-bankable placeholder. A CPA/EA payroll professional and a ' +
  'security reviewer must sign off before this module is enabled, exported, or filed.';

// ── Money ───────────────────────────────────────────────────────────────────

/** Format an INTEGER-CENTS amount as a localized dollar string ($1,234.56). */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return formatMoney(safe / 100);
}

/**
 * Format an integer-cents amount accounting-style: a negative reads parenthesized, e.g. (\$12.00).
 * Used wherever a figure can legitimately be negative (a mis-configured net pre-commit).
 */
export function formatCentsAccounting(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  if (safe < 0) return `(${formatMoney(-safe / 100)})`;
  return formatMoney(safe / 100);
}

/** Convert integer cents to a dollar number (for seeding a CurrencyInput). */
export function centsToDollars(cents: number): number {
  const safe = Number.isFinite(cents) ? cents : 0;
  return safe / 100;
}

/** Convert a dollar number (from a CurrencyInput) to integer cents, rounded. */
export function dollarsToCents(dollars: number): number {
  const safe = Number.isFinite(dollars) ? dollars : 0;
  return Math.round(safe * 100);
}

// ── Hours ─────────────────────────────────────────────────────────────────────

/** Format HUNDREDTHS-OF-AN-HOUR (150 → "1.50 h"). */
export function formatHundredthHours(hundredths: number): string {
  const safe = Number.isFinite(hundredths) ? hundredths : 0;
  return `${(safe / 100).toFixed(2)} h`;
}

/** Convert hundredths-of-an-hour to a decimal-hours number (for an hours input). */
export function hundredthHoursToHours(hundredths: number): number {
  const safe = Number.isFinite(hundredths) ? hundredths : 0;
  return safe / 100;
}

/** Convert a decimal-hours number (from an input) to hundredths-of-an-hour, rounded. */
export function hoursToHundredthHours(hours: number): number {
  const safe = Number.isFinite(hours) ? hours : 0;
  return Math.round(safe * 100);
}

// ── Rates ─────────────────────────────────────────────────────────────────────

/**
 * Format a decimal tax RATE as a percentage (0.062 → "6.2%"). Up to 4 fractional digits so a tiny
 * rate (ETT 0.001 → "0.1%") is legible; trailing zeros trimmed.
 */
export function formatRatePct(rate: number): string {
  const safe = Number.isFinite(rate) ? rate : 0;
  const pct = safe * 100;
  // toFixed(4) then strip trailing zeros / a dangling dot.
  const s = pct.toFixed(4).replace(/\.?0+$/, '');
  return `${s}%`;
}

// ── Labels ──────────────────────────────────────────────────────────────────

export function payTypeLabel(t: PayType): string {
  return PAY_TYPE_LABELS[t] ?? t;
}

export function payFrequencyLabel(f: PayFrequency): string {
  return PAY_FREQUENCY_LABELS[f] ?? f;
}

export function filingStatusLabel(s: PayrollFilingStatus): string {
  return PAYROLL_FILING_STATUS_LABELS[s] ?? s;
}

export function payRunStatusLabel(s: PayRunStatus): string {
  return PAY_RUN_STATUS_LABELS[s] ?? s;
}

export function taxKindLabel(k: PayrollTaxKind): string {
  return PAYROLL_TAX_KIND_LABELS[k] ?? k;
}

/**
 * Tailwind classes for a pay-run status pill: slate = draft, amber = calculated (computed, not
 * posted), green = committed (the balanced JE posted), red = void (reversed). Mirrors the badge
 * palette used by the other accounting list screens.
 */
export function payRunStatusBadgeClass(status: PayRunStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-slate-500/15 text-slate-300';
    case 'calculated':
      return 'bg-amber-500/15 text-amber-300';
    case 'committed':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'void':
      return 'bg-red-500/15 text-red-300';
    default:
      return 'bg-slate-500/15 text-slate-400';
  }
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/**
 * Format an ISO `YYYY-MM-DD` (or longer timestamp) to a short local date. Parsed as UTC noon so the
 * calendar day never shifts across the local timezone. Falls back to the raw string when unparseable.
 */
export function formatPayrollDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return String(value);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Today's date as ISO `YYYY-MM-DD` (local), for defaulting date inputs. */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// ── Pay-run period label ──────────────────────────────────────────────────────

/** A compact "period start … period end · pay <payDate>" label for a pay-run row/header. */
export function payRunPeriodLabel(periodStart: string, periodEnd: string, payDate: string): string {
  return `${formatPayrollDate(periodStart)} … ${formatPayrollDate(periodEnd)} · pay ${formatPayrollDate(payDate)}`;
}
