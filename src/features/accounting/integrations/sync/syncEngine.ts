/**
 * QuickBooks Online full-replica sync — client-stepped engine.
 *
 * The engine runs IN THE BROWSER under the signed-in accountant's RLS, exactly like
 * the CSV importers: the qbo-sync Netlify function only proxies read-only Intuit
 * queries (tokens stay server-side); every database write goes through the normal
 * service layer / balance-guarded RPCs.
 *
 * Stepping model: each step() call processes ONE page of ONE phase, then persists the
 * cursor + tallies to accounting.qbo_import_runs before returning. The driving view
 * loops while step() says 'continue'. A closed tab / refresh resumes from the stored
 * cursor; re-processing a page is harmless because every upsert/insert is keyed on
 * external_qbo_id.
 *
 * Phase order matters: masters first (accounts feed item refs; parties feed document
 * headers), then documents (invoices before estimates/payments; bills before bill
 * payments). Reconcile/verify phases (void of the legacy GL import + the QBO delta
 * report) are separate, explicitly-gated steps.
 */
import { qboSyncService } from '../../../../services/api/accounting/qboSync';
import { accountingSettingsService } from '../../../../services/api/accounting/settings';
import { acct } from '../../../../services/api/accounting/accountingClient';
import type { QboImportRun } from '../../types';
import { buildTermLookup } from './qboApiMappers';
import { MASTER_PHASES } from './syncMasterPhases';
import { DOC_PHASES } from './syncDocPhases';
import { COMPLETENESS_PHASES, reconcilePhase } from './syncCompletenessPhases';
import { addCounts, nameKey, zeroCounts, type SyncContext, type SyncPhase } from './syncShared';

export interface SyncStepOutcome {
  state: 'continue' | 'wait' | 'gate' | 'done' | 'stopped' | 'error';
  run: QboImportRun | null;
  /** Human progress line for the UI ("Customers: 3 created, 120 updated…"). */
  message?: string;
  /** Set when state==='wait' — QBO throttled us; retry after this many seconds. */
  waitSeconds?: number;
  /** Set when state==='gate' — the phase awaiting explicit user approval. */
  gatePhaseKey?: string;
}

/** Registry, in dependency order. Masters → documents → completeness → reconcile. */
export const SYNC_PHASES: SyncPhase[] = [
  ...MASTER_PHASES,
  ...DOC_PHASES,
  ...COMPLETENESS_PHASES,
  reconcilePhase,
];

// ── Context loading ──────────────────────────────────────────────────────────

/**
 * Read every row of a table in pages (supabase-js caps a single select at 1000 rows —
 * an incomplete lookup would silently re-create records it failed to see).
 */
async function selectAllRows(
  table:
    | 'accounts'
    | 'items'
    | 'customers'
    | 'vendors'
    | 'invoices'
    | 'bills'
    | 'estimates'
    | 'payments'
    | 'vendor_payments',
  columns: string
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await acct()
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/**
 * PRE-FLIGHT: the import posts journal entries at their HISTORICAL dates (back to the
 * company's first transaction). A books-closed lock would reject every one of them —
 * surface that as one clear failure instead of thousands of per-record errors.
 */
async function assertBooksOpen(): Promise<void> {
  const { data, error } = await acct()
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'closed_through_date')
    .maybeSingle();
  if (error) return; // can't read the lock — let per-record errors surface it
  const raw = (data as Record<string, unknown> | null)?.setting_value;
  const date = typeof raw === 'string' ? raw : null;
  if (date && date !== 'null') {
    throw new Error(
      `The books are closed through ${date}. The QuickBooks import posts historical entries, ` +
        'so clear the closed-period lock (Settings → books closed) before syncing, and re-set it after.'
    );
  }
}

/** Load the existing masters + synced-document ids once per engine instance. */
async function loadContext(): Promise<SyncContext> {
  await assertBooksOpen();

  const ctx: SyncContext = {
    termNames: new Map(),
    defaults: await accountingSettingsService.getDefaultAccounts(),
    accounts: { byQboId: new Map(), byNumber: new Map(), byName: new Map() },
    items: { byQboId: new Map(), byName: new Map() },
    customers: { byQboId: new Map(), byName: new Map() },
    vendors: { byQboId: new Map(), byName: new Map() },
    docs: {
      invoices: new Map(),
      bills: new Map(),
      estimates: new Map(),
      payments: new Set(),
      vendorPayments: new Set(),
      qboJeSourceIds: new Set(),
    },
  };

  for (const r of await selectAllRows('accounts', 'id, name, account_number, external_qbo_id')) {
    const id = String(r.id);
    if (r.external_qbo_id) ctx.accounts.byQboId.set(String(r.external_qbo_id), id);
    if (r.account_number) ctx.accounts.byNumber.set(String(r.account_number), id);
    if (r.name) ctx.accounts.byName.set(nameKey(String(r.name)), id);
  }
  for (const r of await selectAllRows(
    'items',
    'id, name, item_type, income_account_id, expense_account_id, inventory_asset_account_id, external_qbo_id'
  )) {
    const id = String(r.id);
    if (r.external_qbo_id) {
      ctx.items.byQboId.set(String(r.external_qbo_id), {
        id,
        itemType: String(r.item_type ?? 'service'),
        incomeAccountId: r.income_account_id == null ? null : String(r.income_account_id),
        expenseAccountId: r.expense_account_id == null ? null : String(r.expense_account_id),
        inventoryAssetAccountId:
          r.inventory_asset_account_id == null ? null : String(r.inventory_asset_account_id),
      });
    }
    if (r.name) ctx.items.byName.set(nameKey(String(r.name)), id);
  }
  for (const [table, lookup] of [
    ['customers', ctx.customers],
    ['vendors', ctx.vendors],
  ] as const) {
    for (const r of await selectAllRows(table, 'id, display_name, external_qbo_id')) {
      const id = String(r.id);
      if (r.external_qbo_id) lookup.byQboId.set(String(r.external_qbo_id), id);
      if (r.display_name) lookup.byName.set(nameKey(String(r.display_name)), id);
    }
  }

  // Already-synced documents (idempotent skip + payment/estimate link resolution).
  for (const r of await selectAllRows('invoices', 'id, external_qbo_id')) {
    if (r.external_qbo_id) ctx.docs.invoices.set(String(r.external_qbo_id), String(r.id));
  }
  for (const r of await selectAllRows('bills', 'id, external_qbo_id')) {
    if (r.external_qbo_id) ctx.docs.bills.set(String(r.external_qbo_id), String(r.id));
  }
  for (const r of await selectAllRows('estimates', 'id, external_qbo_id')) {
    if (r.external_qbo_id) ctx.docs.estimates.set(String(r.external_qbo_id), String(r.id));
  }
  for (const r of await selectAllRows('payments', 'id, external_qbo_id')) {
    if (r.external_qbo_id) ctx.docs.payments.add(String(r.external_qbo_id));
  }
  for (const r of await selectAllRows('vendor_payments', 'id, external_qbo_id')) {
    if (r.external_qbo_id) ctx.docs.vendorPayments.add(String(r.external_qbo_id));
  }

  // Already-posted completeness JEs (re-run idempotency for the txn pass).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await acct()
      .from('journal_entries')
      .select('source_id')
      .eq('source_type', 'qbo')
      .not('source_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as { source_id: string | null }[];
    for (const r of page) if (r.source_id) ctx.docs.qboJeSourceIds.add(r.source_id);
    if (page.length < 1000) break;
  }

  return ctx;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class QboSyncEngine {
  private ctx: SyncContext | null = null;

  constructor(private readonly runId: string) {}

  /** Process one page of the current phase; persist cursor + tallies; report state. */
  async step(): Promise<SyncStepOutcome> {
    const run = await qboSyncService.getRun(this.runId);
    if (!run) return { state: 'error', run: null, message: 'Sync run not found.' };
    if (run.status !== 'running') return { state: 'stopped', run };

    // Lazy context init (pre-flight + lookups + QBO terms).
    if (!this.ctx) {
      try {
        this.ctx = await loadContext();
      } catch (e) {
        return this.fail(run, e instanceof Error ? e.message : 'Failed to load local masters.');
      }
      const terms = await qboSyncService.query('Term', {
        startPosition: 1,
        maxResults: 1000,
        includeInactive: true,
      });
      if (!terms.ok) {
        if (terms.retryAfter) {
          this.ctx = null; // re-init next attempt
          return { state: 'wait', run, waitSeconds: terms.retryAfter };
        }
        return this.fail(run, terms.error ?? 'Failed to load QuickBooks terms.');
      }
      this.ctx.termNames = buildTermLookup(terms.data ?? []);
    }

    const phase = SYNC_PHASES.find((p) => !run.progress[p.key]?.done);
    if (!phase) {
      const finished = await qboSyncService.updateRun(run.id, {
        status: 'completed',
        phase: null,
        finished: true,
      });
      // High-water mark for the next incremental run = when this run started.
      await qboSyncService.markSynced(run.startedAt);
      return { state: 'done', run: finished ?? run };
    }

    const progress = run.progress[phase.key] ?? { startPosition: 1, done: false };

    // Gated phases (the legacy-GL void) pause for explicit approval. The approval is
    // persisted onto the run (progress[key].confirmed), so a resumed run remembers it.
    if (phase.gated && !progress.confirmed) {
      return { state: 'gate', run, gatePhaseKey: phase.key };
    }

    let records: ReturnType<typeof Array.of<never>> | unknown[] = [];
    if (!phase.local && phase.entity) {
      const page = await qboSyncService.query(phase.entity, {
        startPosition: progress.startPosition,
        maxResults: phase.pageSize,
        changedSince: run.changedSince ?? undefined,
        includeInactive: phase.includeInactive,
      });
      if (!page.ok) {
        if (page.retryAfter) return { state: 'wait', run, waitSeconds: page.retryAfter };
        return this.fail(run, page.error ?? `QuickBooks query failed (${phase.entity}).`);
      }
      records = page.data ?? [];
    }

    let outcome;
    try {
      outcome = await phase.process(records as never[], this.ctx);
    } catch (e) {
      return this.fail(run, e instanceof Error ? e.message : `${phase.label} failed.`);
    }
    await qboSyncService.appendLog(run.id, outcome.logs);

    const newProgress = {
      ...run.progress,
      [phase.key]: {
        ...progress,
        startPosition: progress.startPosition + records.length,
        // Local phases run exactly once; pull phases finish on a short page.
        done: phase.local ? true : records.length < phase.pageSize,
      },
    };
    const newCounts = {
      ...run.counts,
      [phase.key]: addCounts(run.counts[phase.key] ?? zeroCounts(), outcome.counts),
    };
    const updated = await qboSyncService.updateRun(run.id, {
      phase: phase.key,
      progress: newProgress,
      counts: newCounts,
    });

    const tally = newCounts[phase.key];
    return {
      state: 'continue',
      run: updated ?? run,
      message: `${phase.label}: ${tally.created} created, ${tally.updated} updated${
        tally.failed ? `, ${tally.failed} failed` : ''
      }`,
    };
  }

  private async fail(run: QboImportRun, message: string): Promise<SyncStepOutcome> {
    const updated = await qboSyncService.updateRun(run.id, {
      status: 'failed',
      error: message,
      finished: true,
    });
    return { state: 'error', run: updated ?? run, message };
  }

  /** Persist the user's approval of a gated phase so the run (even resumed) proceeds. */
  async confirmGate(run: QboImportRun, phaseKey: string): Promise<QboImportRun | null> {
    const progress = {
      ...run.progress,
      [phaseKey]: {
        ...(run.progress[phaseKey] ?? { startPosition: 1, done: false }),
        confirmed: true,
      },
    };
    return qboSyncService.updateRun(run.id, { progress });
  }
}

/** Start a new run (full, or incremental from the connection's stored cursor). */
export async function startSyncRun(
  mode: 'full' | 'incremental',
  changedSince: string | null
): Promise<QboImportRun | null> {
  return qboSyncService.createRun(mode, mode === 'incremental' ? changedSince : null);
}
