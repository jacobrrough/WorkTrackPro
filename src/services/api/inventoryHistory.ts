import type { InventoryHistoryEntry } from '../../core/types';
import { supabase } from './supabaseClient';

export const inventoryHistoryService = {
  async createHistory(data: {
    inventory: string;
    user: string;
    action: string;
    reason: string;
    previousInStock: number;
    newInStock: number;
    previousAvailable?: number;
    newAvailable?: number;
    changeAmount: number;
    relatedJob?: string;
    relatedPO?: string;
  }): Promise<boolean> {
    const row = {
      inventory_id: data.inventory,
      user_id: data.user,
      action: data.action,
      reason: data.reason,
      previous_in_stock: data.previousInStock,
      new_in_stock: data.newInStock,
      previous_available: data.previousAvailable ?? null,
      new_available: data.newAvailable ?? null,
      change_amount: data.changeAmount,
      related_job_id: data.relatedJob ?? null,
      related_po: data.relatedPO ?? null,
    };
    const { error } = await supabase.from('inventory_history').insert(row);
    if (error) {
      console.error('Failed to create inventory history:', error);
      return false;
    }
    return true;
  },

  async getHistory(inventoryId: string, limit = 50): Promise<InventoryHistoryEntry[]> {
    const { data, error } = await supabase
      .from('inventory_history')
      .select('*, profiles:user_id ( name, initials ), jobs:related_job_id ( name )')
      .eq('inventory_id', inventoryId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('Failed to get inventory history:', error);
      return [];
    }
    return (data ?? []).slice(0, limit).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      inventoryId: row.inventory_id as string,
      userId: row.user_id as string,
      userName: (row.profiles as { name?: string })?.name,
      userInitials: (row.profiles as { initials?: string })?.initials,
      action: row.action as string,
      reason: row.reason as string,
      previousInStock: (row.previous_in_stock as number) ?? 0,
      newInStock: (row.new_in_stock as number) ?? 0,
      previousAvailable: row.previous_available as number | undefined,
      newAvailable: row.new_available as number | undefined,
      changeAmount: (row.change_amount as number) ?? 0,
      relatedJobId: row.related_job_id as string | undefined,
      relatedJobName: (row.jobs as { name?: string })?.name,
      relatedPO: row.related_po as string | undefined,
      createdAt: row.created_at as string,
    }));
  },

  async getAllHistory(limit = 100): Promise<InventoryHistoryEntry[]> {
    const { data, error } = await supabase
      .from('inventory_history')
      .select(
        '*, profiles:user_id ( name, initials ), inventory:inventory_id ( name ), jobs:related_job_id ( name )'
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('Failed to get all inventory history:', error);
      return [];
    }
    return (data ?? []).slice(0, limit).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      inventoryId: row.inventory_id as string,
      userId: row.user_id as string,
      userName: (row.profiles as { name?: string })?.name,
      userInitials: (row.profiles as { initials?: string })?.initials,
      action: row.action as string,
      reason: row.reason as string,
      previousInStock: (row.previous_in_stock as number) ?? 0,
      newInStock: (row.new_in_stock as number) ?? 0,
      previousAvailable: row.previous_available as number | undefined,
      newAvailable: row.new_available as number | undefined,
      changeAmount: (row.change_amount as number) ?? 0,
      relatedJobId: row.related_job_id as string | undefined,
      relatedJobName: (row.jobs as { name?: string })?.name,
      relatedPO: row.related_po as string | undefined,
      createdAt: row.created_at as string,
    }));
  },
};
