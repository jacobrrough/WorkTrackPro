import { describe, it, expect } from 'vitest';
import {
  accountMapBlockers,
  buildAccountResolution,
  normalBalanceForType,
  reconcileOpeningBalances,
  resolveJournalEntry,
  resolveOpeningBalance,
  suggestAccountMatch,
  toDbJournalEntry,
  toDbOpeningBalance,
} from './importMapping';
import type {
  Account,
  ImportAccountMap,
  MappedJournalEntry,
  MappedOpeningBalance,
  ParsedSourceAccount,
} from '../../../features/accounting/types';

// HELD / UNVERIFIED — these prove the SUGGEST + RESOLVE + RECONCILE math the wizard relies
// on. A human still confirms every mapping and the source-TB reconciliation before commit.

function acc(partial: Partial<Account> & { id: string; name: string }): Account {
  return {
    accountNumber: null,
    accountType: 'asset',
    accountSubtype: null,
    parentAccountId: null,
    normalBalance: 'debit',
    currency: 'USD',
    isActive: true,
    isSystem: false,
    description: null,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    ...partial,
  };
}

function srcAcct(
  partial: Partial<ParsedSourceAccount> & { sourceAccountKey: string }
): ParsedSourceAccount {
  return {
    sourceAccountName: partial.sourceAccountName ?? partial.sourceAccountKey,
    sourceAccountType: partial.sourceAccountType ?? null,
    ...partial,
  };
}

describe('suggestAccountMatch', () => {
  const chart: Account[] = [
    acc({ id: 'a1', accountNumber: '1000', name: 'Cash', accountType: 'asset' }),
    acc({
      id: 'a2',
      accountNumber: '2000',
      name: 'Accounts Payable',
      accountType: 'liability',
      normalBalance: 'credit',
    }),
    acc({
      id: 'a3',
      accountNumber: '4000',
      name: 'Sales Income',
      accountType: 'income',
      normalBalance: 'credit',
    }),
    acc({ id: 'a4', name: 'Old Inactive', accountType: 'asset', isActive: false }),
  ];

  it('matches by exact account number first', () => {
    const s = suggestAccountMatch(
      srcAcct({ sourceAccountKey: '1000', sourceAccountName: 'Checking' }),
      chart
    );
    expect(s.targetAccountId).toBe('a1');
    expect(s.confidence).toBe('exact');
  });

  it('matches by normalized name when no number', () => {
    const s = suggestAccountMatch(
      srcAcct({
        sourceAccountKey: 'accounts payable',
        sourceAccountName: 'Accounts Payable',
        sourceAccountType: 'Accounts Payable',
      }),
      chart
    );
    expect(s.targetAccountId).toBe('a2');
    expect(s.confidence).toBe('strong');
  });

  it('weak-matches by substring within the inferred type', () => {
    const s = suggestAccountMatch(
      srcAcct({
        sourceAccountKey: 'Sales',
        sourceAccountName: 'Sales',
        sourceAccountType: 'Income',
      }),
      chart
    );
    expect(s.targetAccountId).toBe('a3');
    expect(s.confidence).toBe('weak');
  });

  it('never suggests an inactive account', () => {
    const s = suggestAccountMatch(
      srcAcct({ sourceAccountKey: 'Old Inactive', sourceAccountName: 'Old Inactive' }),
      chart
    );
    expect(s.targetAccountId).toBeNull();
  });

  it('returns none + an inferred type for a create-as-new default', () => {
    const s = suggestAccountMatch(
      srcAcct({
        sourceAccountKey: 'Mystery',
        sourceAccountName: 'Mystery',
        sourceAccountType: 'Credit Card',
      }),
      chart
    );
    expect(s.targetAccountId).toBeNull();
    expect(s.confidence).toBe('none');
    expect(s.inferredType).toBe('liability');
  });
});

describe('buildAccountResolution', () => {
  it('maps source keys to target ids, skipping ignored + unmapped', () => {
    const maps: ImportAccountMap[] = [
      mapRow({ sourceAccountKey: '1000', targetAccountId: 'a1', status: 'mapped' }),
      mapRow({ sourceAccountKey: '2000', targetAccountId: null, status: 'unmapped' }),
      mapRow({ sourceAccountKey: '9999', targetAccountId: 'aX', status: 'ignored' }),
    ];
    const res = buildAccountResolution(maps);
    expect(res.get('1000')).toBe('a1');
    expect(res.has('2000')).toBe(false);
    expect(res.has('9999')).toBe(false);
  });
});

describe('resolveOpeningBalance', () => {
  const resolution = new Map<string, string>([['1000', 'acc-cash']]);

  it('binds targetAccountId from the source key', () => {
    const candidate: MappedOpeningBalance = {
      targetAccountId: '',
      debitCents: 10000,
      creditCents: 0,
      offset: 'equity',
      sourceAccountKey: '1000',
    };
    const r = resolveOpeningBalance(candidate, resolution);
    expect(r.mapped?.targetAccountId).toBe('acc-cash');
    expect(r.unresolvedKeys).toEqual([]);
  });

  it('honors a directly-set targetAccountId', () => {
    const candidate: MappedOpeningBalance = {
      targetAccountId: 'acc-direct',
      debitCents: 500,
      creditCents: 0,
      sourceAccountKey: 'unmapped-key',
    };
    const r = resolveOpeningBalance(candidate, resolution);
    expect(r.mapped?.targetAccountId).toBe('acc-direct');
  });

  it('reports the unresolved key when nothing binds', () => {
    const candidate: MappedOpeningBalance = {
      targetAccountId: '',
      debitCents: 100,
      creditCents: 0,
      sourceAccountKey: 'no-such',
    };
    const r = resolveOpeningBalance(candidate, resolution);
    expect(r.mapped).toBeNull();
    expect(r.unresolvedKeys).toEqual(['no-such']);
  });

  it('defaults the offset to equity', () => {
    const candidate: MappedOpeningBalance = {
      targetAccountId: 'x',
      debitCents: 1,
      creditCents: 0,
      sourceAccountKey: null,
    };
    expect(resolveOpeningBalance(candidate, resolution).mapped?.offset).toBe('equity');
  });
});

describe('resolveJournalEntry', () => {
  const resolution = new Map<string, string>([
    ['Checking', 'acc-cash'],
    ['Sales', 'acc-sales'],
  ]);

  it('binds every line accountId from its source key', () => {
    const candidate: MappedJournalEntry = {
      memo: 'JE',
      lines: [
        { accountId: '', debitCents: 25000, creditCents: 0, sourceAccountKey: 'Checking' },
        { accountId: '', debitCents: 0, creditCents: 25000, sourceAccountKey: 'Sales' },
      ],
    };
    const r = resolveJournalEntry(candidate, resolution);
    expect(r.unresolvedKeys).toEqual([]);
    expect(r.mapped?.lines[0].accountId).toBe('acc-cash');
    expect(r.mapped?.lines[1].accountId).toBe('acc-sales');
  });

  it('collects ALL unresolved keys', () => {
    const candidate: MappedJournalEntry = {
      memo: 'JE',
      lines: [
        { accountId: '', debitCents: 1, creditCents: 0, sourceAccountKey: 'Missing1' },
        { accountId: '', debitCents: 0, creditCents: 1, sourceAccountKey: 'Missing2' },
      ],
    };
    const r = resolveJournalEntry(candidate, resolution);
    expect(r.mapped).toBeNull();
    expect(r.unresolvedKeys).toEqual(['Missing1', 'Missing2']);
  });
});

describe('reconcileOpeningBalances', () => {
  it('reports a balanced source TB and the equity plug', () => {
    // Cash 10000 Dr, AP 4000 Cr, OBE 6000 Cr (all offset to equity here for the example).
    const rows: MappedOpeningBalance[] = [
      { targetAccountId: 'cash', debitCents: 1000000, creditCents: 0, offset: 'equity' },
      { targetAccountId: 'ap', debitCents: 0, creditCents: 400000, offset: 'equity' },
      { targetAccountId: 'obe', debitCents: 0, creditCents: 600000, offset: 'equity' },
    ];
    const r = reconcileOpeningBalances(rows);
    expect(r.totalDebitCents).toBe(1000000);
    expect(r.totalCreditCents).toBe(1000000);
    expect(r.sourceBalances).toBe(true);
    expect(r.sourceImbalanceCents).toBe(0);
    // Source already balances → the equity bucket nets to zero → no plug needed.
    expect(r.plugs).toEqual([]);
    expect(r.entryBalances).toBe(true);
  });

  it('computes the offset plug when only the assets are imported (equity absorbs)', () => {
    // Just Cash 10000 Dr offset to equity: the plug credits OBE 10000 so the entry balances.
    const rows: MappedOpeningBalance[] = [
      { targetAccountId: 'cash', debitCents: 1000000, creditCents: 0, offset: 'equity' },
    ];
    const r = reconcileOpeningBalances(rows);
    expect(r.sourceBalances).toBe(false); // target lines alone don't balance
    expect(r.sourceImbalanceCents).toBe(1000000);
    expect(r.plugs).toHaveLength(1);
    expect(r.plugs[0]).toEqual({ offset: 'equity', debitCents: 0, creditCents: 1000000 });
    expect(r.entryBalances).toBe(true); // with the plug, the whole entry balances
  });

  it('splits plugs across equity and liability buckets', () => {
    const rows: MappedOpeningBalance[] = [
      { targetAccountId: 'cash', debitCents: 1000000, creditCents: 0, offset: 'equity' },
      { targetAccountId: 'loan', debitCents: 0, creditCents: 400000, offset: 'liability' },
    ];
    const r = reconcileOpeningBalances(rows);
    // equity bucket net = +10000 (debit excess) → credit plug 10000 to 3050.
    // liability bucket net = -4000 (credit excess) → debit plug 4000 to 2050.
    const equity = r.plugs.find((p) => p.offset === 'equity')!;
    const liab = r.plugs.find((p) => p.offset === 'liability')!;
    expect(equity).toEqual({ offset: 'equity', debitCents: 0, creditCents: 1000000 });
    expect(liab).toEqual({ offset: 'liability', debitCents: 400000, creditCents: 0 });
    expect(r.entryBalances).toBe(true);
  });
});

describe('accountMapBlockers', () => {
  it('flags unmapped + create-as-new-without-type, skips ignored + complete', () => {
    const maps: ImportAccountMap[] = [
      mapRow({ sourceAccountKey: 'ok', targetAccountId: 'a1', status: 'mapped' }),
      mapRow({ sourceAccountKey: 'ignored', status: 'ignored' }),
      mapRow({ sourceAccountKey: 'missing', targetAccountId: null, status: 'unmapped' }),
      mapRow({
        sourceAccountKey: 'newNoType',
        createAsNew: true,
        newAccountType: null,
        status: 'mapped',
      }),
      mapRow({
        sourceAccountKey: 'newOk',
        createAsNew: true,
        newAccountType: 'asset',
        status: 'mapped',
      }),
    ];
    const blockers = accountMapBlockers(maps);
    expect(blockers.some((b) => b.includes('missing'))).toBe(true);
    expect(blockers.some((b) => b.includes('newNoType'))).toBe(true);
    expect(blockers.some((b) => b.includes('ok'))).toBe(false);
    expect(blockers.some((b) => b.includes('ignored'))).toBe(false);
    expect(blockers.some((b) => b.includes('newOk'))).toBe(false);
  });
});

describe('toDbOpeningBalance / toDbJournalEntry (camelCase → snake_case the RPC reads)', () => {
  it('renames opening-balance keys to snake_case exactly', () => {
    const db = toDbOpeningBalance({
      targetAccountId: 'acc-cash',
      debitCents: 1000000,
      creditCents: 0,
      offset: 'liability',
      memo: 'm',
      customerId: 'c1',
      vendorId: null,
      jobId: 'j1',
    });
    // These are the EXACT keys accounting.commit_import_batch reads (migration 24).
    expect(db).toEqual({
      target_account_id: 'acc-cash',
      debit_cents: 1000000,
      credit_cents: 0,
      offset: 'liability',
      memo: 'm',
      customer_id: 'c1',
      vendor_id: null,
      job_id: 'j1',
    });
  });

  it('defaults the offset and nullable fields', () => {
    const db = toDbOpeningBalance({ targetAccountId: 'x', debitCents: 1, creditCents: 0 });
    expect(db.offset).toBe('equity');
    expect(db.customer_id).toBeNull();
    expect(db.memo).toBeNull();
  });

  it('renames journal-entry line keys to snake_case (account_id …)', () => {
    const db = toDbJournalEntry({
      memo: 'JE',
      lines: [
        { accountId: 'acc-cash', debitCents: 25000, creditCents: 0, memo: 'd', customerId: 'c1' },
        { accountId: 'acc-sales', debitCents: 0, creditCents: 25000 },
      ],
    });
    expect(db.lines[0]).toEqual({
      account_id: 'acc-cash',
      debit_cents: 25000,
      credit_cents: 0,
      memo: 'd',
      customer_id: 'c1',
      vendor_id: null,
      job_id: null,
    });
    expect(db.lines[1].account_id).toBe('acc-sales');
    expect(db.lines[1].credit_cents).toBe(25000);
  });
});

describe('resolve is idempotent across casings (the load-bearing fix)', () => {
  const resolution = new Map<string, string>([['1000', 'acc-cash']]);

  it('re-resolves an already-snake_case opening balance without losing amounts', () => {
    // Simulate a row already persisted in snake_case by a prior resolve pass.
    const snake = {
      target_account_id: 'acc-cash',
      debit_cents: 1000000,
      credit_cents: 0,
      offset: 'equity',
    };
    const r = resolveOpeningBalance(snake, resolution);
    expect(r.mapped).not.toBeNull();
    expect(r.mapped?.targetAccountId).toBe('acc-cash');
    expect(r.mapped?.debitCents).toBe(1000000);
    expect(r.unresolvedKeys).toEqual([]);
  });

  it('re-resolves an already-snake_case journal entry', () => {
    const snake = {
      memo: 'JE',
      lines: [
        { account_id: 'acc-cash', debit_cents: 25000, credit_cents: 0 },
        { account_id: 'acc-sales', debit_cents: 0, credit_cents: 25000 },
      ],
    };
    const r = resolveJournalEntry(snake, resolution);
    expect(r.mapped?.lines[0].accountId).toBe('acc-cash');
    expect(r.mapped?.lines[0].debitCents).toBe(25000);
    expect(r.mapped?.lines[1].accountId).toBe('acc-sales');
  });

  it('reconciles snake_case rows too', () => {
    const rows = [
      { target_account_id: 'cash', debit_cents: 1000000, credit_cents: 0, offset: 'equity' },
      { target_account_id: 'loan', debit_cents: 0, credit_cents: 400000, offset: 'liability' },
    ];
    const rec = reconcileOpeningBalances(rows);
    expect(rec.totalDebitCents).toBe(1000000);
    expect(rec.totalCreditCents).toBe(400000);
    expect(rec.plugs.find((p) => p.offset === 'liability')?.debitCents).toBe(400000);
  });
});

describe('normalBalanceForType', () => {
  it('matches the DB create-as-new normal-balance derivation', () => {
    expect(normalBalanceForType('asset')).toBe('debit');
    expect(normalBalanceForType('expense')).toBe('debit');
    expect(normalBalanceForType('liability')).toBe('credit');
    expect(normalBalanceForType('equity')).toBe('credit');
    expect(normalBalanceForType('income')).toBe('credit');
  });
});

function mapRow(
  partial: Partial<ImportAccountMap> & { sourceAccountKey: string }
): ImportAccountMap {
  return {
    id: `m-${partial.sourceAccountKey}`,
    batchId: 'b1',
    sourceAccountName: partial.sourceAccountKey,
    sourceAccountType: null,
    targetAccountId: null,
    createAsNew: false,
    newAccountNumber: null,
    newAccountType: null,
    newAccountSubtype: null,
    status: 'unmapped',
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    ...partial,
  };
}
