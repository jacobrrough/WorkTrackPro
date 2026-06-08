import type {
  Form1099Report,
  VendorTaxInfo,
  VendorTaxInfoInput,
} from '../../../features/accounting/types';
import {
  build1099Worklist,
  type Form1099VendorInput,
} from '../../../features/accounting/reports/form1099Math';
import { acct } from './accountingClient';
import { mapVendorTaxInfoRow, type Row } from './mappers';

/**
 * #12 — 1099 vendor tracking + 1099-NEC worklist. ADVISORY / COMPLIANCE ONLY: nothing here
 * moves money (there is no posting path) and E-FILE IS OUT OF SCOPE. Two surfaces:
 *
 *  1. W-9 master data — getTaxInfo(vendorId) / upsertTaxInfo(vendorId, input) read+write the
 *     1:1 accounting.vendor_tax_info record (legal name, TIN, address, entity type, exempt).
 *     Reads return null when absent (the editor then shows an empty W-9 form). The write
 *     UPSERTs on the vendor_id PK and returns a write-style { ok, error } so the UI can
 *     surface a DB message inline (mirrors customFieldsService).
 *
 *  2. list1099Totals(year) — reads the accounting.v_1099_vendor_totals read-model filtered
 *     to the calendar year (per-vendor posted non-card payment totals for 1099 vendors),
 *     joins each to its W-9 record for the completeness check, and returns the ranked
 *     worklist via the pure build1099Worklist (integer cents, $600 threshold). Reads THROW
 *     so React Query surfaces them. Card / third-party payments are already excluded by the
 *     view (1099-K, not 1099-NEC).
 */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const nstr = (v: unknown): string | null => (v == null ? null : String(v));

/** Chunk size for the follow-up W-9 lookup (matches managementReports.ts). */
const CHUNK = 100;

/** The W-9 completeness signal for the worklist — presence only, never the raw TIN. */
interface VendorW9Status {
  legalName: string | null;
  hasTaxId: boolean;
  exempt: boolean;
}

/**
 * Resolve the W-9 completeness signal for a set of vendor ids (chunked IN). Reads the
 * accounting.v_vendor_w9_status view, which exposes a `has_tax_id` BOOLEAN and NEVER the raw
 * tax_id, so the plaintext TIN is never materialized client-side on this path. Vendors with no
 * W-9 row simply stay absent.
 */
async function fetchW9StatusByVendor(vendorIds: string[]): Promise<Map<string, VendorW9Status>> {
  const out = new Map<string, VendorW9Status>();
  for (let i = 0; i < vendorIds.length; i += CHUNK) {
    const slice = vendorIds.slice(i, i + CHUNK);
    const { data, error } = await acct()
      .from('v_vendor_w9_status')
      .select('vendor_id, legal_name, has_tax_id, exempt')
      .in('vendor_id', slice);
    if (error) throw error;
    for (const raw of (data ?? []) as Row[]) {
      out.set(String(raw.vendor_id), {
        legalName: nstr(raw.legal_name),
        hasTaxId: raw.has_tax_id === true,
        exempt: raw.exempt === true,
      });
    }
  }
  return out;
}

export const vendor1099Service = {
  /** One vendor's W-9 record, or null when none is on file yet. Reads THROW on error. */
  async getTaxInfo(vendorId: string): Promise<VendorTaxInfo | null> {
    const { data, error } = await acct()
      .from('vendor_tax_info')
      .select('*')
      .eq('vendor_id', vendorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapVendorTaxInfoRow(data as Row);
  },

  /**
   * Create or update a vendor's W-9 record (UPSERT on the vendor_id PK). Returns a
   * write-style result whose `error` carries the DB message on failure. A blank field is
   * persisted as null so clearing the legal name/TIN un-sets it.
   */
  async upsertTaxInfo(
    vendorId: string,
    input: VendorTaxInfoInput
  ): Promise<{ ok: boolean; error?: string }> {
    const row = {
      vendor_id: vendorId,
      legal_name: input.legalName?.trim() || null,
      tax_id: input.taxId?.trim() || null,
      address: input.address ?? null,
      federal_entity_type: input.federalEntityType ?? null,
      exempt: input.exempt ?? false,
    };
    const { error } = await acct().from('vendor_tax_info').upsert(row, { onConflict: 'vendor_id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * The ranked 1099-NEC worklist for a calendar year. Reads v_1099_vendor_totals (already
   * scoped to 1099 vendors, non-card posted payments) filtered to `year`, joins each row to
   * its W-9 completeness signal (v_vendor_w9_status — a has_tax_id boolean, never the raw
   * TIN), and rolls them up via build1099Worklist (integer cents, $600 threshold). Reads
   * THROW so React Query surfaces them.
   */
  async list1099Totals(year: number): Promise<Form1099Report> {
    const { data, error } = await acct()
      .from('v_1099_vendor_totals')
      .select('vendor_id, vendor_name, year, total_paid, payment_count')
      .eq('year', year);
    if (error) throw error;

    const totals = (data ?? []) as Row[];
    const vendorIds = Array.from(new Set(totals.map((r) => String(r.vendor_id))));
    const w9ByVendor =
      vendorIds.length > 0
        ? await fetchW9StatusByVendor(vendorIds)
        : new Map<string, VendorW9Status>();

    const inputs: Form1099VendorInput[] = totals.map((r) => {
      const vendorId = String(r.vendor_id);
      const w9 = w9ByVendor.get(vendorId) ?? null;
      return {
        vendorId,
        vendorName: nstr(r.vendor_name) ?? '',
        legalName: w9?.legalName ?? null,
        hasTaxId: w9?.hasTaxId ?? false,
        exempt: w9?.exempt ?? false,
        totalPaid: num(r.total_paid),
        paymentCount: num(r.payment_count),
      };
    });

    return build1099Worklist(inputs, { year });
  },
};
