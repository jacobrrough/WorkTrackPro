import { supabase } from './supabaseClient';
import { getAttachmentPublicUrl } from './storage';

export interface StoreVariant {
  id: string;
  variantSuffix: string;
  name?: string;
  pricePerVariant?: number;
}

export interface StoreProductImage {
  id: string;
  url: string;
  filename: string;
}

export interface StorePart {
  id: string;
  partNumber: string;
  name: string;
  description?: string;
  /** Fallback when no variant prices (price_per_set from parts) */
  pricePerSet?: number;
  variants: StoreVariant[];
  productImages: StoreProductImage[];
}

/** Fetch all parts visible on the store (anon read). */
export async function fetchStoreParts(): Promise<StorePart[]> {
  const { data: partsData, error: partsError } = await supabase
    .from('parts')
    .select('id, part_number, name, description, price_per_set')
    .eq('show_on_store', true)
    .order('part_number', { ascending: true });

  if (partsError || !partsData?.length) return [];

  const partIds = partsData.map((p) => p.id as string);

  const [variantsRes, attachmentsRes] = await Promise.all([
    supabase
      .from('part_variants')
      .select('id, part_id, variant_suffix, name, price_per_variant')
      .in('part_id', partIds)
      .order('variant_suffix', { ascending: true }),
    supabase
      .from('attachments')
      .select('id, part_id, storage_path, filename')
      .eq('attachment_type', 'product_image')
      .in('part_id', partIds),
  ]);

  const variantsByPart = new Map<string, StoreVariant[]>();
  if (variantsRes.data) {
    for (const row of variantsRes.data as Array<Record<string, unknown>>) {
      const partId = row.part_id as string;
      const rawPrice = row.price_per_variant ?? (row as Record<string, unknown>).pricePerVariant;
      const price = rawPrice != null && rawPrice !== '' ? Number(rawPrice) : undefined;
      const list = variantsByPart.get(partId) ?? [];
      list.push({
        id: row.id as string,
        variantSuffix: (row.variant_suffix as string) ?? '',
        name: row.name as string | undefined,
        pricePerVariant: Number.isFinite(price) ? price : undefined,
      });
      variantsByPart.set(partId, list);
    }
  }

  const imagesByPart = new Map<string, StoreProductImage[]>();
  if (attachmentsRes.data) {
    for (const row of attachmentsRes.data as Array<{
      id: string;
      part_id: string;
      storage_path: string;
      filename: string;
    }>) {
      const list = imagesByPart.get(row.part_id) ?? [];
      list.push({
        id: row.id,
        url: getAttachmentPublicUrl(row.storage_path),
        filename: row.filename,
      });
      imagesByPart.set(row.part_id, list);
    }
  }

  return partsData.map((p) => {
    const row = p as Record<string, unknown>;
    const rawSetPrice = row.price_per_set ?? row.pricePerSet;
    const pricePerSet = rawSetPrice != null && rawSetPrice !== '' ? Number(rawSetPrice) : undefined;
    return {
      id: p.id as string,
      partNumber: (p.part_number as string) ?? '',
      name: (p.name as string) ?? '',
      description: p.description as string | undefined,
      pricePerSet: Number.isFinite(pricePerSet) ? pricePerSet : undefined,
      variants: variantsByPart.get(p.id as string) ?? [],
      productImages: imagesByPart.get(p.id as string) ?? [],
    };
  });
}

/** Fetch a single store part by id (anon read). */
export async function fetchStorePartById(partId: string): Promise<StorePart | null> {
  const { data: partRow, error: partError } = await supabase
    .from('parts')
    .select('id, part_number, name, description, price_per_set')
    .eq('id', partId)
    .eq('show_on_store', true)
    .single();

  if (partError || !partRow) return null;

  const [variantsRes, attachmentsRes] = await Promise.all([
    supabase
      .from('part_variants')
      .select('id, part_id, variant_suffix, name, price_per_variant')
      .eq('part_id', partId)
      .order('variant_suffix', { ascending: true }),
    supabase
      .from('attachments')
      .select('id, part_id, storage_path, filename')
      .eq('part_id', partId)
      .eq('attachment_type', 'product_image')
      .order('created_at', { ascending: true }),
  ]);

  const rawSetPrice =
    (partRow as Record<string, unknown>).price_per_set ??
    (partRow as Record<string, unknown>).pricePerSet;
  const pricePerSet = rawSetPrice != null && rawSetPrice !== '' ? Number(rawSetPrice) : undefined;
  const setPrice = Number.isFinite(pricePerSet) ? pricePerSet : undefined;

  const variants: StoreVariant[] = (variantsRes.data ?? []).map((row: Record<string, unknown>) => {
    const rawPrice = row.price_per_variant ?? row.pricePerVariant;
    const price = rawPrice != null && rawPrice !== '' ? Number(rawPrice) : undefined;
    const variantPrice = Number.isFinite(price) ? price : setPrice;
    return {
      id: row.id as string,
      variantSuffix: (row.variant_suffix as string) ?? '',
      name: row.name as string | undefined,
      pricePerVariant: variantPrice,
    };
  });

  const productImages: StoreProductImage[] = (attachmentsRes.data ?? []).map(
    (row: Record<string, unknown>) => ({
      id: row.id as string,
      url: getAttachmentPublicUrl(row.storage_path as string),
      filename: (row.filename as string) ?? '',
    })
  );

  return {
    id: partRow.id as string,
    partNumber: (partRow.part_number as string) ?? '',
    name: (partRow.name as string) ?? '',
    description: partRow.description as string | undefined,
    pricePerSet: setPrice,
    variants,
    productImages,
  };
}
