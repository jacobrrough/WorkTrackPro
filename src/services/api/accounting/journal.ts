import type { JournalEntry, NewJournalEntryInput } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapJournalEntryRow, type Row } from './mappers';

/**
 * General-ledger journal operations. Entries are created as draft, then posted via
 * the accounting.post_journal_entry RPC (which enforces debits=credits and >=2
 * lines at the DB). Posted entries are immutable and can only be voided.
 */
export const journalService = {
  async list(limit = 100): Promise<JournalEntry[]> {
    const { data, error } = await acct()
      .from('journal_entries')
      .select('*, lines:journal_lines(id, debit, credit)')
      .order('entry_number', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapJournalEntryRow);
  },

  async getById(id: string): Promise<JournalEntry | null> {
    const { data, error } = await acct()
      .from('journal_entries')
      .select('*, lines:journal_lines(*, account:accounts(name, account_number))')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapJournalEntryRow(data as Row);
  },

  /** Insert a draft entry + its lines. Returns the created (still-draft) entry. */
  async createDraft(
    input: NewJournalEntryInput
  ): Promise<{ entry: JournalEntry | null; error?: string }> {
    const { data: header, error: hErr } = await acct()
      .from('journal_entries')
      .insert({
        entry_date: input.entryDate,
        memo: input.memo ?? null,
        source_type: input.sourceType ?? 'manual',
        source_id: input.sourceId ?? null,
      })
      .select('*')
      .single();
    if (hErr || !header) return { entry: null, error: hErr?.message ?? 'Failed to create entry' };

    const entryId = (header as Row).id as string;
    const lineRows = input.lines.map((l, i) => ({
      journal_entry_id: entryId,
      account_id: l.accountId,
      debit: l.debit,
      credit: l.credit,
      line_memo: l.lineMemo ?? null,
      job_id: l.jobId ?? null,
      customer_id: l.customerId ?? null,
      vendor_id: l.vendorId ?? null,
      // B2 reporting dimensions (nullable). The DB trigger assert_line_dimension_types
      // enforces each id references a dimension of the matching type.
      class_id: l.classId ?? null,
      location_id: l.locationId ?? null,
      department_id: l.departmentId ?? null,
      sort_order: i,
    }));
    const { error: lErr } = await acct().from('journal_lines').insert(lineRows);
    if (lErr) {
      // Best-effort cleanup of the orphan draft header so we don't leave a stub.
      await acct().from('journal_entries').delete().eq('id', entryId);
      return { entry: null, error: lErr.message };
    }
    return { entry: mapJournalEntryRow(header as Row) };
  },

  /** Post a draft entry. The DB enforces balance + >=2 lines; its message is surfaced. */
  async post(entryId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().rpc('post_journal_entry', { p_entry_id: entryId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Create a draft and immediately post it. If posting fails (e.g. unbalanced or
   * RLS), the just-created draft is removed so no orphan drafts accumulate — the
   * caller keeps the user's input and can retry. The DB error message is returned.
   */
  async createAndPost(
    input: NewJournalEntryInput
  ): Promise<{ entryId: string | null; error?: string }> {
    const { entry, error } = await this.createDraft(input);
    if (!entry) return { entryId: null, error };
    const posted = await this.post(entry.id);
    if (!posted.ok) {
      await acct().from('journal_entries').delete().eq('id', entry.id);
      return { entryId: null, error: posted.error };
    }
    return { entryId: entry.id };
  },

  /**
   * Of the given source_ids, which already exist as imported entries? Used by the
   * QuickBooks history importer to stay idempotent — re-running skips transactions
   * it already posted. Queries in batches against the (source_type, source_id) index.
   */
  async existingImportSourceIds(sourceIds: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < sourceIds.length; i += 200) {
      const batch = sourceIds.slice(i, i + 200);
      if (batch.length === 0) continue;
      const { data, error } = await acct()
        .from('journal_entries')
        .select('source_id')
        .eq('source_type', 'import')
        .in('source_id', batch);
      if (error) throw error;
      for (const r of (data ?? []) as { source_id: string | null }[]) {
        if (r.source_id) found.add(r.source_id);
      }
    }
    return found;
  },

  async voidEntry(entryId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().rpc('void_journal_entry', {
      p_entry_id: entryId,
      p_reason: reason,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};
