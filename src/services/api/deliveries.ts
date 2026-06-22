import type { Delivery, DeliveryLineItem } from '../../core/types';
import { supabase } from './supabaseClient';

function mapDeliveryRow(row: Record<string, unknown>): Delivery {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    deliveryNumber: (row.delivery_number as number) ?? 1,
    deliveredAt: row.delivered_at as string,
    carrier: (row.carrier as string) ?? undefined,
    trackingNumber: (row.tracking_number as string) ?? undefined,
    recipientName: (row.recipient_name as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    lineItems: (row.line_items as DeliveryLineItem[]) ?? [],
    createdBy: (row.created_by as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const deliveryService = {
  async getByJob(jobId: string): Promise<Delivery[]> {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*')
      .eq('job_id', jobId)
      .order('delivery_number', { ascending: true });
    if (error) {
      console.error('deliveryService.getByJob failed:', error.message);
      return [];
    }
    return (data ?? []).map((r) => mapDeliveryRow(r as Record<string, unknown>));
  },

  async create(data: {
    // Optional client-supplied PK so an offline-queued delivery replays idempotently.
    id?: string;
    jobId: string;
    deliveredAt: string;
    carrier?: string;
    trackingNumber?: string;
    recipientName?: string;
    notes?: string;
    lineItems: DeliveryLineItem[];
    createdBy?: string;
  }): Promise<Delivery | null> {
    // delivery_number is computed read-max-then-insert against a UNIQUE (job_id,
    // delivery_number) constraint, so two concurrent creates can collide. Retry on a
    // unique-violation (23505) by re-reading the max, rather than losing the write.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase
        .from('deliveries')
        .select('delivery_number')
        .eq('job_id', data.jobId)
        .order('delivery_number', { ascending: false })
        .limit(1);
      const nextNumber =
        existing && existing.length > 0
          ? ((existing[0] as { delivery_number: number }).delivery_number ?? 0) + 1
          : 1;

      const { data: row, error } = await supabase
        .from('deliveries')
        .insert({
          ...(data.id ? { id: data.id } : {}),
          job_id: data.jobId,
          delivery_number: nextNumber,
          delivered_at: data.deliveredAt,
          carrier: data.carrier ?? null,
          tracking_number: data.trackingNumber ?? null,
          recipient_name: data.recipientName ?? null,
          notes: data.notes ?? null,
          line_items: data.lineItems,
          created_by: data.createdBy ?? null,
        })
        .select()
        .single();
      if (!error && row) {
        return mapDeliveryRow(row as Record<string, unknown>);
      }
      if ((error as { code?: string } | null)?.code === '23505') {
        continue; // a concurrent create took this number; re-read and try again
      }
      console.error('deliveryService.create failed:', error?.message);
      return null;
    }
    console.error('deliveryService.create failed: delivery_number kept colliding');
    return null;
  },

  async update(
    id: string,
    data: Partial<{
      deliveredAt: string;
      carrier: string | null;
      trackingNumber: string | null;
      recipientName: string | null;
      notes: string | null;
      lineItems: DeliveryLineItem[];
    }>
  ): Promise<Delivery | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.deliveredAt !== undefined) updates.delivered_at = data.deliveredAt;
    if (data.carrier !== undefined) updates.carrier = data.carrier;
    if (data.trackingNumber !== undefined) updates.tracking_number = data.trackingNumber;
    if (data.recipientName !== undefined) updates.recipient_name = data.recipientName;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.lineItems !== undefined) updates.line_items = data.lineItems;

    const { data: row, error } = await supabase
      .from('deliveries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error || !row) return null;
    return mapDeliveryRow(row as Record<string, unknown>);
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await supabase.from('deliveries').delete().eq('id', id);
    return !error;
  },
};
