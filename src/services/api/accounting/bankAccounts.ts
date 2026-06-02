import type {
  BankAccount,
  NewBankAccountInput,
  UpdateBankAccountInput,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapBankAccountRow, type Row } from './mappers';

/**
 * Bank/credit-card accounts (accounting.bank_accounts). Each wraps a GL
 * cash/credit-card account that imported transactions post against. Reads throw so
 * React Query surfaces errors; writes return null on failure, matching the existing
 * service convention (cf. customersService / accountsService).
 *
 * The list/detail reads hydrate the linked GL account (name + number) for display.
 */
const SELECT_WITH_GL = '*, account:accounts(name, account_number)';

export const bankAccountsService = {
  async getAll(includeInactive = false): Promise<BankAccount[]> {
    let q = acct().from('bank_accounts').select(SELECT_WITH_GL).order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBankAccountRow);
  },

  async getById(id: string): Promise<BankAccount | null> {
    const { data, error } = await acct()
      .from('bank_accounts')
      .select(SELECT_WITH_GL)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapBankAccountRow(data as Row);
  },

  async create(input: NewBankAccountInput): Promise<BankAccount | null> {
    const row = {
      name: input.name,
      account_id: input.accountId,
      account_type: input.accountType ?? null,
      institution: input.institution ?? null,
      mask: input.mask ?? null,
      current_balance: input.currentBalance ?? 0,
    };
    const { data, error } = await acct().from('bank_accounts').insert(row).select('*').single();
    if (error || !data) return null;
    // Re-read to hydrate the GL account name for the caller.
    return this.getById((data as Row).id as string);
  },

  async update(id: string, input: UpdateBankAccountInput): Promise<BankAccount | null> {
    const row: Record<string, unknown> = {};
    if (input.name != null) row.name = input.name;
    if (input.accountId !== undefined) row.account_id = input.accountId;
    if (input.accountType !== undefined) row.account_type = input.accountType;
    if (input.institution !== undefined) row.institution = input.institution;
    if (input.mask !== undefined) row.mask = input.mask;
    if (input.currentBalance !== undefined) row.current_balance = input.currentBalance;
    if (input.isActive !== undefined) row.is_active = input.isActive;
    const { error } = await acct().from('bank_accounts').update(row).eq('id', id);
    if (error) return null;
    return this.getById(id);
  },
};
