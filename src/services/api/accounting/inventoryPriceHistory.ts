import type { InventoryPriceHistoryEntry } from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { mapInventoryPriceHistoryRow, type Row } from './mappers';

/**
 * Read-only feed of per-unit COST changes (migration 20260616000003). The append-only
 * public.inventory_price_history table records every price change on a stock item with its
 * source (manual UI edit, bill receipt, opening seed, or a revaluation post). The table is
 * written ONLY by the DB trigger; the app reads it read-only.
 *
 * ISOLATION NOTE (G4): public.inventory_price_history lives in the PUBLIC schema (it is the
 * single authorized public write-seam for cost sync), so it is read via the DEFAULT
 * supabase client — NOT the accounting-scoped acct() client. RLS (is_approved_user) gates
 * the rows. This is the same pattern the COGS service uses to read public.jobs read-only.
 *
 * Reads THROW so React Query surfaces them (module convention).
 */
export const inventoryPriceHistoryService = {
  /**
   * Price-change history for one stock item (newest first) — the per-item detail feed.
   * Returns [] when the item has never had a recorded cost change.
   */
  async listForInventory(inventoryId: string, limit = 100): Promise<InventoryPriceHistoryEntry[]> {
    const { data, error } = await supabase
      .from('inventory_price_history')
      .select('*')
      .eq('inventory_id', inventoryId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInventoryPriceHistoryRow);
  },

  /**
   * The most recent cost changes across ALL stock items (newest first) — the global
   * price-change activity feed for the reconciliation screen. Optionally filtered to one
   * source (e.g. only 'bill'-driven changes).
   */
  async listRecent(
    limit = 200,
    source?: InventoryPriceHistoryEntry['source']
  ): Promise<InventoryPriceHistoryEntry[]> {
    let q = supabase
      .from('inventory_price_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (source) q = q.eq('source', source);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapInventoryPriceHistoryRow);
  },
};
