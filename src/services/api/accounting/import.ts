/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. The import/migration module is FLAG-DARK and
 *     requires CPA and/or security sign-off before it is enabled. NOTHING in this service
 *     posts to the ledger except `commit`, which calls the admin-only DB RPC
 *     accounting.commit_import_batch — the SOLE money path, which posts BALANCED journal
 *     entries via accounting.post_journal_entry (offsets 3050 Opening Balance Equity /
 *     2050 Opening Balance Liabilities). HUMAN MUST VERIFY: account-mapping fidelity, no
 *     double-posting, opening balances reconcile to the source trial balance. The UI
 *     renders the "UNVERIFIED — NOT FOR FILING" banner on every screen + export.
 *
 * Service for the import/migration pipeline (accounting.import_batches / import_staging /
 * import_account_map, migration 20260601000024). Lifecycle:
 *
 *   draft  → createBatch                       (insert the header)
 *          → stageRecords                       (dedup-insert parsed rows)
 *          → seedAccountMap                     (one map row per distinct source account,
 *                                                pre-suggesting a target from the chart)
 *   mapping→ updateAccountMap / updateStagingMapped  (the wizard; a human confirms every map)
 *          → resolveAndPrepare                  (bind each postable row's mapped payload to
 *                                                real account UUIDs via the account map)
 *   ready  → markReady                          (only when the map is complete + all postable
 *                                                rows resolved; opening balances need not yet
 *                                                balance — `reconcile` surfaces that to a human)
 *   commit → commit                             (admin-only RPC; the ONLY ledger write)
 *
 * Reads throw (React Query surfaces failures). Writes return a result object carrying the
 * DB error (matching the existing service convention). DEDUP is by content_hash, backstopped
 * by the DB unique(batch_id, content_hash) via upsert(ignoreDuplicates).
 *
 * RLS (migration 24): read = can_read(), WRITE = accounting_admin only. So every write here
 * (and the commit RPC, which re-checks the role) is admin-gated at the database — a non-admin
 * caller gets an RLS/`insufficient_privilege` error surfaced in the result.
 */
import type {
  ImportAccountMap,
  ImportAccountMapInput,
  ImportBatch,
  ImportCommitResult,
  ImportEntityType,
  ImportParseResult,
  ImportStagingRow,
  MappedJournalEntry,
  MappedOpeningBalance,
  NewImportBatchInput,
  ParsedImportRecord,
  ParsedSourceAccount,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { accountsService } from './accounts';
import {
  accountMapBlockers,
  buildAccountResolution,
  reconcileOpeningBalances,
  resolveJournalEntry,
  resolveOpeningBalance,
  suggestAccountMatch,
  toDbJournalEntry,
  toDbOpeningBalance,
  type OpeningBalanceReconciliation,
} from './importMapping';
import {
  mapImportAccountMapRow,
  mapImportBatchRow,
  mapImportStagingRow,
  type Row,
} from './mappers';

export interface ImportStageResult {
  inserted: number;
  duplicates: number;
  error?: string;
}

export interface ImportResolveResult {
  /** Rows whose mapped payload was successfully bound + written back. */
  resolved: number;
  /** Per-row blockers (source keys with no target) so the wizard can list them. */
  unresolved: Array<{ stagingId: string; entityType: ImportEntityType; keys: string[] }>;
  error?: string;
}

export interface ImportStagingFilter {
  entityType?: ImportEntityType;
  /** Only rows that post money (opening_balance / journal_entry). */
  postableOnly?: boolean;
}

/** The two entity types that actually post at commit. */
const POSTABLE: ImportEntityType[] = ['opening_balance', 'journal_entry'];

export const importService = {
  // ── Batches ──────────────────────────────────────────────────────────────────

  /** All import batches, newest first. */
  async listBatches(limit = 100): Promise<ImportBatch[]> {
    const { data, error } = await acct()
      .from('import_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapImportBatchRow);
  },

  /** One batch header (with a staging row count). */
  async getBatch(id: string): Promise<ImportBatch | null> {
    const { data, error } = await acct()
      .from('import_batches')
      .select('*, staging:import_staging(count)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapImportBatchRow(data as Row);
  },

  /** Create a draft batch header. */
  async createBatch(input: NewImportBatchInput): Promise<{ batch: ImportBatch | null; error?: string }> {
    const { data, error } = await acct()
      .from('import_batches')
      .insert({
        source: input.source,
        source_detail: input.sourceDetail ?? null,
        file_meta: input.fileMeta ?? {},
        opening_balance_date: input.openingBalanceDate ?? null,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error || !data) return { batch: null, error: error?.message ?? 'Failed to create import batch.' };
    return { batch: mapImportBatchRow(data as Row) };
  },

  /** Set a batch's opening-balance "as of" date. */
  async setOpeningBalanceDate(id: string, date: string | null): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('import_batches')
      .update({ opening_balance_date: date, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Discard a batch (terminal off-ramp). Does NOT delete staged rows — keeps the audit. */
  async discardBatch(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('import_batches')
      .update({ status: 'discarded', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Staging (dedup insert) ─────────────────────────────────────────────────────

  /**
   * Insert parsed records into staging, deduped on (batch_id, content_hash). Re-staging the
   * same parsed file is a no-op. Moves the batch to 'mapping' once it has staged rows. The
   * `mapped` candidate (opening-balance / journal-entry, with source KEYS) is stored as-is;
   * it is bound to real account ids later by resolveAndPrepare. No money moves here.
   */
  async stageRecords(batchId: string, records: ParsedImportRecord[]): Promise<ImportStageResult> {
    if (records.length === 0) return { inserted: 0, duplicates: 0 };

    // Drop in-batch duplicate hashes up front (two identical parsed rows).
    const seen = new Set<string>();
    const unique = records.filter((r) => {
      if (seen.has(r.contentHash)) return false;
      seen.add(r.contentHash);
      return true;
    });

    const rows = unique.map((r) => ({
      batch_id: batchId,
      entity_type: r.entityType,
      raw: r.raw,
      mapped: r.mapped ?? null,
      status: r.mapped ? 'mapped' : 'pending',
      content_hash: r.contentHash,
      sort_order: r.sortOrder,
    }));

    const { data, error } = await acct()
      .from('import_staging')
      .upsert(rows, { onConflict: 'batch_id,content_hash', ignoreDuplicates: true })
      .select('id');
    if (error) return { inserted: 0, duplicates: 0, error: error.message };

    const inserted = (data ?? []).length;
    // Advance the batch to 'mapping' (best-effort; ignore if it already moved on).
    await acct()
      .from('import_batches')
      .update({ status: 'mapping', updated_at: new Date().toISOString() })
      .eq('id', batchId)
      .eq('status', 'draft');

    return { inserted, duplicates: records.length - inserted };
  },

  /** Staged rows for a batch, in sort order. */
  async listStaging(batchId: string, filter: ImportStagingFilter = {}, limit = 1000): Promise<ImportStagingRow[]> {
    let q = acct()
      .from('import_staging')
      .select('*')
      .eq('batch_id', batchId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(limit);
    if (filter.entityType) q = q.eq('entity_type', filter.entityType);
    if (filter.postableOnly) q = q.in('entity_type', POSTABLE);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapImportStagingRow);
  },

  /** Set one staging row's `mapped` payload (and mark it mapped). */
  async updateStagingMapped(
    id: string,
    mapped: MappedOpeningBalance | MappedJournalEntry | Record<string, unknown> | null
  ): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('import_staging')
      .update({ mapped, status: mapped ? 'mapped' : 'pending', error: null })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Skip a staging row (it will not post at commit). */
  async setStagingSkipped(id: string, skipped: boolean): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('import_staging')
      .update({ status: skipped ? 'skipped' : 'pending' })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Account-map wizard ─────────────────────────────────────────────────────────

  /**
   * Seed the account-map wizard: one row per distinct source account, pre-suggesting a
   * target from the current chart of accounts (exact number/name, then type-compatible).
   * Idempotent — upsert on (batch_id, source_account_key) with ignoreDuplicates so a
   * re-seed never clobbers a human's edits. A confident ('exact'/'strong') suggestion is
   * pre-set as the target + status 'mapped'; weaker/none are left 'unmapped' for review.
   * Pass the chart explicitly, or omit to have the service fetch it.
   */
  async seedAccountMap(
    batchId: string,
    sourceAccounts: ParsedSourceAccount[],
    chartOverride?: import('../../../features/accounting/types').Account[]
  ): Promise<{ seeded: number; error?: string }> {
    if (sourceAccounts.length === 0) return { seeded: 0 };
    let chart = chartOverride;
    if (!chart) {
      try {
        chart = await accountsService.getAll();
      } catch (e) {
        return { seeded: 0, error: e instanceof Error ? e.message : 'Could not load the chart of accounts.' };
      }
    }

    const rows = sourceAccounts.map((src) => {
      const s = suggestAccountMatch(src, chart!);
      const confident = s.confidence === 'exact' || s.confidence === 'strong';
      return {
        batch_id: batchId,
        source_account_key: src.sourceAccountKey,
        source_account_name: src.sourceAccountName,
        source_account_type: src.sourceAccountType,
        target_account_id: confident ? s.targetAccountId : null,
        status: confident ? 'mapped' : 'unmapped',
      };
    });

    const { data, error } = await acct()
      .from('import_account_map')
      .upsert(rows, { onConflict: 'batch_id,source_account_key', ignoreDuplicates: true })
      .select('id');
    if (error) return { seeded: 0, error: error.message };
    return { seeded: (data ?? []).length };
  },

  /** All account-map rows for a batch. */
  async listAccountMap(batchId: string): Promise<ImportAccountMap[]> {
    const { data, error } = await acct()
      .from('import_account_map')
      .select('*')
      .eq('batch_id', batchId)
      .order('source_account_key', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapImportAccountMapRow);
  },

  /**
   * Patch one account-map row (the wizard's per-account edit). Setting a target marks it
   * 'mapped'; choosing create-as-new keeps target null and marks it 'mapped' too (the
   * commit RPC creates the account). Clearing both returns it to 'unmapped'.
   */
  async updateAccountMap(id: string, patch: ImportAccountMapInput): Promise<{ ok: boolean; error?: string }> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.targetAccountId !== undefined) row.target_account_id = patch.targetAccountId;
    if (patch.createAsNew !== undefined) row.create_as_new = patch.createAsNew;
    if (patch.newAccountNumber !== undefined) row.new_account_number = patch.newAccountNumber;
    if (patch.newAccountType !== undefined) row.new_account_type = patch.newAccountType;
    if (patch.newAccountSubtype !== undefined) row.new_account_subtype = patch.newAccountSubtype;
    if (patch.status !== undefined) {
      row.status = patch.status;
    } else {
      // Derive status from the edit when the caller did not set it explicitly.
      const mapped = patch.targetAccountId || patch.createAsNew;
      row.status = mapped ? 'mapped' : 'unmapped';
    }
    const { error } = await acct().from('import_account_map').update(row).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Resolve + reconcile + ready ─────────────────────────────────────────────────

  /**
   * Bind every POSTABLE staging row's `mapped` payload to real account UUIDs using the
   * account map (source key → target id). Writes the resolved payload back to the row.
   * Rows whose source key has no target are left as-is and reported in `unresolved` so the
   * wizard can show exactly what still needs mapping. Does NOT post anything.
   *
   * NB: create-as-new map rows have no target id until the commit RPC creates the account,
   * so a journal-entry/opening-balance row that references a create-as-new source account
   * cannot be fully resolved here — it is reported as unresolved, and the UI must either
   * map it to an existing account or accept that commit will fail until the account exists.
   * (Opening-balance rows from create-as-new accounts are uncommon; the typical create-as-new
   * target is a brand-new account with no historical balance.)
   */
  async resolveAndPrepare(batchId: string): Promise<ImportResolveResult> {
    let maps: ImportAccountMap[];
    let rows: ImportStagingRow[];
    try {
      maps = await this.listAccountMap(batchId);
      rows = await this.listStaging(batchId, { postableOnly: true });
    } catch (e) {
      return { resolved: 0, unresolved: [], error: e instanceof Error ? e.message : 'Read failed.' };
    }
    const resolution = buildAccountResolution(maps);

    let resolved = 0;
    const unresolved: ImportResolveResult['unresolved'] = [];
    for (const row of rows) {
      if (row.status === 'skipped' || !row.mapped) continue;
      if (row.entityType === 'opening_balance') {
        const r = resolveOpeningBalance(row.mapped as unknown as MappedOpeningBalance, resolution);
        if (!r.mapped) {
          unresolved.push({ stagingId: row.id, entityType: row.entityType, keys: r.unresolvedKeys });
          continue;
        }
        // Persist the SNAKE_CASE shape the commit RPC reads (target_account_id / debit_cents …).
        const { error } = await acct()
          .from('import_staging')
          .update({ mapped: toDbOpeningBalance(r.mapped), status: 'mapped', error: null })
          .eq('id', row.id);
        if (error) return { resolved, unresolved, error: error.message };
        resolved += 1;
      } else if (row.entityType === 'journal_entry') {
        const r = resolveJournalEntry(row.mapped as unknown as MappedJournalEntry, resolution);
        if (!r.mapped) {
          unresolved.push({ stagingId: row.id, entityType: row.entityType, keys: r.unresolvedKeys });
          continue;
        }
        // Persist the SNAKE_CASE shape the commit RPC reads (lines[].account_id / debit_cents …).
        const { error } = await acct()
          .from('import_staging')
          .update({ mapped: toDbJournalEntry(r.mapped), status: 'mapped', error: null })
          .eq('id', row.id);
        if (error) return { resolved, unresolved, error: error.message };
        resolved += 1;
      }
    }
    return { resolved, unresolved };
  },

  /**
   * Reconcile the staged opening balances to the source trial balance, in INTEGER CENTS:
   * Σ target debits vs. Σ target credits and the equity/liability offset plugs the commit
   * will book. `sourceBalances === true` means the source TB balances on its own (the
   * human's key check). Reads the already-resolved (or candidate) opening-balance rows.
   */
  async reconcile(batchId: string): Promise<OpeningBalanceReconciliation> {
    const rows = await this.listStaging(batchId, { entityType: 'opening_balance' });
    const payloads: MappedOpeningBalance[] = rows
      .filter((r) => r.status !== 'skipped' && r.mapped)
      .map((r) => r.mapped as unknown as MappedOpeningBalance);
    return reconcileOpeningBalances(payloads);
  },

  /**
   * Pre-flight a 'ready' transition: returns the blockers preventing commit (incomplete
   * account map, or postable rows with unbound account ids). Empty ⇒ the batch may be
   * marked ready. Pure-ish: it reads, delegates the rules to importMapping, and does not
   * mutate. The opening-balance imbalance is NOT a hard blocker (a human may intentionally
   * let OBE absorb a known difference), but `reconcile` surfaces it for confirmation.
   */
  async readyBlockers(batchId: string): Promise<{ blockers: string[]; error?: string }> {
    try {
      const maps = await this.listAccountMap(batchId);
      const mapBlockers = accountMapBlockers(maps);
      const resolution = buildAccountResolution(maps);
      const rows = await this.listStaging(batchId, { postableOnly: true });
      const rowBlockers: string[] = [];
      for (const row of rows) {
        if (row.status === 'skipped' || !row.mapped) continue;
        if (row.entityType === 'opening_balance') {
          const r = resolveOpeningBalance(row.mapped as unknown as MappedOpeningBalance, resolution);
          if (!r.mapped) rowBlockers.push(`opening balance ${row.id}: ${r.unresolvedKeys.join(', ')}`);
        } else if (row.entityType === 'journal_entry') {
          const r = resolveJournalEntry(row.mapped as unknown as MappedJournalEntry, resolution);
          if (!r.mapped) rowBlockers.push(`journal entry ${row.id}: ${r.unresolvedKeys.join(', ')}`);
        }
      }
      return { blockers: [...mapBlockers, ...rowBlockers] };
    } catch (e) {
      return { blockers: [], error: e instanceof Error ? e.message : 'Read failed.' };
    }
  },

  /**
   * Mark a batch 'ready' to commit. Resolves payloads first (so a 'ready' batch never
   * carries an unbound account id), then checks blockers. Refuses (returns the blockers)
   * if the account map is incomplete or any postable row could not be resolved.
   */
  async markReady(batchId: string): Promise<{ ok: boolean; blockers?: string[]; error?: string }> {
    const prep = await this.resolveAndPrepare(batchId);
    if (prep.error) return { ok: false, error: prep.error };
    const { blockers, error } = await this.readyBlockers(batchId);
    if (error) return { ok: false, error };
    if (blockers.length > 0) return { ok: false, blockers };

    const { error: uErr } = await acct()
      .from('import_batches')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', batchId)
      .in('status', ['mapping', 'draft', 'ready']);
    if (uErr) return { ok: false, error: uErr.message };
    return { ok: true };
  },

  /** Move a 'ready' batch back to 'mapping' (re-open the wizard). */
  async reopenMapping(batchId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('import_batches')
      .update({ status: 'mapping', updated_at: new Date().toISOString() })
      .eq('id', batchId)
      .eq('status', 'ready');
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Commit (the ONLY money path) ─────────────────────────────────────────────────

  /**
   * COMMIT the batch: calls the admin-only accounting.commit_import_batch RPC, which is the
   * SOLE path that touches the ledger. It posts the staged opening balances as ONE balanced
   * journal entry (offsets 3050/2050) and each historical journal-entry row as its own
   * balanced entry, all through accounting.post_journal_entry (whose guard enforces
   * debits = credits + >= 2 lines). Idempotent: committing an already-committed batch
   * returns its stored summary and posts nothing new.
   *
   * Returns a result object: on a DB rejection (unbalanced, missing offset, non-admin, wrong
   * status) `ok` is false and `error` carries the DB message — the whole commit rolled back,
   * so NO half-posted import can exist. Never throws on an expected DB rejection.
   */
  async commit(batchId: string): Promise<ImportCommitResult> {
    const { data, error } = await acct().rpc('commit_import_batch', { p_batch_id: batchId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, summary: normalizeSummary(data) };
  },
};

/** Normalize the jsonb summary the RPC returns to the ImportSummary camelCase shape. */
function normalizeSummary(data: unknown): ImportCommitResult['summary'] {
  const v = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const ids = Array.isArray(v.posted_entry_ids) ? (v.posted_entry_ids as unknown[]).map(String) : undefined;
  const n = (k: string): number | undefined => (typeof v[k] === 'number' ? (v[k] as number) : v[k] == null ? undefined : Number(v[k]));
  return {
    postedEntryIds: ids,
    lines: n('lines'),
    openingBalanceCents: n('openingBalanceCents'),
    accountsCreated: n('accountsCreated'),
    openingBalanceRows: n('openingBalanceRows'),
    journalEntryRows: n('journalEntryRows'),
  };
}

/** Convenience: stage a whole parse result (records + seed the account map) in one call. */
export async function stageParseResult(
  batchId: string,
  parsed: ImportParseResult
): Promise<{ staged: ImportStageResult; accountMap: { seeded: number; error?: string } }> {
  const staged = await importService.stageRecords(batchId, parsed.records);
  const accountMap = await importService.seedAccountMap(batchId, parsed.sourceAccounts);
  return { staged, accountMap };
}
