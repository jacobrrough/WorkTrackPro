import type { InventoryItem } from '../../core/types';
import { supabase } from './supabaseClient';
import {
  getInventoryImagePublicUrl,
  getAttachmentPublicUrl,
  uploadAttachment,
  deleteAttachmentRecord,
  uploadInventoryImage,
  removeInventoryImage,
} from './storage';

function mapRowToItem(row: Record<string, unknown>): InventoryItem {
  const imagePath = row.image_path as string | null;
  return {
    id: row.id as string,
    name: (row.name as string) ?? '',
    description: row.description as string | undefined,
    category: (row.category as InventoryItem['category']) ?? 'miscSupplies',
    inStock: (row.in_stock as number) ?? 0,
    available: (row.available as number) ?? 0,
    disposed: (row.disposed as number) ?? 0,
    onOrder: (row.on_order as number) ?? 0,
    reorderPoint: row.reorder_point as number | undefined,
    price: row.price as number | undefined,
    unit: (row.unit as string) ?? 'units',
    hasImage: !!(row.has_image && imagePath),
    imageUrl: imagePath ? getInventoryImagePublicUrl(imagePath) : undefined,
    barcode: row.barcode as string | undefined,
    binLocation: row.bin_location as string | undefined,
    vendor: row.vendor as string | undefined,
    currentHolderId: (row.current_holder_id as string) ?? undefined,
    attachmentCount: (row.attachment_count as number) ?? 0,
  };
}

type AttachmentRow = {
  id: string;
  job_id: string | null;
  inventory_id: string | null;
  filename: string;
  storage_path: string;
  is_admin_only: boolean;
  created_at?: string;
};

export interface PaginatedInventoryResult {
  items: InventoryItem[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Outcome of a permanent delete attempt. `ok` true means the row is gone; otherwise `reason`
 * explains why it was refused. `in_use` carries the blocking reference counts so the UI can tell
 * the user exactly what to detach first.
 */
export interface DeleteInventoryResult {
  ok: boolean;
  reason?: 'forbidden' | 'not_found' | 'in_use' | 'error';
  jobCount?: number;
  partCount?: number;
}

export const inventoryService = {
  async getAllInventory(): Promise<InventoryItem[]> {
    const { data, error } = await supabase.from('inventory').select('*').order('name');
    if (error) throw error;
    return (data ?? []).map((row) => mapRowToItem(row as unknown as Record<string, unknown>));
  },

  async getInventoryPaginated(
    page = 1,
    perPage = 50,
    filter?: string,
    sort = 'name'
  ): Promise<PaginatedInventoryResult> {
    let q = supabase.from('inventory').select('*', { count: 'exact' });
    if (filter?.trim()) {
      const f = filter.trim().replace(/[,()\\%*]/g, ' ');
      q = q.or(`name.ilike.%${f}%,description.ilike.%${f}%`);
    }
    const asc = sort === 'name';
    q = q.order(sort === 'name' ? 'name' : 'created_at', { ascending: asc });
    const from = (page - 1) * perPage;
    const { data, error, count } = await q.range(from, from + perPage - 1);
    if (error) throw error;
    const items = (data ?? []).map((row) =>
      mapRowToItem(row as unknown as Record<string, unknown>)
    );
    const totalItems = count ?? 0;
    return { items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) };
  },

  async createInventory(data: Partial<InventoryItem>): Promise<InventoryItem | null> {
    const row: Record<string, unknown> = {
      // Honor a client-supplied PK (offline queue uses it to make create-replay idempotent
      // and to keep the optimistic cache entry's id stable). Omitted otherwise so the DB
      // default assigns one.
      ...(data.id ? { id: data.id } : {}),
      name: data.name ?? '',
      description: data.description ?? null,
      category: data.category ?? 'miscSupplies',
      in_stock: data.inStock ?? 0,
      available: data.available ?? data.inStock ?? 0,
      disposed: data.disposed ?? 0,
      on_order: data.onOrder ?? 0,
      reorder_point: data.reorderPoint ?? null,
      price: data.price ?? null,
      unit: data.unit ?? 'units',
      has_image: data.hasImage ?? false,
      image_path: null as string | null,
      barcode: data.barcode ?? null,
      bin_location: data.binLocation ?? null,
      vendor: data.vendor ?? null,
    };
    const { data: created, error } = await supabase
      .from('inventory')
      .insert(row)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToItem(created as unknown as Record<string, unknown>);
  },

  async updateInventory(id: string, data: Partial<InventoryItem>): Promise<InventoryItem | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name != null) row.name = data.name;
    if (data.description != null) row.description = data.description;
    if (data.category != null) row.category = data.category;
    if (data.inStock != null) row.in_stock = data.inStock;
    if (data.available != null) row.available = data.available;
    if (data.disposed != null) row.disposed = data.disposed;
    if (data.onOrder != null) row.on_order = data.onOrder;
    if ('reorderPoint' in data)
      row.reorder_point = data.reorderPoint && data.reorderPoint > 0 ? data.reorderPoint : null;
    if (data.price != null) row.price = data.price;
    if (data.unit != null) row.unit = data.unit;
    if (data.hasImage != null) row.has_image = data.hasImage;
    if (data.imageUrl != null) row.image_path = data.imageUrl;
    if (data.barcode != null) row.barcode = data.barcode;
    if ('binLocation' in data)
      row.bin_location = (data.binLocation ?? '').toString().trim() || null;
    if (data.vendor != null) row.vendor = data.vendor;
    const { data: updated, error } = await supabase
      .from('inventory')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToItem(updated as unknown as Record<string, unknown>);
  },

  /**
   * Permanently delete an inventory item via the safe-guarded delete_inventory_item RPC. The RPC
   * refuses (without deleting) when the item is allocated to a job or used in a part's BOM, and is
   * admin-only. Returns a structured verdict; a transport/RPC error maps to reason 'error'.
   */
  async deleteInventory(id: string): Promise<DeleteInventoryResult> {
    const { data, error } = await supabase.rpc('delete_inventory_item', { p_id: id });
    if (error) {
      console.error('deleteInventory failed:', error.message);
      return { ok: false, reason: 'error' };
    }
    const row = (data ?? {}) as {
      ok?: boolean;
      reason?: DeleteInventoryResult['reason'];
      job_count?: number;
      part_count?: number;
    };
    return {
      ok: !!row.ok,
      reason: row.reason,
      jobCount: row.job_count,
      partCount: row.part_count,
    };
  },

  async getByIds(ids: string[]): Promise<InventoryItem[]> {
    if (!ids.length) return [];
    const { data, error } = await supabase.from('inventory').select('*').in('id', ids);
    if (error) throw error;
    return (data ?? []).map((row) => mapRowToItem(row as unknown as Record<string, unknown>));
  },

  /**
   * Absolute-value write of in_stock. Use ONLY for a manual stock-count override where
   * the user is declaring the authoritative count (e.g. a physical count / correction) and
   * intentionally overwrites whatever is there. For receive/order/quick-adjust use
   * {@link adjustStock} instead — an absolute write computed from a possibly-stale client
   * cache is a lost-update race against concurrent writers.
   *
   * Floors at 0: a manual count is never negative, and the table-level non-negative CHECK
   * was dropped (migration 20260615000000) to allow intentional negative-on-consume, so we
   * must not silently persist a negative absolute override here.
   */
  async updateStock(id: string, inStock: number): Promise<void> {
    const { error } = await supabase
      .from('inventory')
      .update({ in_stock: Math.max(0, Math.round(inStock)), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  /**
   * Atomically adjust stock by DELTA via the adjust_inventory_stock RPC and return the
   * post-update values. Use for receive/order so two concurrent writers (or a job-status
   * reconciliation racing a receive) don't clobber each other the way an absolute write
   * computed from a stale client cache would. Returns null on error.
   */
  async adjustStock(
    id: string,
    inStockDelta: number,
    onOrderDelta: number
  ): Promise<{ inStock: number; onOrder: number } | null> {
    const { data, error } = await supabase.rpc('adjust_inventory_stock', {
      p_id: id,
      p_in_stock_delta: Math.round(inStockDelta),
      p_on_order_delta: Math.round(onOrderDelta),
    });
    if (error) {
      console.error('adjustStock failed:', error.message);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { in_stock: number; on_order: number }
      | undefined;
    if (!row) return null;
    return { inStock: row.in_stock, onOrder: row.on_order };
  },

  /**
   * Idempotent delta adjustment used by every quick-adjust / order / receive write so
   * the SAME call is safe whether it runs online first-try or as an offline-queue replay.
   * `clientActionId` is recorded in a dedup ledger inside the RPC; a replay of an
   * already-applied action returns `applied: false` and does NOT re-apply the delta
   * (guards the lost-ACK double-deduct). Returns null on error so callers can retry.
   */
  async adjustStockIdempotent(
    id: string,
    inStockDelta: number,
    onOrderDelta: number,
    clientActionId: string
  ): Promise<{ inStock: number; onOrder: number; applied: boolean } | null> {
    const { data, error } = await supabase.rpc('adjust_inventory_stock_idem', {
      p_id: id,
      p_in_stock_delta: Math.round(inStockDelta),
      p_on_order_delta: Math.round(onOrderDelta),
      p_client_action_id: clientActionId,
    });
    if (error) {
      console.error('adjustStockIdempotent failed:', error.message);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { in_stock: number; on_order: number; applied: boolean }
      | undefined;
    if (!row) return null;
    return { inStock: row.in_stock, onOrder: row.on_order, applied: row.applied };
  },

  /** Get inventory item with attachments */
  async getInventoryWithAttachments(id: string): Promise<InventoryItem | null> {
    const { data: item, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !item) return null;

    const { data: attachments } = await supabase
      .from('attachments')
      .select('*')
      .eq('inventory_id', id);

    const mappedItem = mapRowToItem(item as unknown as Record<string, unknown>);
    if (attachments && attachments.length > 0) {
      mappedItem.attachments = attachments.map((a: AttachmentRow) => ({
        id: a.id,
        inventoryId: a.inventory_id!,
        filename: a.filename,
        storagePath: a.storage_path,
        isAdminOnly: a.is_admin_only,
        url: getAttachmentPublicUrl(a.storage_path),
        created: a.created_at,
      }));
      mappedItem.attachmentCount = attachments.length;
    } else {
      mappedItem.attachments = [];
      mappedItem.attachmentCount = 0;
    }
    return mappedItem;
  },

  /** Add attachment to inventory item */
  async addAttachment(inventoryId: string, file: File, isAdminOnly: boolean): Promise<boolean> {
    const result = await uploadAttachment(undefined, inventoryId, undefined, file, isAdminOnly);
    const id = result.id;
    if (!id) return false;
    // Update attachment count
    const { count } = await supabase
      .from('attachments')
      .select('*', { count: 'exact', head: true })
      .eq('inventory_id', inventoryId);
    await supabase
      .from('inventory')
      .update({ attachment_count: count ?? 0 })
      .eq('id', inventoryId);
    return true;
  },

  /**
   * Upload (or replace) an inventory item's photo: push the file to the inventory-images bucket,
   * point image_path/has_image at it, and clean up the previous file. Returns the updated item.
   */
  async setImage(id: string, file: File): Promise<InventoryItem | null> {
    const { data: existing } = await supabase
      .from('inventory')
      .select('image_path')
      .eq('id', id)
      .single();
    const oldPath = (existing?.image_path as string | null) ?? null;

    const newPath = await uploadInventoryImage(id, file);
    if (!newPath) return null;

    const { data: updated, error } = await supabase
      .from('inventory')
      .update({ has_image: true, image_path: newPath, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !updated) {
      await removeInventoryImage(newPath); // roll back the orphaned upload
      return null;
    }
    if (oldPath && oldPath !== newPath) await removeInventoryImage(oldPath);
    return mapRowToItem(updated as unknown as Record<string, unknown>);
  },

  /** Clear an inventory item's photo (revert to the category placeholder) and delete the file. */
  async clearImage(id: string): Promise<InventoryItem | null> {
    const { data: existing } = await supabase
      .from('inventory')
      .select('image_path')
      .eq('id', id)
      .single();
    const oldPath = (existing?.image_path as string | null) ?? null;

    const { data: updated, error } = await supabase
      .from('inventory')
      .update({ has_image: false, image_path: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !updated) return null;
    if (oldPath) await removeInventoryImage(oldPath);
    return mapRowToItem(updated as unknown as Record<string, unknown>);
  },

  /** Delete attachment from inventory item */
  async deleteAttachment(attachmentId: string, inventoryId: string): Promise<boolean> {
    const success = await deleteAttachmentRecord(attachmentId);
    if (!success) return false;
    // Update attachment count
    const { count } = await supabase
      .from('attachments')
      .select('*', { count: 'exact', head: true })
      .eq('inventory_id', inventoryId);
    await supabase
      .from('inventory')
      .update({ attachment_count: count ?? 0 })
      .eq('id', inventoryId);
    return true;
  },
};
