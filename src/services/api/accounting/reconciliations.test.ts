import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Guards the bank-account scoping added to the clear/unclear writes and the
 * clearedAmounts read: a transaction id that belongs to a *different* bank account
 * must never enter this reconciliation's math. The DB enforces nothing here, so the
 * service scopes every clearing mutation/read with `.eq('bank_account_id', …)` taken
 * from the reconciliation itself. These tests assert that filter is present (and that
 * an unknown reconciliation short-circuits before any write).
 *
 * The Supabase client is faked with a chainable query builder that records the table,
 * the operation, and every `.eq(col, val)` filter applied, then resolves to a
 * configured `{ data, error }`. `.maybeSingle()` routes by table so getById resolves
 * the reconciliation row while bank_transactions returns the cleared rows.
 */

type EqFilter = { col: string; val: unknown };

interface Call {
  table: string;
  op: 'select' | 'update' | 'none';
  updateRow: Record<string, unknown> | null;
  eqs: EqFilter[];
  inFilter: { col: string; vals: unknown[] } | null;
}

let calls: Call[];
// Row returned by reconciliations.maybeSingle() (the getById lookup). null => not found.
let recRow: Record<string, unknown> | null;
// Rows returned by the bank_transactions amount select.
let txnRows: Array<{ amount: unknown }>;

function makeBuilder(table: string) {
  const call: Call = { table, op: 'none', updateRow: null, eqs: [], inFilter: null };
  calls.push(call);
  const builder = {
    select() {
      call.op = 'select';
      return builder;
    },
    update(row: Record<string, unknown>) {
      call.op = 'update';
      call.updateRow = row;
      return builder;
    },
    eq(col: string, val: unknown) {
      call.eqs.push({ col, val });
      return builder;
    },
    in(col: string, vals: unknown[]) {
      call.inFilter = { col, vals };
      return builder;
    },
    maybeSingle() {
      if (table === 'reconciliations') {
        return Promise.resolve({ data: recRow, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // An update chain (no .maybeSingle()) is awaited directly.
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      const data = call.op === 'select' && table === 'bank_transactions' ? txnRows : null;
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock('./accountingClient', () => ({
  acct: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { reconciliationsService } from './reconciliations';

const REC_ID = 'rec-1';
const ACCOUNT_ID = 'acct-1';

beforeEach(() => {
  calls = [];
  recRow = {
    id: REC_ID,
    bank_account_id: ACCOUNT_ID,
    statement_date: '2026-06-01',
    statement_ending_balance: 100,
    beginning_balance: 0,
    status: 'in_progress',
  };
  txnRows = [];
});

/** The bank_transactions write/read call (skips the reconciliations getById lookup). */
function txnCall(): Call | undefined {
  return calls.find((c) => c.table === 'bank_transactions');
}

describe('reconciliationsService bank-account scoping', () => {
  it('setCleared scopes the stamp to the reconciliation account', async () => {
    const res = await reconciliationsService.setCleared(REC_ID, 'txn-9', true);
    expect(res.ok).toBe(true);
    const c = txnCall();
    expect(c?.op).toBe('update');
    expect(c?.eqs).toContainEqual({ col: 'id', val: 'txn-9' });
    expect(c?.eqs).toContainEqual({ col: 'bank_account_id', val: ACCOUNT_ID });
  });

  it('setCleared(false) also scopes the un-stamp to the account', async () => {
    const res = await reconciliationsService.setCleared(REC_ID, 'txn-9', false);
    expect(res.ok).toBe(true);
    const c = txnCall();
    expect(c?.updateRow).toEqual({ reconciliation_id: null, cleared_at: null });
    expect(c?.eqs).toContainEqual({ col: 'bank_account_id', val: ACCOUNT_ID });
  });

  it('setCleared refuses (and writes nothing) when the reconciliation is unknown', async () => {
    recRow = null;
    const res = await reconciliationsService.setCleared(REC_ID, 'txn-9', true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(txnCall()).toBeUndefined();
  });

  it('setClearedMany scopes the batch to the account alongside the id list', async () => {
    const res = await reconciliationsService.setClearedMany(REC_ID, ['a', 'b'], true);
    expect(res.ok).toBe(true);
    const c = txnCall();
    expect(c?.inFilter).toEqual({ col: 'id', vals: ['a', 'b'] });
    expect(c?.eqs).toContainEqual({ col: 'bank_account_id', val: ACCOUNT_ID });
  });

  it('setClearedMany refuses when the reconciliation is unknown', async () => {
    recRow = null;
    const res = await reconciliationsService.setClearedMany(REC_ID, ['a'], true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(txnCall()).toBeUndefined();
  });

  it('setClearedMany is a no-op for an empty id list (no lookup, no write)', async () => {
    const res = await reconciliationsService.setClearedMany(REC_ID, [], true);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('clearedAmounts filters the read by the reconciliation account', async () => {
    txnRows = [{ amount: 10 }, { amount: '-2.5' }];
    const amounts = await reconciliationsService.clearedAmounts(REC_ID);
    expect(amounts).toEqual([10, -2.5]);
    const c = txnCall();
    expect(c?.op).toBe('select');
    expect(c?.eqs).toContainEqual({ col: 'reconciliation_id', val: REC_ID });
    expect(c?.eqs).toContainEqual({ col: 'bank_account_id', val: ACCOUNT_ID });
  });

  it('clearedAmounts uses a passed bankAccountId without an extra reconciliation lookup', async () => {
    txnRows = [{ amount: 5 }];
    const amounts = await reconciliationsService.clearedAmounts(REC_ID, 'acct-explicit');
    expect(amounts).toEqual([5]);
    // Only the bank_transactions read should have happened — no reconciliations lookup.
    expect(calls.some((c) => c.table === 'reconciliations')).toBe(false);
    expect(txnCall()?.eqs).toContainEqual({ col: 'bank_account_id', val: 'acct-explicit' });
  });

  it('clearedAmounts yields nothing for an unknown reconciliation', async () => {
    recRow = null;
    const amounts = await reconciliationsService.clearedAmounts(REC_ID);
    expect(amounts).toEqual([]);
    // Short-circuits before touching bank_transactions.
    expect(txnCall()).toBeUndefined();
  });
});
