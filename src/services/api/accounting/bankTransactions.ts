import type {
  BankRule,
  BankTransaction,
  BankTransactionStatus,
  ParsedBankTransaction,
} from '../../../features/accounting/types';
import { buildBankTransactionJournalLines } from '../../../features/accounting/posting';
import { applyRules } from './bankRulesEngine';
import { syntheticExternalId } from './bankImportParsers';
import { acct } from './accountingClient';
import { bankAccountsService } from './bankAccounts';
import { bankRulesService } from './bankRules';
import { journalService } from './journal';
import { mapBankTransactionRow, type Row } from './mappers';

/**
 * Imported bank-feed transactions (accounting.bank_transactions).
 *
 * IMPORT is deduped on (bank_account_id, external_id): rows without a bank-supplied
 * external id get a deterministic synthetic one (syntheticExternalId) so re-importing
 * the same statement inserts nothing new. After inserting, the active bank rules are
 * applied to auto-categorize new rows (stamping category_account_id / applied_rule_id).
 *
 * ACCEPT/CATEGORIZE is the money path: accepting a categorized transaction posts a
 * BALANCED journal entry via journalService.createAndPost (Dr/Cr the category account
 * vs. the bank's GL account, per the sign convention — see
 * buildBankTransactionJournalLines), links matched_journal_entry_id back, and flips
 * status to `matched`. A failed post cleans up after itself (createAndPost voids the
 * half-made draft), and the transaction stays uncategorized so the user can retry.
 *
 * Reads throw; writes return a result object carrying the DB error.
 */

const SELECT_WITH_CATEGORY =
  '*, category:accounts!bank_transactions_category_account_id_fkey(name)';

export interface ImportResult {
  inserted: number;
  duplicates: number;
  autoCategorized: number;
  /** Non-fatal issues (e.g. the insert partially failed). */
  error?: string;
}

export interface BankTransactionFilter {
  status?: BankTransactionStatus;
  /** Only rows not yet cleared into any reconciliation. */
  unclearedOnly?: boolean;
}

export const bankTransactionsService = {
  /** Transactions for a bank account, newest first, optionally filtered by status. */
  async listForAccount(
    bankAccountId: string,
    filter: BankTransactionFilter = {},
    limit = 500
  ): Promise<BankTransaction[]> {
    let q = acct()
      .from('bank_transactions')
      .select(SELECT_WITH_CATEGORY)
      .eq('bank_account_id', bankAccountId)
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.unclearedOnly) q = q.is('reconciliation_id', null);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBankTransactionRow);
  },

  async getById(id: string): Promise<BankTransaction | null> {
    const { data, error } = await acct()
      .from('bank_transactions')
      .select(SELECT_WITH_CATEGORY)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapBankTransactionRow(data as Row);
  },

  /**
   * Import parsed rows into a bank account. Dedups against existing external ids
   * (per account), synthesizing an id for rows the file did not number, then inserts
   * the new rows and auto-categorizes them with the active rules.
   *
   * Dedup happens client-side against the existing ids AND is backstopped by the DB
   * unique constraint — if a concurrent import slips a row in, the unique violation
   * is swallowed per-row by inserting with `ignoreDuplicates`.
   */
  async import(bankAccountId: string, parsed: ParsedBankTransaction[]): Promise<ImportResult> {
    if (parsed.length === 0) return { inserted: 0, duplicates: 0, autoCategorized: 0 };

    // 1) Assign a stable external id to every row (bank id, or synthetic fallback).
    //    The synthetic fallback is salted by a per-natural-key OCCURRENCE ORDINAL —
    //    how many earlier FITID-less rows in this batch share the same natural key —
    //    rather than the row's absolute position. That keeps a stable row's id
    //    unchanged when a re-exported statement prepends/reorders rows (so dedup
    //    holds) while still disambiguating two genuinely identical same-day rows.
    //    The natural key and its normalization MUST match syntheticExternalId.
    const occurrences = new Map<string, number>();
    const withIds = parsed.map((t) => {
      if (t.externalId) return { ...t, externalId: t.externalId };
      const naturalKey = [
        t.txnDate,
        t.amount.toFixed(2),
        (t.description ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
        (t.merchant ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
      ].join('|');
      const ordinal = occurrences.get(naturalKey) ?? 0;
      occurrences.set(naturalKey, ordinal + 1);
      return { ...t, externalId: syntheticExternalId(t, ordinal) };
    });

    // 2) Fetch the account's existing external ids to skip duplicates up front.
    const { data: existingRows, error: exErr } = await acct()
      .from('bank_transactions')
      .select('external_id')
      .eq('bank_account_id', bankAccountId);
    if (exErr) return { inserted: 0, duplicates: 0, autoCategorized: 0, error: exErr.message };
    const existing = new Set(
      ((existingRows ?? []) as Row[]).map((r) => String(r.external_id)).filter((v) => v !== 'null')
    );

    // Also de-dup within this batch (two synthetic ids could collide for identical rows).
    const seen = new Set<string>();
    const toInsert = withIds.filter((t) => {
      const key = t.externalId as string;
      if (existing.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const duplicates = parsed.length - toInsert.length;
    if (toInsert.length === 0) return { inserted: 0, duplicates, autoCategorized: 0 };

    // 3) Auto-categorize via the active rules (account-scoped + global), priority order.
    let autoCategorized = 0;
    let rules: BankRule[];
    try {
      rules = await bankRulesService.listActiveForAccount(bankAccountId);
    } catch {
      rules = [];
    }

    const rows = toInsert.map((t) => {
      const match = rules.length
        ? applyRules(
            { amount: t.amount, description: t.description, merchant: t.merchant, bankAccountId },
            rules
          )
        : null;
      if (match) autoCategorized += 1;
      return {
        bank_account_id: bankAccountId,
        txn_date: t.txnDate,
        amount: t.amount,
        description: t.description ?? null,
        merchant: t.merchant ?? null,
        external_id: t.externalId,
        // A matched rule pre-fills the category and stamps which rule did it; status
        // moves to `categorized` so the user can review before accepting (which posts
        // the JE). Unmatched rows stay `unreviewed`.
        status: match?.setAccountId ? 'categorized' : 'unreviewed',
        category_account_id: match?.setAccountId ?? null,
        vendor_id: match?.setVendorId ?? null,
        applied_rule_id: match?.ruleId ?? null,
      };
    });

    // 4) Insert (ignoreDuplicates makes the unique constraint a no-op on any racer).
    const { data: inserted, error: insErr } = await acct()
      .from('bank_transactions')
      .upsert(rows, { onConflict: 'bank_account_id,external_id', ignoreDuplicates: true })
      .select('id');
    if (insErr) {
      return { inserted: 0, duplicates, autoCategorized: 0, error: insErr.message };
    }
    const insertedCount = (inserted ?? []).length;
    // ignoreDuplicates returns no row for a concurrent racer that collided on the
    // unique constraint, so insertedCount can fall short of toInsert.length. Fold the
    // shortfall into duplicates (those rows genuinely already existed) so the
    // user-facing inserted + duplicates always equals parsed.length.
    const racedDuplicates = toInsert.length - insertedCount;
    return { inserted: insertedCount, duplicates: duplicates + racedDuplicates, autoCategorized };
  },

  /**
   * Re-run the active rules against this account's still-UNREVIEWED transactions and
   * stamp the matches (category_account_id + applied_rule_id, status → categorized).
   * This is what makes a rule created AFTER an import useful: import only auto-
   * categorizes at insert time, so transactions imported earlier need an explicit
   * re-apply once a new rule exists.
   *
   * Touches ONLY rows still `unreviewed` — the `.eq('status','unreviewed')` guard means
   * a row the user categorized / accepted / excluded in the meantime is never
   * overwritten — and posts NO journal entry (it just pre-fills the category for review,
   * exactly like the import path). Returns how many rows it categorized (and the first
   * error, if any row failed to update).
   */
  async applyRulesToUnreviewed(
    bankAccountId: string
  ): Promise<{ categorized: number; error?: string }> {
    let rules: BankRule[];
    try {
      rules = await bankRulesService.listActiveForAccount(bankAccountId);
    } catch (e) {
      return { categorized: 0, error: e instanceof Error ? e.message : 'Could not load rules.' };
    }
    if (rules.length === 0) return { categorized: 0 };

    const unreviewed = await this.listForAccount(bankAccountId, { status: 'unreviewed' });
    let categorized = 0;
    let firstError: string | undefined;
    for (const txn of unreviewed) {
      const match = applyRules(
        { amount: txn.amount, description: txn.description, merchant: txn.merchant, bankAccountId },
        rules
      );
      // Only a rule that assigns a category can pre-fill one (a vendor-only rule has no
      // effect until transactions carry a vendor) — mirrors the import path's behaviour.
      if (!match?.setAccountId) continue;
      const { error } = await acct()
        .from('bank_transactions')
        .update({
          category_account_id: match.setAccountId,
          vendor_id: match.setVendorId ?? null,
          applied_rule_id: match.ruleId ?? null,
          status: 'categorized',
        })
        .eq('id', txn.id)
        .eq('status', 'unreviewed');
      if (error) {
        if (firstError === undefined) firstError = error.message;
        continue;
      }
      categorized += 1;
    }
    return { categorized, error: firstError };
  },

  /**
   * Set (or clear) a transaction's category WITHOUT posting. Moves status to
   * `categorized` when a category is set and the row isn't already matched; clearing
   * the category returns it to `unreviewed`. Manual categorization clears any
   * applied_rule_id stamp (the user overrode the rule).
   */
  async categorize(
    id: string,
    categoryAccountId: string | null
  ): Promise<{ transaction: BankTransaction | null; error?: string }> {
    const txn = await this.getById(id);
    if (!txn) return { transaction: null, error: 'Transaction not found.' };
    if (txn.status === 'matched') {
      return {
        transaction: null,
        error: 'This transaction is already posted. Unmatch it first to recategorize.',
      };
    }
    const { error } = await acct()
      .from('bank_transactions')
      .update({
        category_account_id: categoryAccountId,
        status: categoryAccountId ? 'categorized' : 'unreviewed',
        applied_rule_id: null,
      })
      .eq('id', id);
    if (error) return { transaction: null, error: error.message };
    return { transaction: await this.getById(id) };
  },

  /**
   * Accept a transaction: post its balanced journal entry and mark it `matched`. The
   * category may be supplied here (one-click "categorize & accept") or come from a
   * prior categorize. Posts Dr/Cr the category vs. the bank GL account; on a failed
   * post nothing is mutated and the DB message is surfaced.
   */
  async accept(
    id: string,
    categoryAccountId?: string
  ): Promise<{ transaction: BankTransaction | null; error?: string }> {
    const txn = await this.getById(id);
    if (!txn) return { transaction: null, error: 'Transaction not found.' };
    if (txn.status === 'matched') {
      return { transaction: null, error: 'This transaction is already matched.' };
    }
    if (txn.status === 'excluded') {
      return {
        transaction: null,
        error: 'This transaction is excluded. Un-exclude it before accepting.',
      };
    }
    const category = categoryAccountId ?? txn.categoryAccountId;
    if (!category) {
      return {
        transaction: null,
        error: 'Choose a category account before accepting this transaction.',
      };
    }

    // Resolve the bank account's GL account (the other side of the entry).
    const bankAccount = await bankAccountsService.getById(txn.bankAccountId);
    if (!bankAccount) return { transaction: null, error: 'Bank account not found.' };

    let je;
    try {
      je = buildBankTransactionJournalLines({
        amount: txn.amount,
        bankGlAccountId: bankAccount.accountId,
        categoryAccountId: category,
        memo: txn.description ?? undefined,
      });
    } catch (e) {
      return {
        transaction: null,
        error: e instanceof Error ? e.message : 'Unable to build the entry.',
      };
    }

    const posted = await journalService.createAndPost({
      entryDate: txn.txnDate,
      memo: `Bank: ${txn.description ?? txn.merchant ?? 'transaction'}`,
      sourceType: 'bank_txn',
      sourceId: id,
      lines: je.lines,
    });
    if (!posted.entryId) {
      return { transaction: null, error: posted.error ?? 'Failed to post the journal entry.' };
    }

    const { error: uErr } = await acct()
      .from('bank_transactions')
      .update({
        status: 'matched',
        category_account_id: category,
        matched_journal_entry_id: posted.entryId,
      })
      .eq('id', id);
    if (uErr) {
      // The JE posted but the link failed; void it so no dangling post remains.
      await journalService.voidEntry(posted.entryId, 'Bank transaction match failed after posting');
      return { transaction: null, error: uErr.message };
    }
    return { transaction: await this.getById(id) };
  },

  /**
   * Reverse an accept: void the posted JE and return the transaction to
   * `categorized` (keeping its category) so it can be re-accepted or recategorized.
   */
  async unmatch(
    id: string,
    reason = 'Bank match undone'
  ): Promise<{ transaction: BankTransaction | null; error?: string }> {
    const txn = await this.getById(id);
    if (!txn) return { transaction: null, error: 'Transaction not found.' };
    if (txn.status !== 'matched') {
      return { transaction: null, error: 'Only a matched transaction can be unmatched.' };
    }
    if (txn.matchedJournalEntryId) {
      const v = await journalService.voidEntry(txn.matchedJournalEntryId, reason);
      if (!v.ok) return { transaction: null, error: v.error };
    }
    const { error } = await acct()
      .from('bank_transactions')
      .update({
        status: txn.categoryAccountId ? 'categorized' : 'unreviewed',
        matched_journal_entry_id: null,
      })
      .eq('id', id);
    if (error) return { transaction: null, error: error.message };
    return { transaction: await this.getById(id) };
  },

  /** Exclude a transaction from the books (e.g. an internal transfer / duplicate). */
  async setExcluded(
    id: string,
    excluded: boolean
  ): Promise<{ transaction: BankTransaction | null; error?: string }> {
    const txn = await this.getById(id);
    if (!txn) return { transaction: null, error: 'Transaction not found.' };
    if (txn.status === 'matched') {
      return { transaction: null, error: 'Unmatch this transaction before excluding it.' };
    }
    const nextStatus: BankTransactionStatus = excluded
      ? 'excluded'
      : txn.categoryAccountId
        ? 'categorized'
        : 'unreviewed';
    const { error } = await acct()
      .from('bank_transactions')
      .update({ status: nextStatus })
      .eq('id', id);
    if (error) return { transaction: null, error: error.message };
    return { transaction: await this.getById(id) };
  },
};
