import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryService } from '@/services/api/inventory';
import { adminSettingsService } from '@/services/api/adminSettings';
import { partsService } from '@/services/api/parts';
import {
  lineFromPart,
  type LineFromPartResult,
} from '@/services/api/accounting/documents/lineFromPart';
import type { QuoteRateSettings } from '@/services/api/accounting';

/**
 * Loads the inventory + org rate settings a part line needs, and returns a single-part
 * resolver used by the sales-document line editor on part-pick / qty-change. The resolver
 * fetches the hydrated part (variants/materials) and prices it with the SAME shared
 * `lineFromPart` → `quotePartLine` core the invoice-from-job seam uses, so an editor line
 * is priced exactly like the on-screen quote.
 *
 * Tolerant of not-yet-loaded data: until inventory + settings have loaded, `resolve`
 * returns null (the caller leaves the line untouched). EDITOR-ONLY — it pulls in
 * partsService + react-query, so it must not be imported by the read/render path.
 */
export function usePartLineResolver(): {
  resolve: (partId: string, quantity: number) => Promise<LineFromPartResult | null>;
  ready: boolean;
} {
  const { data: inventory } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryService.getAllInventory(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: settings } = useQuery({
    queryKey: ['organization-settings'],
    queryFn: () => adminSettingsService.getOrganizationSettings(),
    staleTime: 5 * 60 * 1000,
  });

  // Map org settings to the quote calculator's rate inputs EXACTLY as
  // InvoiceCreateView's buildLinesForJob does (materialMultiplier = materialUpcharge).
  const rateSettings = useMemo<QuoteRateSettings>(
    () => ({
      laborRate: settings?.laborRate ?? 0,
      cncRate: settings?.cncRate ?? 0,
      printer3DRate: settings?.printer3DRate ?? 0,
      materialMultiplier: settings?.materialUpcharge,
    }),
    [settings?.laborRate, settings?.cncRate, settings?.printer3DRate, settings?.materialUpcharge]
  );

  const ready = inventory != null && settings != null;

  const resolve = useCallback(
    async (partId: string, quantity: number): Promise<LineFromPartResult | null> => {
      // Tolerate not-yet-loaded data: pricing needs inventory + rate settings to match the
      // on-screen quote, so we bail rather than mis-price against partial inputs.
      if (!partId || !inventory) return null;
      const part = await partsService.getPartWithVariants(partId);
      if (!part) return null;
      return lineFromPart(part, quantity, inventory, rateSettings);
    },
    [inventory, rateSettings]
  );

  return { resolve, ready };
}
