import type { InventoryItem } from '../../core/types';
import { supabase } from './supabaseClient';
import {
  getInventoryImagePublicUrl,
  getAttachmentPublicUrl,
  uploadAttachment,
  deleteAttachmentRecord,
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
      const f = filter.trim();
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
    const row = {
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
    if (data.reorderPoint != null) row.reorder_point = data.reorderPoint;
    if (data.price != null) row.price = data.price;
    if (data.unit != null) row.unit = data.unit;
    if (data.hasImage != null) row.has_image = data.hasImage;
    if (data.imageUrl != null) row.image_path = data.imageUrl;
    if (data.barcode != null) row.barcode = data.barcode;
    if (data.binLocation != null) row.bin_location = data.binLocation;
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

  async updateStock(id: string, inStock: number): Promise<void> {
    await supabase
      .from('inventory')
      .update({ in_stock: inStock, available: inStock, updated_at: new Date().toISOString() })
      .eq('id', id);
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
