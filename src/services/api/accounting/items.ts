import type { Item, NewItemInput } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapItemRow, type Row } from './mappers';

/**
 * Products & services master (accounting.items) — sellable/purchasable things mapped
 * to income/expense/inventory-asset accounts. First consumed by the QuickBooks sync
 * (Phase 1 masters); invoice/bill line item pickers read it too. Reads throw so React
 * Query surfaces errors; writes return null on failure (module convention).
 */
export const itemsService = {
  async getAll(includeInactive = false): Promise<Item[]> {
    let q = acct().from('items').select('*').order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapItemRow);
  },

  async getById(id: string): Promise<Item | null> {
    const { data, error } = await acct().from('items').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return mapItemRow(data as Row);
  },

  async create(input: NewItemInput): Promise<Item | null> {
    const row = {
      name: input.name,
      sku: input.sku ?? null,
      item_type: input.itemType ?? 'service',
      income_account_id: input.incomeAccountId ?? null,
      expense_account_id: input.expenseAccountId ?? null,
      inventory_asset_account_id: input.inventoryAssetAccountId ?? null,
      default_tax_code_id: input.defaultTaxCodeId ?? null,
      sales_price: input.salesPrice ?? null,
      purchase_cost: input.purchaseCost ?? null,
      source_inventory_id: input.sourceInventoryId ?? null,
      source_part_id: input.sourcePartId ?? null,
      external_qbo_id: input.externalQboId ?? null,
    };
    const { data, error } = await acct().from('items').insert(row).select('*').single();
    if (error || !data) return null;
    return mapItemRow(data as Row);
  },

  async update(
    id: string,
    input: Partial<NewItemInput> & { isActive?: boolean }
  ): Promise<Item | null> {
    const row: Record<string, unknown> = {};
    if (input.name != null) row.name = input.name;
    if (input.sku !== undefined) row.sku = input.sku;
    if (input.itemType !== undefined) row.item_type = input.itemType;
    if (input.incomeAccountId !== undefined) row.income_account_id = input.incomeAccountId;
    if (input.expenseAccountId !== undefined) row.expense_account_id = input.expenseAccountId;
    if (input.inventoryAssetAccountId !== undefined)
      row.inventory_asset_account_id = input.inventoryAssetAccountId;
    if (input.defaultTaxCodeId !== undefined) row.default_tax_code_id = input.defaultTaxCodeId;
    if (input.salesPrice !== undefined) row.sales_price = input.salesPrice;
    if (input.purchaseCost !== undefined) row.purchase_cost = input.purchaseCost;
    if (input.sourceInventoryId !== undefined) row.source_inventory_id = input.sourceInventoryId;
    if (input.sourcePartId !== undefined) row.source_part_id = input.sourcePartId;
    if (input.externalQboId !== undefined) row.external_qbo_id = input.externalQboId;
    if (input.isActive !== undefined) row.is_active = input.isActive;
    const { data, error } = await acct()
      .from('items')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapItemRow(data as Row);
  },
};
