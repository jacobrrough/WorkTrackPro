/**
 * Shared types + small helpers for the QBO sync engine and its phase modules.
 * (Kept free of phase implementations so the engine, the master phases, and the
 * document phases can all import from here without cycles.)
 */
import type { QboEntityName, QboJson } from '../../../../services/api/accounting/qboSync';
import type { DefaultAccounts, QboEntityCounts, QboLogAction } from '../../types';

export interface SyncLogLine {
  entity: string;
  qboId?: string | null;
  action: QboLogAction;
  status?: 'ok' | 'error';
  message?: string | null;
  recordId?: string | null;
}

export interface PageOutcome {
  counts: QboEntityCounts;
  logs: SyncLogLine[];
}

/** What the items lookup carries — document lines resolve their GL accounts off this. */
export interface SyncItemInfo {
  id: string;
  itemType: string;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  inventoryAssetAccountId: string | null;
}

export interface AccountLookup {
  byQboId: Map<string, string>;
  byNumber: Map<string, string>;
  byName: Map<string, string>;
}

export interface PartyLookup {
  byQboId: Map<string, string>;
  byName: Map<string, string>;
}

export interface ItemLookup {
  byQboId: Map<string, SyncItemInfo>;
  byName: Map<string, string>;
}

/** Synced documents already in our tables (idempotency + cross-doc resolution). */
export interface DocLookup {
  /** invoice QBO id → our row id (payments + estimate conversion links resolve here). */
  invoices: Map<string, string>;
  /** bill QBO id → our row id (bill payments resolve here). */
  bills: Map<string, string>;
  estimates: Map<string, string>;
  payments: Set<string>;
  vendorPayments: Set<string>;
  /** source_ids of already-posted completeness JEs (source_type='qbo'). */
  qboJeSourceIds: Set<string>;
}

export interface SyncContext {
  termNames: Map<string, string>;
  defaults: DefaultAccounts;
  accounts: AccountLookup;
  items: ItemLookup;
  customers: PartyLookup;
  vendors: PartyLookup;
  docs: DocLookup;
}

export interface SyncPhase {
  key: string;
  label: string;
  /** QBO entity this phase pulls, or null for LOCAL phases (no Intuit query). */
  entity: QboEntityName | null;
  pageSize: number;
  /** Masters opt in to inactive records (historical docs reference retired parties). */
  includeInactive: boolean;
  /** Local phases run process() once with no records (e.g. the reconcile void). */
  local?: boolean;
  /** Gated phases pause the run for explicit user approval before executing. */
  gated?: boolean;
  process(records: QboJson[], ctx: SyncContext): Promise<PageOutcome>;
}

export const zeroCounts = (): QboEntityCounts => ({
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
});

export const addCounts = (a: QboEntityCounts, b: QboEntityCounts): QboEntityCounts => ({
  created: a.created + b.created,
  updated: a.updated + b.updated,
  skipped: a.skipped + b.skipped,
  failed: a.failed + b.failed,
});

export const nameKey = (s: string): string => s.trim().toLowerCase();
