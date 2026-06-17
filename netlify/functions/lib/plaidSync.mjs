// Plaid → accounting.bank_transactions importer — WorkTrackAccounting bank-feeds backend.
//
// syncItem() pulls new/changed/removed transactions for ONE accounting.plaid_items row via
// Plaid's /transactions/sync cursor API and lands the POSTED ones in
// accounting.bank_transactions, where the existing bank-rules / reconciliation UI takes
// over (the user categorizes; this module never posts to the GL).
//
// Pure ESM, Node 20. The caller passes a service-role Supabase client (RLS-bypassing) — the
// plaid_items / bank_transactions tables are service-role only or audit-gated, exactly as in
// netlify/functions/qbo-oauth.mjs. The Plaid access_token is stored app-layer-ENCRYPTED;
// we decryptSecret() it here and NEVER log it.
//
// KEY DECISIONS (per the task contract):
//   • MVP imports POSTED transactions only — pending ones are skipped (txn.pending === true).
//     Plaid re-emits the same logical transaction as posted (a different transaction_id)
//     once it settles, so nothing is lost; we just wait for the settled row.
//   • SIGN FLIP — Plaid's amount is positive when money LEAVES the account (a debit). Our
//     bank_transactions.amount is positive for a deposit/credit. So we store -txn.amount.
//   • IDEMPOTENT — upsert on the unique (bank_account_id, external_id) with
//     ignoreDuplicates, so re-running a sync (or replaying a cursor) never double-imports.
//   • SAFE REMOVALS — a Plaid "removed" id deletes the feed row ONLY while it is still
//     'unreviewed'/'categorized'. A 'matched'/'excluded' row (the user already reconciled or
//     dismissed it) is left untouched so we never yank a row out from under posted work.

import { decryptSecret } from './tokenCrypto.mjs';
import { transactionsSync } from './plaid.mjs';

// accounting is not the default schema; scope each table explicitly (matches qbo-oauth.mjs).
function acct(supabase, table) {
  return supabase.schema('accounting').from(table);
}

// Open a plaid_sync_runs audit row in 'running'. Returns the row id, or null if the insert
// fails (we still proceed with the import — the audit row is best-effort, not a gate).
async function openSyncRun(supabase, itemId) {
  const { data, error } = await acct(supabase, 'plaid_sync_runs')
    .insert({ plaid_item_id: itemId, status: 'running' })
    .select('id')
    .single();
  if (error) {
    console.error('plaidSync: failed to open sync run:', error.message);
    return null;
  }
  return data?.id || null;
}

// Close the audit row with final status + counts (best-effort).
async function closeSyncRun(supabase, runId, status, counts) {
  if (!runId) return;
  const { error } = await acct(supabase, 'plaid_sync_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      added: counts.added || 0,
      modified: counts.modified || 0,
      removed: counts.removed || 0,
      error: counts.error || null,
    })
    .eq('id', runId);
  if (error) console.error('plaidSync: failed to close sync run:', error.message);
}

// Build a map of Plaid account_id -> bank_accounts.id for the accounts wired to THIS Item.
// Only mapped accounts import; a transaction on an unmapped Plaid account is skipped.
async function buildAccountMap(supabase, itemId) {
  const { data, error } = await acct(supabase, 'bank_accounts')
    .select('id, plaid_account_id')
    .eq('plaid_item_id', itemId);
  if (error) throw new Error(`Failed to load bank accounts: ${error.message}`);

  const map = new Map();
  for (const row of data || []) {
    if (row.plaid_account_id) map.set(row.plaid_account_id, row.id);
  }
  return map;
}

// True for Plaid's "this Item needs re-auth" condition (we then flag plaid_items so the UI
// can prompt a Link UPDATE-mode re-connect).
function isLoginRequired(err) {
  return err?.plaidErrorCode === 'ITEM_LOGIN_REQUIRED';
}

// Import new transactions for ONE plaid_items row. `itemRow` is the full accounting.plaid_items
// record (must include id, access_token, cursor). Returns { added, modified, removed } counts
// of rows actually applied to bank_transactions.
export async function syncItem(supabase, itemRow) {
  const token = decryptSecret(itemRow.access_token);
  if (!token) {
    // Encrypted but unreadable (e.g. TOKEN_ENC_KEY rotated) — fail closed, flag the Item.
    await acct(supabase, 'plaid_items')
      .update({ status: 'error', last_error: 'Access token could not be decrypted' })
      .eq('id', itemRow.id);
    throw new Error('Plaid access token unavailable');
  }

  const runId = await openSyncRun(supabase, itemRow.id);

  // Counts of transactions Plaid reported (for the audit row) — applied rows track the same
  // numbers since we upsert/delete every non-skipped change.
  const counts = { added: 0, modified: 0, removed: 0 };

  try {
    const accountMap = await buildAccountMap(supabase, itemRow.id);

    // ── Page /transactions/sync until has_more is false, accumulating all changes ──
    let cursor = itemRow.cursor || null;
    let nextCursor = cursor;
    const added = [];
    const modified = [];
    const removed = [];

    // Guard against a pathological non-terminating feed (Plaid pages are finite in practice).
    let pages = 0;
    const MAX_PAGES = 1000;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await transactionsSync(token, cursor);
      added.push(...(page.added || []));
      modified.push(...(page.modified || []));
      removed.push(...(page.removed || []));
      nextCursor = page.next_cursor;
      cursor = page.next_cursor;
      pages += 1;
      if (!page.has_more || pages >= MAX_PAGES) break;
    }

    // ── Apply added + modified (posted only) → upsert into bank_transactions ──
    // Both lists are treated identically: an upsert on (bank_account_id, external_id) inserts
    // new rows and is a no-op for rows that already exist (ignoreDuplicates).
    const upserts = [];
    for (const txn of [...added, ...modified]) {
      if (txn.pending === true) continue; // MVP: posted transactions only
      const bankAccountId = accountMap.get(txn.account_id);
      if (!bankAccountId) continue; // account not mapped to a WorkTrack bank account → skip

      upserts.push({
        bank_account_id: bankAccountId,
        txn_date: txn.date,
        // SIGN FLIP: Plaid positive = money out; our convention positive = deposit/credit.
        amount: -txn.amount,
        description: txn.name,
        merchant: txn.merchant_name ?? null,
        external_id: txn.transaction_id,
        status: 'unreviewed',
      });
    }

    if (upserts.length > 0) {
      const { error } = await acct(supabase, 'bank_transactions').upsert(upserts, {
        onConflict: 'bank_account_id,external_id',
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`Failed to upsert transactions: ${error.message}`);
    }
    counts.added = upserts.length;

    // ── Apply removals → delete the feed row only if NOT yet matched/excluded ──
    let removedApplied = 0;
    for (const r of removed) {
      const externalId = r?.transaction_id;
      if (!externalId) continue;
      const { error } = await acct(supabase, 'bank_transactions')
        .delete()
        .eq('external_id', externalId)
        .in('status', ['unreviewed', 'categorized']);
      if (error) throw new Error(`Failed to delete removed transaction: ${error.message}`);
      removedApplied += 1;
    }
    counts.removed = removedApplied;
    // `modified` rows go through the same upsert path; report what Plaid sent for the audit log.
    counts.modified = modified.filter((t) => t.pending !== true).length;

    // ── Success: advance the cursor + connection bookkeeping; close the run 'ok' ──
    const { error: updErr } = await acct(supabase, 'plaid_items')
      .update({
        cursor: nextCursor,
        last_sync_at: new Date().toISOString(),
        status: 'active',
        last_error: null,
      })
      .eq('id', itemRow.id);
    if (updErr) throw new Error(`Failed to persist sync cursor: ${updErr.message}`);

    await closeSyncRun(supabase, runId, 'ok', counts);
    return { added: counts.added, modified: counts.modified, removed: counts.removed };
  } catch (err) {
    // Distinguish "needs re-auth" from a generic failure so the UI can prompt a reconnect.
    const loginRequired = isLoginRequired(err);
    const safeMessage = err?.plaidErrorMessage || err?.message || 'Plaid sync failed';

    const { error: updErr } = await acct(supabase, 'plaid_items')
      .update({
        status: loginRequired ? 'login_required' : 'error',
        last_error: safeMessage,
      })
      .eq('id', itemRow.id);
    if (updErr) console.error('plaidSync: failed to record item error:', updErr.message);

    await closeSyncRun(supabase, runId, 'error', { ...counts, error: safeMessage });

    // Rethrow a SAFE message (Plaid's error_message is non-secret; never leak the token).
    throw new Error(safeMessage);
  }
}
