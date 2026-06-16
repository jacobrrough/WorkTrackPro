import type {
  QboEntityCounts,
  QboImportLogEntry,
  QboImportRun,
  QboLogAction,
  QboPhaseProgress,
  QboRunStatus,
  QboSyncMode,
} from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import { mapQboImportLogRow, mapQboImportRunRow, type Row } from './mappers';

/**
 * QuickBooks Online data-sync — client service (Phases 1–5 of the QBO replica import).
 *
 * Two halves:
 *
 *  1) PROXY calls to the `qbo-sync` Netlify function (netlify/functions/qbo-sync.mjs),
 *     which holds the OAuth tokens and issues READ-ONLY Intuit API GETs. Same Bearer
 *     auth + envelope convention as qboConnectionService.
 *
 *  2) RUN TRACKING against accounting.qbo_import_runs / qbo_import_log via the normal
 *     accounting client (accountant RLS). The client-stepped sync engine persists its
 *     cursor after every page so any interruption resumes cleanly.
 *
 * Convention: proxy calls return typed result envelopes (views render inline errors);
 * table reads throw (React Query) and table writes return null on failure.
 */

const QBO_SYNC_ENDPOINT = '/api/qbo-sync';

/** QBO entity names the proxy accepts (mirror of the function's whitelist). */
export type QboEntityName =
  | 'Account'
  | 'Item'
  | 'Customer'
  | 'Vendor'
  | 'Term'
  | 'TaxCode'
  | 'TaxRate'
  | 'Estimate'
  | 'Invoice'
  | 'Bill'
  | 'Payment'
  | 'BillPayment'
  | 'CreditMemo'
  | 'SalesReceipt'
  | 'RefundReceipt'
  | 'VendorCredit'
  | 'Deposit'
  | 'Transfer'
  | 'JournalEntry'
  | 'Purchase';

/** Verification reports the proxy accepts. */
export type QboReportName =
  | 'TrialBalance'
  | 'BalanceSheet'
  | 'ProfitAndLoss'
  | 'AgedReceivables'
  | 'AgedPayables'
  | 'CustomerBalance'
  | 'VendorBalance'
  | 'GeneralLedger';

/** A raw QBO API entity — intentionally loose; per-entity mappers narrow it. */
export type QboJson = Record<string, unknown>;

export interface QboSyncResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Set on a 429 — seconds the caller should wait before retrying. */
  retryAfter?: number;
}

async function getAccessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function call<T>(
  params: Record<string, string>,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<QboSyncResult<T>> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not authenticated.' };

  const qs = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetch(`${QBO_SYNC_ENDPOINT}?${qs}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not reach the QuickBooks sync service.',
    };
  }

  const parsed = (await response.json().catch(() => null)) as
    | (Partial<T> & { error?: string; retryAfter?: number })
    | null;

  if (!response.ok) {
    return {
      ok: false,
      error: parsed?.error || `HTTP ${response.status}`,
      retryAfter: response.status === 429 ? (parsed?.retryAfter ?? 60) : undefined,
    };
  }
  return { ok: true, data: (parsed ?? {}) as T };
}

export const qboSyncService = {
  // ── Intuit proxy (read-only) ──────────────────────────

  /** Total records of an entity (optionally changed since the ISO timestamp). */
  async count(
    entity: QboEntityName,
    opts: { changedSince?: string; includeInactive?: boolean } = {}
  ): Promise<QboSyncResult<number>> {
    const params: Record<string, string> = { action: 'count', entity };
    if (opts.changedSince) params.changedSince = opts.changedSince;
    if (opts.includeInactive) params.includeInactive = 'true';
    const res = await call<{ count: number }>(params, 'GET');
    if (!res.ok) return { ok: false, error: res.error, retryAfter: res.retryAfter };
    return { ok: true, data: Number(res.data?.count ?? 0) };
  },

  /**
   * One page of entity records ordered by Id (STARTPOSITION is 1-based).
   * `includeInactive` matters for masters: QBO returns only active records unless the
   * query opts in, and a true replica needs retired customers/accounts too.
   */
  async query(
    entity: QboEntityName,
    opts: {
      startPosition: number;
      maxResults: number;
      changedSince?: string;
      includeInactive?: boolean;
    }
  ): Promise<QboSyncResult<QboJson[]>> {
    const params: Record<string, string> = {
      action: 'query',
      entity,
      startPosition: String(opts.startPosition),
      maxResults: String(opts.maxResults),
    };
    if (opts.changedSince) params.changedSince = opts.changedSince;
    if (opts.includeInactive) params.includeInactive = 'true';
    const res = await call<{ items: QboJson[] }>(params, 'GET');
    if (!res.ok) return { ok: false, error: res.error, retryAfter: res.retryAfter };
    return { ok: true, data: Array.isArray(res.data?.items) ? res.data.items : [] };
  },

  /** A QBO verification report (raw report JSON; the delta engine parses it). */
  async report(
    name: QboReportName,
    params: Partial<
      Record<'start_date' | 'end_date' | 'report_date' | 'accounting_method', string>
    > = {}
  ): Promise<QboSyncResult<QboJson>> {
    const all: Record<string, string> = { action: 'report', name };
    for (const [k, v] of Object.entries(params)) if (v) all[k] = v;
    const res = await call<{ report: QboJson }>(all, 'GET');
    if (!res.ok) return { ok: false, error: res.error, retryAfter: res.retryAfter };
    return { ok: true, data: res.data?.report ?? {} };
  },

  /** Stamp last_sync_at (and optionally the incremental cursor) on the connection. */
  async markSynced(cdcCursor?: string): Promise<QboSyncResult<true>> {
    const res = await call<{ ok: boolean }>({ action: 'mark-synced' }, 'POST', {
      cdcCursor: cdcCursor ?? null,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: true };
  },

  // ── Run tracking (accounting.qbo_import_runs) ─────────

  async createRun(mode: QboSyncMode, changedSince: string | null): Promise<QboImportRun | null> {
    const { data, error } = await acct()
      .from('qbo_import_runs')
      .insert({ mode, changed_since: changedSince })
      .select('*')
      .single();
    if (error || !data) return null;
    return mapQboImportRunRow(data as Row);
  },

  async updateRun(
    id: string,
    patch: {
      status?: QboRunStatus;
      phase?: string | null;
      progress?: Record<string, QboPhaseProgress>;
      counts?: Record<string, QboEntityCounts>;
      error?: string | null;
      finished?: boolean;
    }
  ): Promise<QboImportRun | null> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.phase !== undefined) row.phase = patch.phase;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.counts !== undefined) row.counts = patch.counts;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.finished) row.finished_at = new Date().toISOString();
    const { data, error } = await acct()
      .from('qbo_import_runs')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapQboImportRunRow(data as Row);
  },

  async getRun(id: string): Promise<QboImportRun | null> {
    const { data, error } = await acct()
      .from('qbo_import_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapQboImportRunRow(data as Row);
  },

  /** Most recent runs, newest first (run history panel). */
  async listRuns(limit = 20): Promise<QboImportRun[]> {
    const { data, error } = await acct()
      .from('qbo_import_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapQboImportRunRow);
  },

  /** The latest still-running run, if any (resume affordance). */
  async getActiveRun(): Promise<QboImportRun | null> {
    const { data, error } = await acct()
      .from('qbo_import_runs')
      .select('*')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapQboImportRunRow(data as Row);
  },

  // ── Per-record log (accounting.qbo_import_log) ────────

  /** Append log lines in one insert (batched per processed page). */
  async appendLog(
    runId: string,
    lines: Array<{
      entity: string;
      qboId?: string | null;
      action: QboLogAction;
      status?: 'ok' | 'error';
      message?: string | null;
      recordId?: string | null;
    }>
  ): Promise<boolean> {
    if (lines.length === 0) return true;
    const rows = lines.map((l) => ({
      run_id: runId,
      entity: l.entity,
      qbo_id: l.qboId ?? null,
      action: l.action,
      status: l.status ?? 'ok',
      message: l.message ?? null,
      record_id: l.recordId ?? null,
    }));
    const { error } = await acct().from('qbo_import_log').insert(rows);
    return !error;
  },

  /** Error lines for a run (drill-down panel). */
  async listErrors(runId: string, limit = 200): Promise<QboImportLogEntry[]> {
    const { data, error } = await acct()
      .from('qbo_import_log')
      .select('*')
      .eq('run_id', runId)
      .eq('status', 'error')
      .order('at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapQboImportLogRow);
  },

  /** No-effect skips (voided / $0 records) for a run — surfaced separately from real errors. */
  async listSkips(runId: string, limit = 500): Promise<QboImportLogEntry[]> {
    const { data, error } = await acct()
      .from('qbo_import_log')
      .select('*')
      .eq('run_id', runId)
      .eq('action', 'skip')
      .not('message', 'is', null)
      .order('at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapQboImportLogRow);
  },
};
