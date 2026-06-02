import type {
  BankRule,
  NewBankRuleInput,
  UpdateBankRuleInput,
} from '../../../features/accounting/types';
import { validateRule } from './bankRulesEngine';
import { acct } from './accountingClient';
import { mapBankRuleRow, type Row } from './mappers';

/**
 * Auto-categorization rules (accounting.bank_rules). Rules are returned highest
 * `priority` first (then newest) so the pure engine's "first match wins" selection
 * lines up with priority order. The rules engine itself (bankRulesEngine.ts) is what
 * the import/categorize path runs against each transaction; this service is just the
 * CRUD around the rule rows.
 *
 * Reads throw; writes return null on failure (or an `{ error }` for create/update,
 * which validate the rule shape first via the shared validateRule).
 */
export const bankRulesService = {
  /** All rules, or only those scoped to a given bank account plus the global ones. */
  async list(bankAccountId?: string): Promise<BankRule[]> {
    let q = acct()
      .from('bank_rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (bankAccountId) {
      // Account-scoped rules for this account OR global rules (null account).
      q = q.or(`bank_account_id.eq.${bankAccountId},bank_account_id.is.null`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBankRuleRow);
  },

  /** Active rules only, priority-ordered — the set the engine evaluates. */
  async listActiveForAccount(bankAccountId: string): Promise<BankRule[]> {
    const { data, error } = await acct()
      .from('bank_rules')
      .select('*')
      .eq('is_active', true)
      .or(`bank_account_id.eq.${bankAccountId},bank_account_id.is.null`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapBankRuleRow);
  },

  async create(input: NewBankRuleInput): Promise<{ rule: BankRule | null; error?: string }> {
    const invalid = validateRule(input);
    if (invalid) return { rule: null, error: invalid };
    const row = {
      bank_account_id: input.bankAccountId ?? null,
      match_field: input.matchField,
      match_op: input.matchOp,
      match_value: input.matchValue,
      set_account_id: input.setAccountId ?? null,
      set_vendor_id: input.setVendorId ?? null,
      priority: input.priority ?? 0,
    };
    const { data, error } = await acct().from('bank_rules').insert(row).select('*').single();
    if (error || !data) return { rule: null, error: error?.message ?? 'Failed to create rule.' };
    return { rule: mapBankRuleRow(data as Row) };
  },

  async update(id: string, input: UpdateBankRuleInput): Promise<{ rule: BankRule | null; error?: string }> {
    // Validate the merged shape when match fields are being changed.
    if (
      input.matchField !== undefined ||
      input.matchOp !== undefined ||
      input.matchValue !== undefined ||
      input.setAccountId !== undefined ||
      input.setVendorId !== undefined
    ) {
      const existing = await this.getById(id);
      if (!existing) return { rule: null, error: 'Rule not found.' };
      const merged = {
        matchField: input.matchField ?? existing.matchField,
        matchOp: input.matchOp ?? existing.matchOp,
        matchValue: input.matchValue ?? existing.matchValue,
        setAccountId: input.setAccountId !== undefined ? input.setAccountId : existing.setAccountId,
        setVendorId: input.setVendorId !== undefined ? input.setVendorId : existing.setVendorId,
      };
      const invalid = validateRule(merged);
      if (invalid) return { rule: null, error: invalid };
    }
    const row: Record<string, unknown> = {};
    if (input.bankAccountId !== undefined) row.bank_account_id = input.bankAccountId;
    if (input.matchField !== undefined) row.match_field = input.matchField;
    if (input.matchOp !== undefined) row.match_op = input.matchOp;
    if (input.matchValue !== undefined) row.match_value = input.matchValue;
    if (input.setAccountId !== undefined) row.set_account_id = input.setAccountId;
    if (input.setVendorId !== undefined) row.set_vendor_id = input.setVendorId;
    if (input.priority !== undefined) row.priority = input.priority;
    if (input.isActive !== undefined) row.is_active = input.isActive;
    const { data, error } = await acct().from('bank_rules').update(row).eq('id', id).select('*').single();
    if (error || !data) return { rule: null, error: error?.message ?? 'Failed to update rule.' };
    return { rule: mapBankRuleRow(data as Row) };
  },

  async getById(id: string): Promise<BankRule | null> {
    const { data, error } = await acct().from('bank_rules').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapBankRuleRow(data as Row);
  },

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().from('bank_rules').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};
