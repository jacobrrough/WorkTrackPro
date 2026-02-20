import type { Part, PartVariant, PartMaterial, Attachment } from '../../core/types';
import { supabase } from './supabaseClient';
import { getAttachmentPublicUrl } from './storage';
import { uploadAttachment, deleteAttachmentRecord } from './storage';

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
};

function mapRowToPart(row: Record<string, unknown>): Part {
  const setComp = row.set_composition;
  return {
    id: row.id as string,
    partNumber: (row.part_number as string) ?? '',
    name: (row.name as string) ?? '',
    description: row.description as string | undefined,
    pricePerSet: row.price_per_set != null ? Number(row.price_per_set) : undefined,
    laborHours: row.labor_hours != null ? Number(row.labor_hours) : undefined,
    requiresCNC: row.requires_cnc === true,
    cncTimeHours: row.cnc_time_hours != null ? Number(row.cnc_time_hours) : undefined,
    requires3DPrint: row.requires_3d_print === true,
    printer3DTimeHours:
      row.printer_3d_time_hours != null ? Number(row.printer_3d_time_hours) : undefined,
    setComposition:
      setComp != null && typeof setComp === 'object' && !Array.isArray(setComp)
        ? (setComp as Record<string, number>)
        : undefined,
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
    pricePerVariant: row.price_per_variant != null ? Number(row.price_per_variant) : undefined,
    laborHours: row.labor_hours != null ? Number(row.labor_hours) : undefined,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

type AttachmentRow = {
  id: string;
  part_id?: string;
  filename: string;
  storage_path: string;
  is_admin_only: boolean;
  created_at?: string;
};

function mapAttachmentRow(a: AttachmentRow): Attachment {
  return {
    id: a.id,
    partId: a.part_id,
    filename: a.filename,
    storagePath: a.storage_path,
    isAdminOnly: a.is_admin_only,
    url: getAttachmentPublicUrl(a.storage_path),
    created: a.created_at,
  };
}

/** Map DB row to PartMaterial. Supports part-level (part_id, variant null) and variant-level; both schemas. */
function mapRowToPartMaterial(row: Record<string, unknown>): PartMaterial {
  const partVariantId = (row.part_variant_id ?? row.variant_id) as string | undefined;
  const partId = row.part_id as string | undefined;
  const quantityPerUnit = (row.quantity_per_unit ?? row.quantity) as number | undefined;
  const usageType =
    (row.usage_type as 'per_set' | 'per_variant') ??
    (partId && !partVariantId ? 'per_set' : 'per_variant');
  return {
    id: row.id as string,
    ...(partVariantId && { partVariantId }),
    ...(partId && { partId }),
    inventoryId: row.inventory_id as string,
    inventoryName: row.inventoryName as string | undefined,
    quantityPerUnit: quantityPerUnit ?? 1,
    unit: (row.unit as string) ?? 'units',
    usageType,
    createdAt: row.created_at as string | undefined,
    updatedAt: row.updated_at as string | undefined,
  };
}

function isDuplicatePartNumberError(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key value/i.test(error.message ?? '');
}

function isJobsPartNumberForeignKeyError(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  const details = error.details ?? '';
  return (
    error.code === '23503' &&
    (message.includes('jobs_part_number_fkey') || details.includes('jobs_part_number_fkey'))
  );
}

export const partsService = {
  async getAllParts(): Promise<Part[]> {
    const { data, error } = await supabase.from('parts').select('*').order('part_number');
    if (error) throw error;
    return (data ?? []).map((row) => mapRowToPart(row as unknown as Record<string, unknown>));
  },

  async getPartById(id: string): Promise<Part | null> {
    const { data, error } = await supabase.from('parts').select('*').eq('id', id).single();
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

    // Load all part_materials: variant-level and part-level (part_id set, variant null)
    const { data: allMaterialsData, error: matErr } = await supabase
      .from('part_materials')
      .select('*');
    if (matErr) throw matErr;
    const allMaterials = allMaterialsData ?? [];

    // Part-level materials: part_id = id and no variant
    type PartMaterialRow = Record<string, unknown> & {
      part_id?: string;
      part_variant_id?: string;
      variant_id?: string;
      inventory_id?: string;
    };
    const partLevelRows = allMaterials.filter((r: PartMaterialRow) => {
      const partId = r.part_id;
      const variantId = r.part_variant_id ?? r.variant_id;
      return partId === id && !variantId;
    });
    const variantLevelRows =
      variantIds.length === 0
        ? []
        : allMaterials.filter((r: PartMaterialRow) => {
            const variantId = r.part_variant_id ?? r.variant_id;
            return variantId && variantIds.includes(variantId);
          });

    const allMatRows = [...partLevelRows, ...variantLevelRows];
    const inventoryIds = [
      ...new Set(allMatRows.map((r: PartMaterialRow) => r.inventory_id as string)),
    ];
    const { data: invData } =
      inventoryIds.length > 0
        ? await supabase.from('inventory').select('id, name').in('id', inventoryIds)
        : { data: [] };
    const invNameMap = new Map(
      (invData ?? []).map((i: { id: string; name?: string }) => [i.id, i.name] as [string, string])
    );

    part.materials = partLevelRows.map((row: PartMaterialRow) => {
      const m = mapRowToPartMaterial(row as unknown as Record<string, unknown>);
      m.inventoryName = invNameMap.get(m.inventoryId) ?? 'Unknown';
      return m;
    });

    for (const v of part.variants) {
      v.materials = variantLevelRows
        .filter((r: PartMaterialRow) => (r.part_variant_id ?? r.variant_id) === v.id)
        .map((row: PartMaterialRow) => {
          const m = mapRowToPartMaterial(row as unknown as Record<string, unknown>);
          m.inventoryName = invNameMap.get(m.inventoryId) ?? 'Unknown';
          return m;
        });
    }

    const drawing = await this.getPartDrawing(id);
    part.drawingAttachment = drawing ?? null;
    return part;
  },

  /** Get the part's drawing file (at most one per part; for job cards – only file standard users can access). */
  async getPartDrawing(partId: string): Promise<Attachment | null> {
    const { data, error } = await supabase
      .from('attachments')
      .select('id, part_id, filename, storage_path, is_admin_only, created_at')
      .eq('part_id', partId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapAttachmentRow(data as unknown as AttachmentRow);
  },

  /** Set part drawing (replaces existing). Part drawing is always visible to standard users. */
  async addPartDrawing(partId: string, file: File): Promise<{ success: boolean; error?: string }> {
    try {
      const existing = await supabase.from('attachments').select('id').eq('part_id', partId);
      if (existing.error) {
        return {
          success: false,
          error: existing.error.message || 'Could not load existing drawing',
        };
      }
      for (const row of existing.data ?? []) {
        await deleteAttachmentRecord((row as { id: string }).id);
      }
      const result = await uploadAttachment(undefined, undefined, partId, file, false);
      if (result.id == null) {
        return { success: false, error: result.error || 'Part drawing upload failed' };
      }
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Part drawing upload failed';
      return { success: false, error: message };
    }
  },

  /** Remove part drawing by attachment id. */
  async deletePartDrawing(attachmentId: string): Promise<boolean> {
    return deleteAttachmentRecord(attachmentId);
  },

  async createPart(data: Partial<Part>): Promise<Part | null> {
    const row: Record<string, unknown> = {
      part_number: data.partNumber ?? '',
      name: data.name ?? '',
      description: data.description ?? null,
    };
    if (data.pricePerSet != null) row.price_per_set = data.pricePerSet;
    if (data.laborHours != null) row.labor_hours = data.laborHours;
    if (data.requiresCNC != null) row.requires_cnc = data.requiresCNC;
    if (data.cncTimeHours != null) row.cnc_time_hours = data.cncTimeHours;
    if (data.requires3DPrint != null) row.requires_3d_print = data.requires3DPrint;
    if (data.printer3DTimeHours != null) row.printer_3d_time_hours = data.printer3DTimeHours;
    if (data.setComposition != null) row.set_composition = data.setComposition;
    const { data: created, error } = await supabase.from('parts').insert(row).select('*').single();
    if (error) return null;
    return mapRowToPart(created as unknown as Record<string, unknown>);
  },

  async updatePart(id: string, data: Partial<Part>): Promise<Part | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const nextPartNumber = data.partNumber != null ? data.partNumber.trim() : undefined;
    if (data.partNumber != null) row.part_number = nextPartNumber;
    if (data.name != null) row.name = data.name;
    if (data.description != null) row.description = data.description;
    if (data.pricePerSet !== undefined) row.price_per_set = data.pricePerSet;
    if (data.laborHours !== undefined) row.labor_hours = data.laborHours;
    if (data.requiresCNC !== undefined) row.requires_cnc = data.requiresCNC;
    if (data.cncTimeHours !== undefined) row.cnc_time_hours = data.cncTimeHours;
    if (data.requires3DPrint !== undefined) row.requires_3d_print = data.requires3DPrint;
    if (data.printer3DTimeHours !== undefined) row.printer_3d_time_hours = data.printer3DTimeHours;
    if (data.setComposition !== undefined) row.set_composition = data.setComposition;
    const { data: updated, error } = await supabase
      .from('parts')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      if (nextPartNumber && isJobsPartNumberForeignKeyError(error)) {
        const { data: sourcePartData } = await supabase
          .from('parts')
          .select('part_number')
          .eq('id', id)
          .maybeSingle();
        const sourcePartNumber = (sourcePartData as { part_number?: string } | null)?.part_number;
        if (sourcePartNumber && sourcePartNumber !== nextPartNumber) {
          const { data: linkedJobsData, error: linkedJobsError } = await supabase
            .from('jobs')
            .select('id')
            .eq('part_id', id)
            .eq('part_number', sourcePartNumber);
          if (linkedJobsError) {
            console.error('updatePart relink lookup error:', linkedJobsError.message);
            return null;
          }

          const linkedJobIds = ((linkedJobsData ?? []) as Array<{ id: string }>).map((job) => job.id);
          if (linkedJobIds.length > 0) {
            const clearResult = await supabase
              .from('jobs')
              .update({
                part_number: null,
                updated_at: new Date().toISOString(),
              })
              .in('id', linkedJobIds);
            if (clearResult.error) {
              console.error('updatePart relink clear error:', clearResult.error.message);
              return null;
            }
          }

          const retryResult = await supabase
            .from('parts')
            .update(row)
            .eq('id', id)
            .select('*')
            .single();

          if (retryResult.error) {
            if (linkedJobIds.length > 0) {
              await supabase
                .from('jobs')
                .update({
                  part_number: sourcePartNumber,
                  updated_at: new Date().toISOString(),
                })
                .in('id', linkedJobIds);
            }
            console.error(
              'updatePart retry error:',
              retryResult.error.message,
              retryResult.error.code,
              retryResult.error.details
            );
            return null;
          }

          if (linkedJobIds.length > 0) {
            const relinkToNew = await supabase
              .from('jobs')
              .update({
                part_number: nextPartNumber,
                updated_at: new Date().toISOString(),
              })
              .in('id', linkedJobIds);
            if (relinkToNew.error) {
              console.warn('updatePart relink to new number warning:', relinkToNew.error.message);
            }
          }

          return mapRowToPart(retryResult.data as unknown as Record<string, unknown>);
        }
      }

      if (nextPartNumber && isDuplicatePartNumberError(error)) {
        const [{ data: targetPartData }, { data: sourcePartData }] = await Promise.all([
          supabase
            .from('parts')
            .select('id, part_number')
            .eq('part_number', nextPartNumber)
            .neq('id', id)
            .maybeSingle(),
          supabase.from('parts').select('part_number').eq('id', id).maybeSingle(),
        ]);

        const targetPart = (targetPartData ?? null) as { id: string; part_number: string } | null;
        const sourcePartNumber = (sourcePartData as { part_number?: string } | null)?.part_number;

        if (targetPart) {
          // Treat duplicate-number edit as a merge: relink job cards to the existing master part.
          const relinkPayload = {
            part_number: targetPart.part_number,
            part_id: targetPart.id,
            updated_at: new Date().toISOString(),
          };

          const relinkById = await supabase.from('jobs').update(relinkPayload).eq('part_id', id);
          if (relinkById.error) {
            console.warn('updatePart merge relink (by part_id) failed:', relinkById.error.message);
          }

          if (sourcePartNumber && sourcePartNumber !== targetPart.part_number) {
            const relinkByNumber = await supabase
              .from('jobs')
              .update(relinkPayload)
              .eq('part_number', sourcePartNumber)
              .is('part_id', null);
            if (relinkByNumber.error) {
              console.warn(
                'updatePart merge relink (by part_number) failed:',
                relinkByNumber.error.message
              );
            }
          }

          const { data: mergedTargetData } = await supabase
            .from('parts')
            .select('*')
            .eq('id', targetPart.id)
            .single();
          if (mergedTargetData) {
            return mapRowToPart(mergedTargetData as unknown as Record<string, unknown>);
          }
        }
      }
      console.error('updatePart error:', error.message, error.code, error.details);
      return null;
    }
    return mapRowToPart(updated as unknown as Record<string, unknown>);
  },

  async deletePart(id: string): Promise<boolean> {
    const { data: sourcePartData, error: sourcePartError } = await supabase
      .from('parts')
      .select('part_number')
      .eq('id', id)
      .maybeSingle();
    if (sourcePartError) {
      console.error('deletePart lookup error:', sourcePartError.message);
      return false;
    }

    const sourcePartNumber = (sourcePartData as { part_number?: string } | null)?.part_number ?? null;
    if (sourcePartNumber) {
      const now = new Date().toISOString();

      const clearOwnedLinks = await supabase
        .from('jobs')
        .update({
          part_id: null,
          part_number: null,
          updated_at: now,
        })
        .eq('part_id', id);
      if (clearOwnedLinks.error) {
        console.error('deletePart clear owned links error:', clearOwnedLinks.error.message);
        return false;
      }

      const { data: crossLinkedJobRefs, error: crossLinkedJobRefsError } = await supabase
        .from('jobs')
        .select('part_id')
        .eq('part_number', sourcePartNumber)
        .neq('part_id', id)
        .not('part_id', 'is', null);
      if (crossLinkedJobRefsError) {
        console.error('deletePart cross-link lookup error:', crossLinkedJobRefsError.message);
        return false;
      }

      const otherPartIds = [
        ...new Set(
          ((crossLinkedJobRefs ?? []) as Array<{ part_id: string | null }>)
            .map((row) => row.part_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        ),
      ];
      if (otherPartIds.length > 0) {
        const { data: canonicalPartsData, error: canonicalPartsError } = await supabase
          .from('parts')
          .select('id, part_number')
          .in('id', otherPartIds);
        if (canonicalPartsError) {
          console.error('deletePart canonical part lookup error:', canonicalPartsError.message);
          return false;
        }

        const canonicalPartMap = new Map(
          ((canonicalPartsData ?? []) as Array<{ id: string; part_number: string }>).map((row) => [
            row.id,
            row.part_number,
          ])
        );

        for (const partId of otherPartIds) {
          const canonicalNumber = canonicalPartMap.get(partId);
          const patchResult = await supabase
            .from('jobs')
            .update({
              part_number: canonicalNumber ?? null,
              updated_at: now,
            })
            .eq('part_number', sourcePartNumber)
            .eq('part_id', partId);
          if (patchResult.error) {
            console.error('deletePart cross-link patch error:', patchResult.error.message);
            return false;
          }
        }
      }

      const clearUnlinked = await supabase
        .from('jobs')
        .update({
          part_number: null,
          updated_at: now,
        })
        .eq('part_number', sourcePartNumber)
        .is('part_id', null);
      if (clearUnlinked.error) {
        console.error('deletePart clear unlinked references error:', clearUnlinked.error.message);
        return false;
      }
    }

    const { error } = await supabase.from('parts').delete().eq('id', id);
    if (error) {
      console.error('deletePart error:', error.message, error.code, error.details);
    }
    return !error;
  },

  async addVariant(
    partId: string,
    variantSuffix: string,
    name?: string
  ): Promise<PartVariant | null> {
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

  async createVariant(
    partId: string,
    data: {
      variantSuffix: string;
      name?: string;
      pricePerVariant?: number;
      laborHours?: number;
    }
  ): Promise<PartVariant | null> {
    const row: Record<string, unknown> = {
      part_id: partId,
      variant_suffix: data.variantSuffix,
      name: data.name ?? null,
    };
    if (data.pricePerVariant != null) row.price_per_variant = data.pricePerVariant;
    if (data.laborHours != null) row.labor_hours = data.laborHours;
    const { data: created, error } = await supabase
      .from('part_variants')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      console.error('Error creating variant:', error);
      throw error;
    }
    return mapRowToVariant(created as unknown as Record<string, unknown>);
  },

  async updateVariant(id: string, data: Partial<PartVariant>): Promise<PartVariant | null> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.variantSuffix != null) row.variant_suffix = data.variantSuffix;
    if (data.name != null) row.name = data.name;
    if (data.pricePerVariant !== undefined) row.price_per_variant = data.pricePerVariant;
    if (data.laborHours !== undefined) row.labor_hours = data.laborHours;
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
    // Try part_variant_id first (newer schema), fall back to variant_id (older schema)
    let row: Record<string, unknown> = {
      inventory_id: inventoryId,
      unit: unit ?? 'units',
    };

    // Try newer schema first (part_variant_id, quantity_per_unit)
    row.part_variant_id = partVariantId;
    row.quantity_per_unit = quantityPerUnit;

    let { data, error } = await supabase.from('part_materials').insert(row).select('*').single();

    // If that fails, try older schema (variant_id, quantity)
    if (error && (error.message?.includes('part_variant_id') || error.code === '42703')) {
      row = {
        variant_id: partVariantId,
        inventory_id: inventoryId,
        quantity: quantityPerUnit,
        unit: unit ?? 'units',
      };
      const result = await supabase.from('part_materials').insert(row).select('*').single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('Error adding part material:', error);
      return null;
    }
    return mapRowToPartMaterial(data as unknown as Record<string, unknown>);
  },

  async updatePartMaterial(id: string, data: Partial<PartMaterial>): Promise<PartMaterial | null> {
    // Try newer schema first (quantity_per_unit)
    let row: Record<string, unknown> = {};
    if (data.quantityPerUnit != null) row.quantity_per_unit = data.quantityPerUnit;
    if (data.unit != null) row.unit = data.unit;

    let { data: updated, error } = await supabase
      .from('part_materials')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    // If that fails, try older schema (quantity) or schema without quantity_per_unit.
    if (
      error &&
      (error.message?.includes('quantity_per_unit') ||
        error.message?.includes('updated_at') ||
        error.code === '42703')
    ) {
      row = {};
      if (data.quantityPerUnit != null) row.quantity = data.quantityPerUnit;
      if (data.unit != null) row.unit = data.unit;
      const result = await supabase
        .from('part_materials')
        .update(row)
        .eq('id', id)
        .select('*')
        .single();
      updated = result.data;
      error = result.error;
    }

    if (error) return null;
    return mapRowToPartMaterial(updated as unknown as Record<string, unknown>);
  },

  async deletePartMaterial(id: string): Promise<boolean> {
    const { error } = await supabase.from('part_materials').delete().eq('id', id);
    return !error;
  },

  /** Alias for deletePartMaterial (used by PartDetail). */
  async deleteMaterial(id: string): Promise<boolean> {
    return this.deletePartMaterial(id);
  },

  /**
   * Add material to a part (variant) or part-level. When variantId is set, adds to that variant.
   * When partId + usageType 'per_set', inserts a part-level row (part_id set, part_variant_id null).
   */
  async addMaterial(params: {
    partId?: string;
    variantId?: string;
    inventoryId: string;
    quantity: number;
    unit: string;
    usageType?: 'per_set' | 'per_variant';
  }): Promise<PartMaterial | null> {
    const { variantId, partId, inventoryId, quantity, unit, usageType } = params;

    if (usageType === 'per_set' && partId) {
      // Part-level row: part_id set, no variant. Use quantity_per_unit only (table may not have "quantity" column).
      const row: Record<string, unknown> = {
        part_id: partId,
        inventory_id: inventoryId,
        quantity_per_unit: quantity,
        unit: unit ?? 'units',
        usage_type: 'per_set',
      };
      let { data, error } = await supabase.from('part_materials').insert(row).select('*').single();
      // If insert fails (e.g. column quantity_per_unit doesn't exist), try with "quantity" for older schema
      if (error && (error.message?.includes('quantity_per_unit') || error.code === '42703')) {
        const rowLegacy: Record<string, unknown> = {
          part_id: partId,
          inventory_id: inventoryId,
          quantity,
          unit: unit ?? 'units',
          usage_type: 'per_set',
        };
        const result = await supabase.from('part_materials').insert(rowLegacy).select('*').single();
        data = result.data;
        error = result.error;
      }
      if (!error && data) {
        return mapRowToPartMaterial(data as unknown as Record<string, unknown>);
      }
      if (error) {
        const part = await this.getPartWithVariants(partId);
        const first = part?.variants?.[0];
        if (first) {
          const fallback = await this.addPartMaterial(first.id, inventoryId, quantity, unit);
          if (fallback) return fallback;
        }
        console.error(
          'Error adding part-level material:',
          error.message,
          error.code,
          error.details
        );
        return null;
      }
    }

    const targetVariantId =
      variantId ??
      (partId ? (await this.getPartWithVariants(partId))?.variants?.[0]?.id : undefined);
    if (!targetVariantId) return null;
    return this.addPartMaterial(targetVariantId, inventoryId, quantity, unit);
  },

  /**
   * Get completed jobs that are missing part information.
   * Returns jobs grouped by potential part number for suggestions.
   */
  async getJobsWithMissingPartInfo(): Promise<
    Array<{
      suggestedPartNumber: string;
      suggestedName: string;
      jobs: Array<{
        id: string;
        jobCode: number;
        name: string;
        partNumber?: string;
        variantSuffix?: string;
        description?: string;
        qty?: string;
        dueDate?: string;
        status: string;
      }>;
    }>
  > {
    try {
      // Get completed jobs (paid or projectCompleted) that don't have a part_id linked
      // Note: part_id column may not exist if migration hasn't been run yet - handle gracefully
      let query = supabase
        .from('jobs')
        .select(
          'id, job_code, name, part_number, variant_suffix, description, qty, due_date, status'
        )
        .in('status', ['paid', 'projectCompleted'])
        .order('due_date', { ascending: false });

      // Try to add part_id filter if column exists
      try {
        // Test if part_id column exists by trying to select it
        const testQuery = supabase.from('jobs').select('part_id').limit(1);
        const testResult = await testQuery;

        if (!testResult.error && testResult.data !== null) {
          // Column exists, use it in the filter
          query = supabase
            .from('jobs')
            .select(
              'id, job_code, name, part_number, variant_suffix, description, qty, due_date, status, part_id'
            )
            .in('status', ['paid', 'projectCompleted'])
            .is('part_id', null)
            .order('due_date', { ascending: false });
        }
      } catch {
        // Column doesn't exist, continue without part_id filter
        // This will show all completed jobs as suggestions (which is fine)
      }

      const { data: jobs, error } = await query;

      if (error) throw error;
      if (!jobs || jobs.length === 0) return [];

      // Group jobs by potential part number
      const grouped = new Map<
        string,
        {
          suggestedPartNumber: string;
          suggestedName: string;
          jobs: Array<{
            id: string;
            jobCode: number;
            name: string;
            partNumber?: string;
            variantSuffix?: string;
            description?: string;
            qty?: string;
            dueDate?: string;
            status: string;
          }>;
        }
      >();

      for (const job of jobs) {
        // Extract potential part number from job
        let suggestedPartNumber = '';
        let suggestedName = job.name || '';

        if (job.part_number && job.part_number.trim()) {
          // If job has part_number, only remove explicit 2-digit variant suffixes (e.g. -01, -05).
          suggestedPartNumber = job.part_number.replace(/-\d{2}$/, '').trim();
          suggestedName = job.name || suggestedPartNumber;
        } else if (job.name) {
          // Try to extract part number from job name (look for patterns like "ABC-01" or "SK-F35-0911")
          const nameMatch = job.name.match(/([A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
          if (nameMatch) {
            suggestedPartNumber = nameMatch[1].replace(/-\d{2}$/, '').trim();
          } else {
            // Use first part of name as fallback
            suggestedPartNumber = job.name.split(/[\s-]/)[0].trim();
          }
        } else {
          // Skip jobs with no name or part number
          continue;
        }

        if (!suggestedPartNumber) continue;

        const key = suggestedPartNumber.toUpperCase();
        if (!grouped.has(key)) {
          grouped.set(key, {
            suggestedPartNumber: key,
            suggestedName,
            jobs: [],
          });
        }

        const group = grouped.get(key)!;
        group.jobs.push({
          id: job.id as string,
          jobCode: job.job_code as number,
          name: job.name as string,
          partNumber: job.part_number as string | undefined,
          variantSuffix: job.variant_suffix as string | undefined,
          description: job.description as string | undefined,
          qty: job.qty as string | undefined,
          dueDate: job.due_date as string | undefined,
          status: job.status as string,
        });

        // Update suggested name to most common name in group
        const names = group.jobs.map((j) => j.name);
        const mostCommonName = names.reduce(
          (a, b, _, arr) =>
            arr.filter((v) => v === a).length >= arr.filter((v) => v === b).length ? a : b,
          names[0]
        );
        group.suggestedName = mostCommonName || group.suggestedName;
      }

      // Convert to array and sort by part number
      return Array.from(grouped.values()).sort((a, b) =>
        a.suggestedPartNumber.localeCompare(b.suggestedPartNumber)
      );
    } catch (error: unknown) {
      // If part_id column doesn't exist or any other error, return empty array
      // This prevents the UI from breaking
      console.warn(
        'Failed to load job suggestions (part_id column may not exist):',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  },
};
