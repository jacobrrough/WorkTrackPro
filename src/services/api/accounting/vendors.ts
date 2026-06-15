import type { NewVendorInput, Vendor } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapVendorRow, type Row } from './mappers';

/**
 * AP vendor master (accounting.vendors). Symmetric to customersService. Reads throw
 * so React Query surfaces errors; writes return null on failure, matching the
 * existing service convention (cf. customersService / accountsService).
 */
export const vendorsService = {
  async getAll(includeInactive = false): Promise<Vendor[]> {
    let q = acct().from('vendors').select('*').order('display_name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapVendorRow);
  },

  async getById(id: string): Promise<Vendor | null> {
    const { data, error } = await acct().from('vendors').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapVendorRow(data as Row);
  },

  async create(input: NewVendorInput): Promise<Vendor | null> {
    const row = {
      display_name: input.displayName,
      company_name: input.companyName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      terms: input.terms ?? null,
      default_expense_account_id: input.defaultExpenseAccountId ?? null,
      tax_id: input.taxId ?? null,
      is_1099: input.is1099 ?? false,
      notes: input.notes ?? null,
      address: input.address ?? null,
      external_qbo_id: input.externalQboId ?? null,
    };
    const { data, error } = await acct().from('vendors').insert(row).select('*').single();
    if (error || !data) return null;
    return mapVendorRow(data as Row);
  },

  async update(
    id: string,
    input: Partial<NewVendorInput> & { isActive?: boolean }
  ): Promise<Vendor | null> {
    const row: Record<string, unknown> = {};
    if (input.displayName != null) row.display_name = input.displayName;
    if (input.companyName !== undefined) row.company_name = input.companyName;
    if (input.email !== undefined) row.email = input.email;
    if (input.phone !== undefined) row.phone = input.phone;
    if (input.terms !== undefined) row.terms = input.terms;
    if (input.defaultExpenseAccountId !== undefined)
      row.default_expense_account_id = input.defaultExpenseAccountId;
    if (input.taxId !== undefined) row.tax_id = input.taxId;
    if (input.is1099 !== undefined) row.is_1099 = input.is1099;
    if (input.notes !== undefined) row.notes = input.notes;
    if (input.address !== undefined) row.address = input.address;
    if (input.externalQboId !== undefined) row.external_qbo_id = input.externalQboId;
    if (input.isActive !== undefined) row.is_active = input.isActive;
    const { data, error } = await acct()
      .from('vendors')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapVendorRow(data as Row);
  },
};
