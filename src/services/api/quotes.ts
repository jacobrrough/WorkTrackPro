import type { Quote } from '../../core/types';
import { supabase } from './supabaseClient';

function mapRowToQuote(row: Record<string, unknown>): Quote {
  return {
    id: row.id as string,
    productName: row.product_name as string,
    description: row.description as string | undefined,
    materialCost: (row.material_cost as number) ?? 0,
    laborHours: (row.labor_hours as number) ?? 0,
    laborRate: (row.labor_rate as number) ?? 0,
    laborCost: (row.labor_cost as number) ?? 0,
    markupPercent: (row.markup_percent as number) ?? 0,
    subtotal: (row.subtotal as number) ?? 0,
    markupAmount: (row.markup_amount as number) ?? 0,
    total: (row.total as number) ?? 0,
    lineItems: (row.line_items as Quote['lineItems']) ?? [],
    referenceJobIds: (row.reference_job_ids as string[]) ?? [],
    notes: row.notes as string | undefined,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const quoteService = {
  async getAllQuotes(): Promise<Quote[]> {
    const { data, error } = await supabase
      .from('quotes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapRowToQuote(row as unknown as Record<string, unknown>));
  },

  async getQuoteById(id: string): Promise<Quote | null> {
    const { data, error } = await supabase.from('quotes').select('*').eq('id', id).single();
    if (error || !data) return null;
    return mapRowToQuote(data as unknown as Record<string, unknown>);
  },

  async createQuote(data: Omit<Quote, 'id' | 'createdAt' | 'updatedAt'>): Promise<Quote | null> {
    const row = {
      product_name: data.productName,
      description: data.description ?? '',
      material_cost: data.materialCost,
      labor_hours: data.laborHours,
      labor_rate: data.laborRate,
      labor_cost: data.laborCost,
      markup_percent: data.markupPercent,
      subtotal: data.subtotal,
      markup_amount: data.markupAmount,
      total: data.total,
      line_items: data.lineItems,
      reference_job_ids: data.referenceJobIds ?? [],
      notes: data.notes ?? '',
      created_by: data.createdBy,
    };
    const { data: created, error } = await supabase.from('quotes').insert(row).select('*').single();
    if (error) {
      console.error('Create quote error:', error);
      return null;
    }
    return mapRowToQuote(created as unknown as Record<string, unknown>);
  },

  async updateQuote(id: string, data: Partial<Quote>): Promise<Quote | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.productName !== undefined) row.product_name = data.productName;
    if (data.description !== undefined) row.description = data.description;
    if (data.materialCost !== undefined) row.material_cost = data.materialCost;
    if (data.laborHours !== undefined) row.labor_hours = data.laborHours;
    if (data.laborRate !== undefined) row.labor_rate = data.laborRate;
    if (data.laborCost !== undefined) row.labor_cost = data.laborCost;
    if (data.markupPercent !== undefined) row.markup_percent = data.markupPercent;
    if (data.subtotal !== undefined) row.subtotal = data.subtotal;
    if (data.markupAmount !== undefined) row.markup_amount = data.markupAmount;
    if (data.total !== undefined) row.total = data.total;
    if (data.lineItems !== undefined) row.line_items = data.lineItems;
    if (data.referenceJobIds !== undefined) row.reference_job_ids = data.referenceJobIds;
    if (data.notes !== undefined) row.notes = data.notes;
    const { data: updated, error } = await supabase
      .from('quotes')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.error('Update quote error:', error);
      return null;
    }
    return mapRowToQuote(updated as unknown as Record<string, unknown>);
  },

  async deleteQuote(id: string): Promise<boolean> {
    const { error } = await supabase.from('quotes').delete().eq('id', id);
    return !error;
  },
};
