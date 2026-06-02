import { describe, it, expect } from 'vitest';
import {
  mapImportAccountMapRow,
  mapImportBatchRow,
  mapImportStagingRow,
} from './mappers';
import { mapDefaultAccounts } from './settings';

// HELD / UNVERIFIED — row<->domain mappers for the import tables (migration 24) +
// the openingBalanceLiabilities settings key (migration 23).

describe('mapImportBatchRow', () => {
  it('maps a full row including jsonb file_meta + summary', () => {
    const row = {
      id: 'b1',
      source: 'qbo',
      source_detail: 'qbo_csv',
      status: 'committed',
      file_meta: { name: 'tb.csv', bytes: 1024, rowCount: 12, sha256: 'abc', storagePath: 'imports/x' },
      summary: {
        posted_entry_ids: ['je1', 'je2'],
        lines: 5,
        openingBalanceCents: 1000000,
        accountsCreated: 1,
        openingBalanceRows: 3,
        journalEntryRows: 1,
      },
      opening_balance_date: '2026-01-01',
      committed_at: '2026-06-01T00:00:00Z',
      committed_by: 'u1',
      created_by: 'u1',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
      staging: [{ count: 12 }],
    };
    const b = mapImportBatchRow(row);
    expect(b.id).toBe('b1');
    expect(b.source).toBe('qbo');
    expect(b.sourceDetail).toBe('qbo_csv');
    expect(b.status).toBe('committed');
    expect(b.fileMeta.name).toBe('tb.csv');
    expect(b.fileMeta.rowCount).toBe(12);
    expect(b.fileMeta.storagePath).toBe('imports/x');
    expect(b.summary.postedEntryIds).toEqual(['je1', 'je2']);
    expect(b.summary.openingBalanceCents).toBe(1000000);
    expect(b.summary.journalEntryRows).toBe(1);
    expect(b.openingBalanceDate).toBe('2026-01-01');
    expect(b.stagingCount).toBe(12);
  });

  it('defaults empty jsonb + missing fields safely', () => {
    const b = mapImportBatchRow({ id: 'b2', source: 'csv', status: 'draft' });
    expect(b.fileMeta).toEqual({
      name: undefined,
      bytes: undefined,
      rowCount: undefined,
      sha256: undefined,
      importedShapes: undefined,
      storagePath: undefined,
    });
    expect(b.summary.postedEntryIds).toBeUndefined();
    expect(b.openingBalanceDate).toBeNull();
    expect(b.stagingCount).toBeUndefined();
  });
});

describe('mapImportStagingRow', () => {
  it('maps a mapped opening-balance row', () => {
    const row = {
      id: 's1',
      batch_id: 'b1',
      entity_type: 'opening_balance',
      raw: { account: 'Checking', balance: '10000.00' },
      mapped: { targetAccountId: 'acc-cash', debitCents: 1000000, creditCents: 0, offset: 'equity' },
      status: 'mapped',
      error: null,
      content_hash: 'opening_balance:abc',
      posted_journal_entry_id: null,
      sort_order: 2,
      created_at: '2026-06-01T00:00:00Z',
    };
    const s = mapImportStagingRow(row);
    expect(s.entityType).toBe('opening_balance');
    expect(s.raw).toEqual({ account: 'Checking', balance: '10000.00' });
    expect((s.mapped as Record<string, unknown>).targetAccountId).toBe('acc-cash');
    expect(s.contentHash).toBe('opening_balance:abc');
    expect(s.sortOrder).toBe(2);
  });

  it('keeps mapped null when unmapped, defaults entity type', () => {
    const s = mapImportStagingRow({
      id: 's2',
      batch_id: 'b1',
      entity_type: 'account',
      raw: {},
      mapped: null,
      content_hash: 'account:x',
    });
    expect(s.mapped).toBeNull();
    expect(s.status).toBe('pending');
  });
});

describe('mapImportAccountMapRow', () => {
  it('maps a mapped target row', () => {
    const m = mapImportAccountMapRow({
      id: 'm1',
      batch_id: 'b1',
      source_account_key: '1000',
      source_account_name: 'Checking',
      source_account_type: 'Bank',
      target_account_id: 'acc-cash',
      create_as_new: false,
      new_account_number: null,
      new_account_type: null,
      new_account_subtype: null,
      status: 'mapped',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    });
    expect(m.sourceAccountKey).toBe('1000');
    expect(m.targetAccountId).toBe('acc-cash');
    expect(m.createAsNew).toBe(false);
    expect(m.status).toBe('mapped');
  });

  it('maps a create-as-new row', () => {
    const m = mapImportAccountMapRow({
      id: 'm2',
      batch_id: 'b1',
      source_account_key: 'New Loan',
      source_account_name: 'New Loan',
      source_account_type: 'Long Term Liability',
      target_account_id: null,
      create_as_new: true,
      new_account_number: '2500',
      new_account_type: 'liability',
      new_account_subtype: 'long_term',
      status: 'mapped',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    });
    expect(m.createAsNew).toBe(true);
    expect(m.newAccountType).toBe('liability');
    expect(m.newAccountNumber).toBe('2500');
    expect(m.targetAccountId).toBeNull();
  });
});

describe('mapDefaultAccounts — openingBalanceLiabilities (migration 23)', () => {
  it('maps the new snake_case key', () => {
    const d = mapDefaultAccounts({
      opening_balance_equity: 'acc-3050',
      opening_balance_liabilities: 'acc-2050',
    });
    expect(d.openingBalanceEquity).toBe('acc-3050');
    expect(d.openingBalanceLiabilities).toBe('acc-2050');
  });
  it('defaults to null when absent', () => {
    expect(mapDefaultAccounts({}).openingBalanceLiabilities).toBeNull();
    expect(mapDefaultAccounts(null).openingBalanceLiabilities).toBeNull();
  });
});
