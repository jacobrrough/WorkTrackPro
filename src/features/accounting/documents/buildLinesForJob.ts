import type { Job } from '@/core/types';
import { partsService } from '@/services/api/parts';
import { inventoryService } from '@/services/api/inventory';
import { adminSettingsService } from '@/services/api/adminSettings';
import { buildInvoiceLinesFromJob, jobPartLinks } from '@/services/api/accounting';
import type { NewInvoiceLineInput } from '../types';

/**
 * Build draft sales-document lines (invoice/estimate) from a job, pricing each part with the
 * SAME quote calculator the job screen uses so the document equals the on-screen quote, and
 * carrying each part's `partId` through so the lines arrive LINKED (the editor shows them in
 * the Part column and re-prices them on qty change).
 *
 * Crucially, this hydrates each of the job's referenced parts with their variants + materials
 * (partsService.getPartWithVariants). The old path passed `partsService.getAllParts()`, which
 * returns shallow rows with NO BOM — so a material-priced part quoted to ~0 and its line was
 * silently dropped (or the quoted snapshot never applied). Resolving + hydrating only the
 * job's own parts both fixes the pricing and avoids fetching the entire parts table.
 *
 * NewInvoiceLineInput and NewEstimateLineInput are structurally identical, so the estimate
 * view casts the result. Reads public.* only.
 */
export async function buildSalesLinesForJob(
  job: Job,
  taxCodeId: string | null
): Promise<NewInvoiceLineInput[]> {
  const refs = jobPartLinks(job);

  const [inventory, settings, parts] = await Promise.all([
    inventoryService.getAllInventory(),
    adminSettingsService.getOrganizationSettings(),
    // Hydrate each referenced part (variants + materials). Resolve by id when the link has
    // one, else by part number. Null entries (deleted/unknown parts) are dropped — the
    // builder then falls back to the job's inventory BOM exactly as before.
    Promise.all(
      refs.map(async (ref) => {
        if (ref.partId) return partsService.getPartWithVariants(ref.partId);
        if (ref.partNumber) {
          const shallow = await partsService.getPartByNumber(ref.partNumber);
          return shallow ? partsService.getPartWithVariants(shallow.id) : null;
        }
        return null;
      })
    ),
  ]);

  return buildInvoiceLinesFromJob({
    job,
    parts: parts.filter((p): p is NonNullable<typeof p> => p != null),
    inventory,
    settings: {
      laborRate: settings?.laborRate ?? 0,
      cncRate: settings?.cncRate ?? 0,
      printer3DRate: settings?.printer3DRate ?? 0,
      materialMultiplier: settings?.materialUpcharge,
    },
    taxCodeId,
  });
}
