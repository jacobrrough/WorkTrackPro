import type {
  InventoryReconciliationHeader,
  InventoryReconciliationRow,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import {
  mapInventoryReconciliationHeaderRow,
  mapInventoryReconciliationRow,
  type Row,
} from './mappers';

/**
 * Inventory ↔ Accounting reconciliation reads (migration 20260616000004). Surfaces the
 * per-stock-item variance grid and the GL-1300 header tie from two security_invoker views:
 *
 *  • grid()   → accounting.v_inventory_reconciliation: per source_inventory_id, the
 *               operational side (in_stock, price, op_value) vs. the accounting FIFO
 *               valuation (qty_on_hand, asset_value, avg cost), with qty/value variances,
 *               the open pending-reval amount, and exception flags (uncosted, null_price,
 *               negative_stock, qty_mismatch).
 *  • header() → accounting.v_inventory_reconciliation_header: Σ asset_value vs. the LIVE
 *               GL 1300 balance, plus Σ op_value and Σ pending reval — the one-row tie.
 *
 * READ-ONLY: these views read public.inventory read-only and never post. The cost-sync
 * writes + the gated revaluation posting live in the price-history / revaluation services.
 * Reads THROW so React Query surfaces them (module convention).
 */
export const inventoryReconciliationService = {
  /**
   * The reconciliation grid (one row per stock item that exists operationally OR has a
   * FIFO layer). Sorted so the rows that most need attention lead: any exception flag
   * first, then by the absolute value variance descending (the biggest dollar gaps), then
   * by name. Pure presentation ordering — no math is done here (the view computes it all).
   */
  async grid(): Promise<InventoryReconciliationRow[]> {
    const { data, error } = await acct().from('v_inventory_reconciliation').select('*');
    if (error) throw error;
    const rows = ((data ?? []) as Row[]).map(mapInventoryReconciliationRow);
    const flagged = (r: InventoryReconciliationRow): boolean =>
      r.uncosted || r.nullPrice || r.negativeStock || r.qtyMismatch || r.pendingRevalCount > 0;
    return rows.sort((a, b) => {
      const fa = flagged(a) ? 1 : 0;
      const fb = flagged(b) ? 1 : 0;
      if (fa !== fb) return fb - fa; // flagged rows first
      const va = Math.abs(a.valueVariance);
      const vb = Math.abs(b.valueVariance);
      if (va !== vb) return vb - va; // larger dollar gap first
      return a.inventoryName.localeCompare(b.inventoryName);
    });
  },

  /** One stock item's reconciliation row (detail drill-down), or null when absent. */
  async getRowFor(sourceInventoryId: string): Promise<InventoryReconciliationRow | null> {
    const { data, error } = await acct()
      .from('v_inventory_reconciliation')
      .select('*')
      .eq('source_inventory_id', sourceInventoryId)
      .maybeSingle();
    if (error || !data) return null;
    return mapInventoryReconciliationRow(data as Row);
  },

  /**
   * The header tie: Σ accounting asset value vs. the live GL 1300 balance, with Σ
   * operational value and Σ pending reval. One row; null only if the view returns nothing
   * (it always returns a single coalesced-zero row in practice).
   */
  async header(): Promise<InventoryReconciliationHeader | null> {
    const { data, error } = await acct()
      .from('v_inventory_reconciliation_header')
      .select('*')
      .maybeSingle();
    if (error || !data) return null;
    return mapInventoryReconciliationHeaderRow(data as Row);
  },
};
