import type { ToolEvent } from '../../core/types';
import { supabase } from './supabaseClient';

// Tools are inventory items in the 'tool' category. Custody (current_holder_id on the inventory
// row) is changed only through these SECURITY DEFINER RPCs, which also append the immutable
// tool_events audit and verify the home bin on put-away. The wrappers return a small result and
// the caller refreshes inventory to pick up the new custody state.

export interface ToolActionResult {
  ok: boolean;
  /** Set when a put-away was rejected: the correct home bin the worker must scan. */
  wrongBin?: string;
  error?: string;
}

export const toolsService = {
  /** Take/use a tool: assigns custody to the caller (checkout, or transfer if held by another). */
  async take(inventoryId: string, notes?: string): Promise<ToolActionResult> {
    const { error } = await supabase.rpc('tool_take', {
      p_inventory_id: inventoryId,
      p_notes: notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Hand a tool off to another employee. */
  async assign(
    inventoryId: string,
    newHolderId: string,
    notes?: string
  ): Promise<ToolActionResult> {
    const { error } = await supabase.rpc('tool_assign', {
      p_inventory_id: inventoryId,
      p_new_holder_id: newHolderId,
      p_notes: notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Put a tool away. The DB enforces that `scannedBin` matches the tool's home bin; on mismatch
   * the result carries `wrongBin` (the correct bin) so the caller can reprompt a scan.
   */
  async putAway(
    inventoryId: string,
    scannedBin: string,
    notes?: string
  ): Promise<ToolActionResult> {
    const { error } = await supabase.rpc('tool_put_away', {
      p_inventory_id: inventoryId,
      p_scanned_bin: scannedBin,
      p_notes: notes ?? null,
    });
    if (error) {
      const msg = error.message ?? '';
      const marker = 'WRONG_BIN:';
      const idx = msg.indexOf(marker);
      if (idx >= 0) return { ok: false, wrongBin: msg.slice(idx + marker.length).trim() };
      return { ok: false, error: msg };
    }
    return { ok: true };
  },

  /** Full custody history for a tool (inventory item), newest first, with actor/holder names. */
  async getToolHistory(inventoryId: string, limit = 100): Promise<ToolEvent[]> {
    const { data, error } = await supabase
      .from('tool_events')
      .select(
        '*, actor:actor_id ( name, initials ), prev:previous_holder_id ( name ), next:new_holder_id ( name )'
      )
      .eq('inventory_id', inventoryId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('getToolHistory failed:', error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      inventoryId: row.inventory_id as string,
      eventType: row.event_type as ToolEvent['eventType'],
      actorId: (row.actor_id as string) ?? undefined,
      actorName: (row.actor as { name?: string } | null)?.name,
      previousHolderId: (row.previous_holder_id as string) ?? undefined,
      previousHolderName: (row.prev as { name?: string } | null)?.name,
      newHolderId: (row.new_holder_id as string) ?? undefined,
      newHolderName: (row.next as { name?: string } | null)?.name,
      bin: (row.bin as string) ?? undefined,
      notes: (row.notes as string) ?? undefined,
      createdAt: row.created_at as string,
    }));
  },
};
