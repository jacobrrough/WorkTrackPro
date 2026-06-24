import type { Tool, ToolEvent } from '../../core/types';
import { supabase } from './supabaseClient';

function mapRowToTool(row: Record<string, unknown>): Tool {
  return {
    id: row.id as string,
    name: (row.name as string) ?? '',
    toolNumber: (row.tool_number as string) ?? '',
    homeBin: (row.home_bin as string) ?? '',
    description: (row.description as string) ?? undefined,
    status: (row.status as Tool['status']) ?? 'available',
    currentHolderId: (row.current_holder_id as string) ?? undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

export interface ToolActionResult {
  ok: boolean;
  tool?: Tool;
  /** Set when a put-away was rejected: the correct home bin the worker must scan. */
  wrongBin?: string;
  error?: string;
}

function rpcResultToTool(data: unknown): Tool | undefined {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return row ? mapRowToTool(row) : undefined;
}

export const toolsService = {
  async getAllTools(): Promise<Tool[]> {
    const { data, error } = await supabase.from('tools').select('*').order('name');
    if (error) throw error;
    return (data ?? []).map((row) => mapRowToTool(row as unknown as Record<string, unknown>));
  },

  /** Admin-only (RLS-enforced): add a tool to the catalog. */
  async createTool(data: {
    name: string;
    toolNumber: string;
    homeBin: string;
    description?: string;
  }): Promise<Tool | null> {
    const row = {
      name: data.name,
      tool_number: data.toolNumber,
      home_bin: data.homeBin,
      description: data.description ?? null,
    };
    const { data: created, error } = await supabase.from('tools').insert(row).select('*').single();
    if (error) {
      console.error('createTool failed:', error.message);
      return null;
    }
    return mapRowToTool(created as unknown as Record<string, unknown>);
  },

  /** Admin-only (RLS-enforced): edit catalog fields. */
  async updateTool(
    id: string,
    data: Partial<Pick<Tool, 'name' | 'toolNumber' | 'homeBin' | 'description'>>
  ): Promise<Tool | null> {
    const row: Record<string, unknown> = {};
    if (data.name != null) row.name = data.name;
    if (data.toolNumber != null) row.tool_number = data.toolNumber;
    if (data.homeBin != null) row.home_bin = data.homeBin;
    if ('description' in data) row.description = data.description ?? null;
    if (Object.keys(row).length === 0) return null;
    const { data: updated, error } = await supabase
      .from('tools')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.error('updateTool failed:', error.message);
      return null;
    }
    return mapRowToTool(updated as unknown as Record<string, unknown>);
  },

  /** Take/use a tool: assigns custody to the caller (checkout, or transfer if held by another). */
  async take(toolId: string, notes?: string): Promise<ToolActionResult> {
    const { data, error } = await supabase.rpc('tool_take', {
      p_tool_id: toolId,
      p_notes: notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, tool: rpcResultToTool(data) };
  },

  /** Hand a tool off to another employee. */
  async assign(toolId: string, newHolderId: string, notes?: string): Promise<ToolActionResult> {
    const { data, error } = await supabase.rpc('tool_assign', {
      p_tool_id: toolId,
      p_new_holder_id: newHolderId,
      p_notes: notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, tool: rpcResultToTool(data) };
  },

  /**
   * Put a tool away. The DB enforces that `scannedBin` matches the tool's home bin; on mismatch
   * the result carries `wrongBin` (the correct bin) so the caller can reprompt a scan.
   */
  async putAway(toolId: string, scannedBin: string, notes?: string): Promise<ToolActionResult> {
    const { data, error } = await supabase.rpc('tool_put_away', {
      p_tool_id: toolId,
      p_scanned_bin: scannedBin,
      p_notes: notes ?? null,
    });
    if (error) {
      const msg = error.message ?? '';
      const marker = 'WRONG_BIN:';
      const idx = msg.indexOf(marker);
      if (idx >= 0) {
        return { ok: false, wrongBin: msg.slice(idx + marker.length).trim() };
      }
      return { ok: false, error: msg };
    }
    return { ok: true, tool: rpcResultToTool(data) };
  },

  /** Admin-only (RPC-enforced): retire a tool out of service. */
  async retire(toolId: string, notes?: string): Promise<ToolActionResult> {
    const { data, error } = await supabase.rpc('tool_retire', {
      p_tool_id: toolId,
      p_notes: notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, tool: rpcResultToTool(data) };
  },

  /** Full custody history for a tool, newest first, with actor/holder display names. */
  async getToolHistory(toolId: string, limit = 100): Promise<ToolEvent[]> {
    const { data, error } = await supabase
      .from('tool_events')
      .select(
        '*, actor:actor_id ( name, initials ), prev:previous_holder_id ( name ), next:new_holder_id ( name )'
      )
      .eq('tool_id', toolId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('getToolHistory failed:', error.message);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      toolId: row.tool_id as string,
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
