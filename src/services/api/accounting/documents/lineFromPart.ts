import type { InventoryItem, Part } from '../../../../core/types';
import { quotePartLine, type QuoteRateSettings } from '../invoiceLinesFromJob';

/**
 * Single-part resolver used by the document editor on part-pick / qty-change. Wraps the shared
 * `quotePartLine` part-pricing core so an editor line is priced exactly like the invoice-from-job
 * seam (and the on-screen calculator). Pure (no Supabase/React); the caller supplies the resolved
 * part, inventory, and rate settings.
 */

export interface LineFromPartResult {
  partId: string;
  description: string;
  unitPrice: number;
  lineTotal: number;
}

export function lineFromPart(
  part: Part,
  quantity: number,
  inventory: InventoryItem[],
  settings: QuoteRateSettings
): LineFromPartResult | null {
  const sets = Math.max(1, Math.floor(quantity || 1));
  const quoted = quotePartLine(part, sets, inventory, settings);
  if (!quoted) return null;
  return { partId: part.id, ...quoted };
}
