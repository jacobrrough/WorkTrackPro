import type { Account, NewAccountInput } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapAccountRow, type Row } from './mappers';

/**
 * Chart of accounts CRUD against accounting.accounts. Reads throw on error (so
 * React Query surfaces them); writes return null on failure, matching the existing
 * service convention (cf. inventoryService).
 */
export const accountsService = {
  async getAll(): Promise<Account[]> {
    const { data, error } = await acct()
      .from('accounts')
      .select('*')
      .order('account_number', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapAccountRow);
  },

  async getById(id: string): Promise<Account | null> {
    const { data, error } = await acct().from('accounts').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapAccountRow(data as Row);
  },

  async create(input: NewAccountInput): Promise<Account | null> {
    const row = {
      account_number: input.accountNumber ?? null,
      name: input.name,
      account_type: input.accountType,
      account_subtype: input.accountSubtype ?? null,
      parent_account_id: input.parentAccountId ?? null,
      normal_balance: input.normalBalance,
      description: input.description ?? null,
    };
    const { data, error } = await acct().from('accounts').insert(row).select('*').single();
    if (error || !data) return null;
    return mapAccountRow(data as Row);
  },

  async update(id: string, input: Partial<Account>): Promise<Account | null> {
    const row: Record<string, unknown> = {};
    if (input.accountNumber !== undefined) row.account_number = input.accountNumber;
    if (input.name != null) row.name = input.name;
    if (input.accountType != null) row.account_type = input.accountType;
    if (input.accountSubtype !== undefined) row.account_subtype = input.accountSubtype;
    if (input.parentAccountId !== undefined) row.parent_account_id = input.parentAccountId;
    if (input.normalBalance != null) row.normal_balance = input.normalBalance;
    if (input.isActive != null) row.is_active = input.isActive;
    if (input.description !== undefined) row.description = input.description;
    const { data, error } = await acct()
      .from('accounts')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapAccountRow(data as Row);
  },

  /** Soft-disable a non-system account. */
  async setActive(id: string, isActive: boolean): Promise<Account | null> {
    return this.update(id, { isActive });
  },
};
