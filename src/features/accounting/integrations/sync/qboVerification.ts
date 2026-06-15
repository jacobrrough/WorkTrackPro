/**
 * QBO replica VERIFICATION — the sign-off gate for the whole data transfer.
 *
 * Pulls QuickBooks' own reports (Balance Sheet, Profit & Loss, AR/AP aging) through
 * the read-only proxy and diffs them, account by account / party by party, against
 * WorkTrack's report engine. A migration is accepted ONLY when every section ties to
 * the penny — any non-zero delta is listed with both sides so it can be chased to a
 * specific account or customer/vendor.
 *
 * Sign conventions line up by construction: QBO statements and our ReportLine.amount
 * are both statement-positive (contra accounts negative on both sides), so amounts
 * compare directly. Matching is by normalized account name, tolerating QBO's
 * optional "1000 Checking" number prefix.
 */
import { toCents } from '../../accountingViewModel';
import { reportsService } from '../../../../services/api/accounting/reports';
import { qboSyncService, type QboJson } from '../../../../services/api/accounting/qboSync';
import type { ReportSection } from '../../types';

const EPOCH_START = '1900-01-01';

// ── QBO report JSON parsing ───────────────────────────────────────────────────

export interface QboReportRow {
  label: string;
  amount: number;
}

const num = (v: unknown): number => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Flatten a QBO report (Rows/Row tree) to its LEAF data rows: label = first column,
 * amount = last column. Section/summary rows are skipped — only the account/party
 * leaves carry comparable figures.
 */
export function flattenQboReportRows(report: QboJson): QboReportRow[] {
  const out: QboReportRow[] = [];

  const walk = (rows: unknown): void => {
    if (!Array.isArray(rows)) return;
    for (const row of rows as QboJson[]) {
      const nested = (row.Rows as QboJson | undefined)?.Row;
      if (nested) {
        walk(nested);
        continue;
      }
      if (row.type !== undefined && row.type !== 'Data') continue;
      const cols = Array.isArray(row.ColData) ? (row.ColData as QboJson[]) : [];
      if (cols.length < 2) continue;
      const label = String(cols[0]?.value ?? '').trim();
      if (!label) continue;
      out.push({ label, amount: num(cols[cols.length - 1]?.value) });
    }
  };

  walk((report.Rows as QboJson | undefined)?.Row);
  return out;
}

/** Normalize an account/party label for matching ("1000 Checking" ≍ "Checking"). */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** A label variant with any leading account-number token removed. */
export function stripNumberPrefix(label: string): string {
  return label
    .replace(/^\s*[\d.\-·]+\s+/, '')
    .trim()
    .toLowerCase();
}

// ── Diffing ───────────────────────────────────────────────────────────────────

export interface VerificationLine {
  label: string;
  qboAmount: number | null;
  ourAmount: number | null;
  deltaCents: number;
}

export interface VerificationSection {
  title: string;
  /** Only lines with a non-zero delta (the chase list). */
  mismatches: VerificationLine[];
  qboTotal: number;
  ourTotal: number;
  deltaCents: number;
  tied: boolean;
}

export interface VerificationResult {
  ranAt: string;
  asOf: string;
  sections: VerificationSection[];
  allTied: boolean;
  /** Non-fatal notes (e.g. a report that could not be fetched). */
  warnings: string[];
}

/**
 * Diff one QBO row set against one of our amount maps. Both sides keyed by
 * normalized label; QBO's number-prefixed variant collapses onto the bare name.
 */
export function diffRows(
  title: string,
  qboRows: QboReportRow[],
  ourRows: Array<{ label: string; amount: number }>
): VerificationSection {
  const ours = new Map<string, { label: string; cents: number }>();
  for (const r of ourRows) {
    const key = normalizeLabel(r.label);
    const existing = ours.get(key);
    if (existing) existing.cents += toCents(r.amount);
    else ours.set(key, { label: r.label, cents: toCents(r.amount) });
  }

  const seen = new Set<string>();
  const mismatches: VerificationLine[] = [];
  let qboTotalCents = 0;

  for (const q of qboRows) {
    const cents = toCents(q.amount);
    qboTotalCents += cents;
    const key = ours.has(normalizeLabel(q.label))
      ? normalizeLabel(q.label)
      : stripNumberPrefix(q.label);
    const match = ours.get(key);
    if (match) seen.add(key);
    const ourCents = match?.cents ?? null;
    const deltaCents = cents - (ourCents ?? 0);
    if (deltaCents !== 0) {
      mismatches.push({
        label: q.label,
        qboAmount: cents / 100,
        ourAmount: ourCents == null ? null : ourCents / 100,
        deltaCents,
      });
    }
  }

  let ourTotalCents = 0;
  for (const [key, o] of ours) {
    ourTotalCents += o.cents;
    if (!seen.has(key) && o.cents !== 0) {
      mismatches.push({
        label: o.label,
        qboAmount: null,
        ourAmount: o.cents / 100,
        deltaCents: -o.cents,
      });
    }
  }

  const deltaCents = qboTotalCents - ourTotalCents;
  return {
    title,
    mismatches,
    qboTotal: qboTotalCents / 100,
    ourTotal: ourTotalCents / 100,
    deltaCents,
    tied: deltaCents === 0 && mismatches.length === 0,
  };
}

const sectionLines = (s: ReportSection): Array<{ label: string; amount: number }> =>
  s.lines.map((l) => ({ label: l.name, amount: l.amount }));

// ── Orchestration ─────────────────────────────────────────────────────────────

/** Pull QBO's reports + ours and produce the delta report. */
export async function runVerification(): Promise<VerificationResult> {
  const asOf = new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const sections: VerificationSection[] = [];

  // Profit & Loss — all dates, accrual (matches the replicated posted ledger).
  const [qboPnl, ourPnl] = await Promise.all([
    qboSyncService.report('ProfitAndLoss', {
      start_date: EPOCH_START,
      end_date: asOf,
      accounting_method: 'Accrual',
    }),
    reportsService.getProfitAndLoss({ from: EPOCH_START, to: asOf }),
  ]);
  if (qboPnl.ok && qboPnl.data) {
    const rows = flattenQboReportRows(qboPnl.data);
    sections.push(
      diffRows('Profit & loss (all dates)', rows, [
        ...sectionLines(ourPnl.income),
        // Expenses are statement-positive on both sides; QBO's P&L lists them as
        // positive leaves too, so a single combined diff keeps net income honest.
        ...sectionLines(ourPnl.expense),
      ])
    );
  } else {
    warnings.push(`Profit & loss: ${qboPnl.error ?? 'QuickBooks report unavailable'}`);
  }

  // Balance sheet — as of today, accrual.
  const [qboBs, ourBs] = await Promise.all([
    qboSyncService.report('BalanceSheet', {
      start_date: EPOCH_START,
      end_date: asOf,
      accounting_method: 'Accrual',
    }),
    reportsService.getBalanceSheet({ to: asOf }),
  ]);
  if (qboBs.ok && qboBs.data) {
    const rows = flattenQboReportRows(qboBs.data);
    sections.push(
      diffRows('Balance sheet (as of today)', rows, [
        ...sectionLines(ourBs.assets),
        ...sectionLines(ourBs.liabilities),
        ...sectionLines(ourBs.equity),
      ])
    );
  } else {
    warnings.push(`Balance sheet: ${qboBs.error ?? 'QuickBooks report unavailable'}`);
  }

  // AR / AP aging — open balances per party.
  const [qboAr, ourAr] = await Promise.all([
    qboSyncService.report('AgedReceivables', { report_date: asOf }),
    reportsService.getArAging(),
  ]);
  if (qboAr.ok && qboAr.data) {
    const perParty = new Map<string, number>();
    for (const row of ourAr.rows) {
      perParty.set(row.partyName, (perParty.get(row.partyName) ?? 0) + row.balanceDue);
    }
    sections.push(
      diffRows(
        'Accounts receivable aging',
        flattenQboReportRows(qboAr.data),
        [...perParty.entries()].map(([label, amount]) => ({ label, amount }))
      )
    );
  } else {
    warnings.push(`AR aging: ${qboAr.error ?? 'QuickBooks report unavailable'}`);
  }

  const [qboAp, ourAp] = await Promise.all([
    qboSyncService.report('AgedPayables', { report_date: asOf }),
    reportsService.getApAging(),
  ]);
  if (qboAp.ok && qboAp.data) {
    const perParty = new Map<string, number>();
    for (const row of ourAp.rows) {
      perParty.set(row.partyName, (perParty.get(row.partyName) ?? 0) + row.balanceDue);
    }
    sections.push(
      diffRows(
        'Accounts payable aging',
        flattenQboReportRows(qboAp.data),
        [...perParty.entries()].map(([label, amount]) => ({ label, amount }))
      )
    );
  } else {
    warnings.push(`AP aging: ${qboAp.error ?? 'QuickBooks report unavailable'}`);
  }

  return {
    ranAt: new Date().toISOString(),
    asOf,
    sections,
    allTied: sections.length > 0 && sections.every((s) => s.tied) && warnings.length === 0,
    warnings,
  };
}
