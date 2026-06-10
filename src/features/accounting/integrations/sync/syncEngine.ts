/**
 * QuickBooks Online full-replica sync — client-stepped engine (Phase 1: masters).
 *
 * The engine runs IN THE BROWSER under the signed-in accountant's RLS, exactly like
 * the CSV importers: the qbo-sync Netlify function only proxies read-only Intuit
 * queries (tokens stay server-side); every database write goes through the normal
 * service layer.
 *
 * Stepping model: each step() call processes ONE page of ONE phase, then persists the
 * cursor + tallies to accounting.qbo_import_runs before returning. The driving view
 * loops while step() says 'continue'. A closed tab / refresh resumes from the stored
 * cursor; re-processing a page is harmless because every upsert is keyed on
 * external_qbo_id (and first-run adoption matches are deterministic).
 *
 * Phase order matters: accounts before items (account refs), masters before documents.
 * Document/reconcile/verify phases register here as they land (A4/A5/A6).
 */
import {
  qboSyncService,
  type QboEntityName,
  type QboJson,
} from '../../../../services/api/accounting/qboSync';
import { accountsService } from '../../../../services/api/accounting/accounts';
import { customersService } from '../../../../services/api/accounting/customers';
import { itemsService } from '../../../../services/api/accounting/items';
import { vendorsService } from '../../../../services/api/accounting/vendors';
import { acct } from '../../../../services/api/accounting/accountingClient';
import type { QboEntityCounts, QboImportRun, QboLogAction } from '../../types';
import {
  buildTermLookup,
  mapQboAccount,
  mapQboCustomer,
  mapQboItem,
  mapQboVendor,
} from './qboApiMappers';

// ── Shared shapes ────────────────────────────────────────────────────────────

export interface SyncLogLine {
  entity: string;
  qboId?: string | null;
  action: QboLogAction;
  status?: 'ok' | 'error';
  message?: string | null;
  recordId?: string | null;
}

interface PageOutcome {
  counts: QboEntityCounts;
  logs: SyncLogLine[];
}

export interface SyncStepOutcome {
  state: 'continue' | 'wait' | 'done' | 'stopped' | 'error';
  run: QboImportRun | null;
  /** Human progress line for the UI ("Customers: processed 123…"). */
  message?: string;
  /** Set when state==='wait' — QBO throttled us; retry after this many seconds. */
  waitSeconds?: number;
}

const zeroCounts = (): QboEntityCounts => ({ created: 0, updated: 0, skipped: 0, failed: 0 });

const addCounts = (a: QboEntityCounts, b: QboEntityCounts): QboEntityCounts => ({
  created: a.created + b.created,
  updated: a.updated + b.updated,
  skipped: a.skipped + b.skipped,
  failed: a.failed + b.failed,
});

const nameKey = (s: string): string => s.trim().toLowerCase();

// ── Lookup caches (id resolution across phases) ──────────────────────────────

interface AccountLookup {
  byQboId: Map<string, string>;
  byNumber: Map<string, string>;
  byName: Map<string, string>;
}

interface PartyLookup {
  byQboId: Map<string, string>;
  byName: Map<string, string>;
}

interface SyncContext {
  termNames: Map<string, string>;
  accounts: AccountLookup;
  items: PartyLookup;
  customers: PartyLookup;
  vendors: PartyLookup;
}

/**
 * Read every row of a table in pages (supabase-js caps a single select at 1000 rows —
 * an incomplete lookup would silently re-create records it failed to see).
 */
async function selectAllRows(
  table: 'accounts' | 'items' | 'customers' | 'vendors',
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

/** Load the existing masters once per engine instance (raw selects — only ids + keys). */
async function loadContext(): Promise<SyncContext> {
  const accounts: AccountLookup = { byQboId: new Map(), byNumber: new Map(), byName: new Map() };
  const items: PartyLookup = { byQboId: new Map(), byName: new Map() };
  const customers: PartyLookup = { byQboId: new Map(), byName: new Map() };
  const vendors: PartyLookup = { byQboId: new Map(), byName: new Map() };

  for (const r of await selectAllRows('accounts', 'id, name, account_number, external_qbo_id')) {
    const id = String(r.id);
    if (r.external_qbo_id) accounts.byQboId.set(String(r.external_qbo_id), id);
    if (r.account_number) accounts.byNumber.set(String(r.account_number), id);
    if (r.name) accounts.byName.set(nameKey(String(r.name)), id);
  }
  for (const r of await selectAllRows('items', 'id, name, external_qbo_id')) {
    const id = String(r.id);
    if (r.external_qbo_id) items.byQboId.set(String(r.external_qbo_id), id);
    if (r.name) items.byName.set(nameKey(String(r.name)), id);
  }
  for (const [table, lookup] of [
    ['customers', customers],
    ['vendors', vendors],
  ] as const) {
    for (const r of await selectAllRows(table, 'id, display_name, external_qbo_id')) {
      const id = String(r.id);
      if (r.external_qbo_id) lookup.byQboId.set(String(r.external_qbo_id), id);
      if (r.display_name) lookup.byName.set(nameKey(String(r.display_name)), id);
    }
  }

  return { termNames: new Map(), accounts, items, customers, vendors };
}

// ── Phase definitions ────────────────────────────────────────────────────────

interface SyncPhase {
  key: string;
  label: string;
  entity: QboEntityName;
  pageSize: number;
  /** Masters opt in to inactive records (historical docs reference retired parties). */
  includeInactive: boolean;
  process(items: QboJson[], ctx: SyncContext): Promise<PageOutcome>;
}

const accountsPhase: SyncPhase = {
  key: 'accounts',
  label: 'Chart of accounts',
  entity: 'Account',
  pageSize: 1000,
  includeInactive: true,
  async process(records, ctx) {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];

    for (const json of records) {
      const mapped = mapQboAccount(json);
      if (!mapped.input) {
        counts.failed += 1;
        logs.push({
          entity: 'Account',
          qboId: mapped.qboId || null,
          action: 'error',
          status: 'error',
          message: mapped.problem,
        });
        continue;
      }

      const existingByQbo = ctx.accounts.byQboId.get(mapped.qboId);
      if (existingByQbo) {
        // Re-run: refresh the mutable fields.
        const updated = await accountsService.update(existingByQbo, {
          name: mapped.input.name,
          accountNumber: mapped.input.accountNumber,
          description: mapped.input.description,
          isActive: mapped.active,
        });
        if (updated) counts.updated += 1;
        else {
          counts.failed += 1;
          logs.push({
            entity: 'Account',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.name}"`,
            recordId: existingByQbo,
          });
        }
        continue;
      }

      // First run: adopt the existing chart (CSV-imported) by number, then by name —
      // stamp the QBO id without rewriting its classification.
      const adoptId =
        (mapped.accountNumber ? ctx.accounts.byNumber.get(mapped.accountNumber) : undefined) ??
        ctx.accounts.byName.get(nameKey(mapped.name));
      if (adoptId) {
        const adopted = await accountsService.update(adoptId, {
          externalQboId: mapped.qboId,
          isActive: mapped.active,
        });
        if (adopted) {
          ctx.accounts.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          logs.push({
            entity: 'Account',
            qboId: mapped.qboId,
            action: 'update',
            message: `Matched existing account "${mapped.name}"`,
            recordId: adoptId,
          });
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Account',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Could not stamp existing account "${mapped.name}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await accountsService.create(mapped.input);
      if (created) {
        if (!mapped.active) await accountsService.setActive(created.id, false);
        ctx.accounts.byQboId.set(mapped.qboId, created.id);
        if (mapped.accountNumber) ctx.accounts.byNumber.set(mapped.accountNumber, created.id);
        ctx.accounts.byName.set(nameKey(mapped.name), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Account',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.name,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Account',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.name}"`,
        });
      }
    }

    return { counts, logs };
  },
};

const itemsPhase: SyncPhase = {
  key: 'items',
  label: 'Products & services',
  entity: 'Item',
  pageSize: 1000,
  includeInactive: true,
  async process(records, ctx) {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const resolveAccountId = (qboAccountId: string | null) =>
      qboAccountId ? (ctx.accounts.byQboId.get(qboAccountId) ?? null) : null;

    for (const json of records) {
      const mapped = mapQboItem(json, resolveAccountId);
      if (!mapped.input) {
        // Category rows are expected non-items — count as skipped, not failed.
        const benign = mapped.problem?.startsWith('Category');
        if (benign) counts.skipped += 1;
        else {
          counts.failed += 1;
          logs.push({
            entity: 'Item',
            qboId: mapped.qboId || null,
            action: 'error',
            status: 'error',
            message: mapped.problem,
          });
        }
        continue;
      }

      const existingByQbo = ctx.items.byQboId.get(mapped.qboId);
      const adoptId = existingByQbo ?? ctx.items.byName.get(nameKey(mapped.name));
      if (adoptId) {
        const updated = await itemsService.update(adoptId, {
          ...mapped.input,
          isActive: mapped.active,
        });
        if (updated) {
          ctx.items.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          if (!existingByQbo) {
            logs.push({
              entity: 'Item',
              qboId: mapped.qboId,
              action: 'update',
              message: `Matched existing item "${mapped.name}"`,
              recordId: adoptId,
            });
          }
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Item',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.name}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await itemsService.create(mapped.input);
      if (created) {
        if (!mapped.active) await itemsService.update(created.id, { isActive: false });
        ctx.items.byQboId.set(mapped.qboId, created.id);
        ctx.items.byName.set(nameKey(mapped.name), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Item',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.name,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Item',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.name}"`,
        });
      }
    }

    return { counts, logs };
  },
};

const customersPhase: SyncPhase = {
  key: 'customers',
  label: 'Customers',
  entity: 'Customer',
  pageSize: 1000,
  includeInactive: true,
  async process(records, ctx) {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const termName = (id: string | null) => (id ? (ctx.termNames.get(id) ?? null) : null);

    for (const json of records) {
      const mapped = mapQboCustomer(json, termName);
      if (!mapped.input) {
        counts.failed += 1;
        logs.push({
          entity: 'Customer',
          qboId: mapped.qboId || null,
          action: 'error',
          status: 'error',
          message: mapped.problem,
        });
        continue;
      }

      const existingByQbo = ctx.customers.byQboId.get(mapped.qboId);
      // Adoption is by QBO's unique DisplayName ONLY — email is deliberately not a
      // match key here (the live masters contain shared emails across people).
      const adoptId = existingByQbo ?? ctx.customers.byName.get(nameKey(mapped.displayName));
      if (adoptId) {
        const updated = await customersService.update(adoptId, {
          ...mapped.input,
          isActive: mapped.active,
        });
        if (updated) {
          ctx.customers.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          if (!existingByQbo) {
            logs.push({
              entity: 'Customer',
              qboId: mapped.qboId,
              action: 'update',
              message: `Matched existing customer "${mapped.displayName}"`,
              recordId: adoptId,
            });
          }
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Customer',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.displayName}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await customersService.create(mapped.input);
      if (created) {
        if (!mapped.active) await customersService.update(created.id, { isActive: false });
        ctx.customers.byQboId.set(mapped.qboId, created.id);
        ctx.customers.byName.set(nameKey(mapped.displayName), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Customer',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.displayName,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Customer',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.displayName}"`,
        });
      }
    }

    return { counts, logs };
  },
};

const vendorsPhase: SyncPhase = {
  key: 'vendors',
  label: 'Vendors',
  entity: 'Vendor',
  pageSize: 1000,
  includeInactive: true,
  async process(records, ctx) {
    const counts = zeroCounts();
    const logs: SyncLogLine[] = [];
    const termName = (id: string | null) => (id ? (ctx.termNames.get(id) ?? null) : null);

    for (const json of records) {
      const mapped = mapQboVendor(json, termName);
      if (!mapped.input) {
        counts.failed += 1;
        logs.push({
          entity: 'Vendor',
          qboId: mapped.qboId || null,
          action: 'error',
          status: 'error',
          message: mapped.problem,
        });
        continue;
      }

      const existingByQbo = ctx.vendors.byQboId.get(mapped.qboId);
      const adoptId = existingByQbo ?? ctx.vendors.byName.get(nameKey(mapped.displayName));
      if (adoptId) {
        const updated = await vendorsService.update(adoptId, {
          ...mapped.input,
          isActive: mapped.active,
        });
        if (updated) {
          ctx.vendors.byQboId.set(mapped.qboId, adoptId);
          counts.updated += 1;
          if (!existingByQbo) {
            logs.push({
              entity: 'Vendor',
              qboId: mapped.qboId,
              action: 'update',
              message: `Matched existing vendor "${mapped.displayName}"`,
              recordId: adoptId,
            });
          }
        } else {
          counts.failed += 1;
          logs.push({
            entity: 'Vendor',
            qboId: mapped.qboId,
            action: 'error',
            status: 'error',
            message: `Update failed for "${mapped.displayName}"`,
            recordId: adoptId,
          });
        }
        continue;
      }

      const created = await vendorsService.create(mapped.input);
      if (created) {
        if (!mapped.active) await vendorsService.update(created.id, { isActive: false });
        ctx.vendors.byQboId.set(mapped.qboId, created.id);
        ctx.vendors.byName.set(nameKey(mapped.displayName), created.id);
        counts.created += 1;
        logs.push({
          entity: 'Vendor',
          qboId: mapped.qboId,
          action: 'create',
          message: mapped.displayName,
          recordId: created.id,
        });
      } else {
        counts.failed += 1;
        logs.push({
          entity: 'Vendor',
          qboId: mapped.qboId,
          action: 'error',
          status: 'error',
          message: `Create failed for "${mapped.displayName}"`,
        });
      }
    }

    return { counts, logs };
  },
};

/** Registry, in dependency order. Document/reconcile/verify phases append here. */
export const SYNC_PHASES: SyncPhase[] = [accountsPhase, itemsPhase, customersPhase, vendorsPhase];

// ── Engine ───────────────────────────────────────────────────────────────────

export class QboSyncEngine {
  private ctx: SyncContext | null = null;

  constructor(private readonly runId: string) {}

  /** Process one page of the current phase; persist cursor + tallies; report state. */
  async step(): Promise<SyncStepOutcome> {
    const run = await qboSyncService.getRun(this.runId);
    if (!run) return { state: 'error', run: null, message: 'Sync run not found.' };
    if (run.status !== 'running') return { state: 'stopped', run };

    // Lazy context init (terms lookup + existing-master lookups).
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

    const records = page.data ?? [];
    const outcome = await phase.process(records, this.ctx);
    await qboSyncService.appendLog(run.id, outcome.logs);

    const newProgress = {
      ...run.progress,
      [phase.key]: {
        startPosition: progress.startPosition + records.length,
        done: records.length < phase.pageSize,
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
}

/** Start a new run (full, or incremental from the connection's stored cursor). */
export async function startSyncRun(
  mode: 'full' | 'incremental',
  changedSince: string | null
): Promise<QboImportRun | null> {
  return qboSyncService.createRun(mode, mode === 'incremental' ? changedSince : null);
}
