import type { Part, PartVariant, PartMaterial } from '../../core/types';
import { supabase } from './supabaseClient';

function mapRowToPart(row: Record<string, unknown>): Part {
  return {
    id: row.id as string,
    partNumber: (row.part_number as string) ?? '',
    name: (row.name as string) ?? '',
    description: row.description as string | undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

function mapRowToVariant(row: Record<string, unknown>): PartVariant {
  return {
    id: row.id as string,
    partId: row.part_id as string,
    variantSuffix: (row.variant_suffix as string) ?? '',
    name: row.name as string | undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

/** Map DB row to PartMaterial. Supports both schemas: variant_id/quantity (initial) and part_variant_id/quantity_per_unit (parts_schema). */
function mapRowToPartMaterial(row: Record<string, unknown>): PartMaterial {
  const partVariantId = (row.part_variant_id ?? row.variant_id) as string;
  const quantityPerUnit = (row.quantity_per_unit ?? row.quantity) as number | undefined;
  return {
    id: row.id as string,
    partVariantId,
    inventoryId: row.inventory_id as string,
    inventoryName: row.inventoryName as string | undefined,
    quantityPerUnit: quantityPerUnit ?? 1,
    unit: (row.unit as string) ?? 'units',
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

export const partsService = {
  async getAllParts(): Promise<Part[]> {
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .order('part_number');
    if (error) throw error;
    return (data ?? []).map((row) => mapRowToPart(row as unknown as Record<string, unknown>));
  },

  async getPartById(id: string): Promise<Part | null> {
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return mapRowToPart(data as unknown as Record<string, unknown>);
  },

  /** Get part by part_number (e.g. "SK-F35-0911"). */
  async getPartByNumber(partNumber: string): Promise<Part | null> {
    const trimmed = partNumber?.trim();
    if (!trimmed) return null;
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .eq('part_number', trimmed)
      .maybeSingle();
    if (error || !data) return null;
    return mapRowToPart(data as unknown as Record<string, unknown>);
  },

  /** Load part with variants (and their materials). Alias for getPartWithVariantsAndMaterials. */
  async getPartWithVariants(id: string): Promise<Part | null> {
    return this.getPartWithVariantsAndMaterials(id);
  },

  /** Load part with variants and their materials (inventory names resolved). */
  async getPartWithVariantsAndMaterials(id: string): Promise<Part | null> {
    const part = await this.getPartById(id);
    if (!part) return null;

    const { data: variantsData, error: varErr } = await supabase
      .from('part_variants')
      .select('*')
      .eq('part_id', id)
      .order('variant_suffix');
    if (varErr) throw varErr;
    const variants = (variantsData ?? []).map((row) =>
      mapRowToVariant(row as unknown as Record<string, unknown>)
    );
    part.variants = variants;

    const variantIds = variants.map((v) => v.id);
    if (variantIds.length === 0) return part;

    const { data: materialsData, error: matErr } = await supabase
      .from('part_materials')
      .select('*')
      .in('variant_id', variantIds);
    if (matErr) throw matErr;

    const inventoryIds = [
      ...new Set((materialsData ?? []).map((r) => (r as { inventory_id: string }).inventory_id)),
    ];
    const { data: invData } =
      inventoryIds.length > 0
        ? await supabase.from('inventory').select('id, name').in('id', inventoryIds)
        : { data: [] };
    const invNameMap = new Map((invData ?? []).map((i) => [i.id, i.name]));

    for (const v of part.variants) {
      v.materials = (materialsData ?? [])
        .filter((r) => ((r as { part_variant_id?: string; variant_id?: string }).part_variant_id ?? (r as { variant_id: string }).variant_id) === v.id)
        .map((row) => {
          const m = mapRowToPartMaterial(row as unknown as Record<string, unknown>);
          m.inventoryName = invNameMap.get(m.inventoryId) ?? 'Unknown';
          return m;
        });
    }
    return part;
  },

  async createPart(data: Partial<Part>): Promise<Part | null> {
    const row = {
      part_number: data.partNumber ?? '',
      name: data.name ?? '',
      description: data.description ?? null,
    };
    const { data: created, error } = await supabase
      .from('parts')
      .insert(row)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToPart(created as unknown as Record<string, unknown>);
  },

  async updatePart(id: string, data: Partial<Part>): Promise<Part | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.partNumber != null) row.part_number = data.partNumber;
    if (data.name != null) row.name = data.name;
    if (data.description != null) row.description = data.description;
    const { data: updated, error } = await supabase
      .from('parts')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToPart(updated as unknown as Record<string, unknown>);
  },

  async deletePart(id: string): Promise<boolean> {
    const { error } = await supabase.from('parts').delete().eq('id', id);
    return !error;
  },

  async addVariant(partId: string, variantSuffix: string, name?: string): Promise<PartVariant | null> {
    const { data, error } = await supabase
      .from('part_variants')
      .insert({
        part_id: partId,
        variant_suffix: variantSuffix,
        name: name ?? null,
      })
      .select('*')
      .single();
    if (error) return null;
    return mapRowToVariant(data as unknown as Record<string, unknown>);
  },

  async updateVariant(id: string, data: Partial<PartVariant>): Promise<PartVariant | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.variantSuffix != null) row.variant_suffix = data.variantSuffix;
    if (data.name != null) row.name = data.name;
    const { data: updated, error } = await supabase
      .from('part_variants')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToVariant(updated as unknown as Record<string, unknown>);
  },

  async deleteVariant(id: string): Promise<boolean> {
    const { error } = await supabase.from('part_variants').delete().eq('id', id);
    return !error;
  },

  async addPartMaterial(
    partVariantId: string,
    inventoryId: string,
    quantityPerUnit: number,
    unit?: string
  ): Promise<PartMaterial | null> {
    const { data, error } = await supabase
      .from('part_materials')
      .insert({
        variant_id: partVariantId,
        inventory_id: inventoryId,
        quantity: quantityPerUnit,
        unit: unit ?? 'units',
      })
      .select('*')
      .single();
    if (error) return null;
    return mapRowToPartMaterial(data as unknown as Record<string, unknown>);
  },

  async updatePartMaterial(id: string, data: Partial<PartMaterial>): Promise<PartMaterial | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.quantityPerUnit != null) row.quantity = data.quantityPerUnit;
    if (data.unit != null) row.unit = data.unit;
    const { data: updated, error } = await supabase
      .from('part_materials')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return null;
    return mapRowToPartMaterial(updated as unknown as Record<string, unknown>);
  },

  async deletePartMaterial(id: string): Promise<boolean> {
    const { error } = await supabase.from('part_materials').delete().eq('id', id);
    return !error;
  },
};
