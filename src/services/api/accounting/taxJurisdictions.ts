import type {
  CustomerAddress,
  NewTaxJurisdictionInput,
  TaxJurisdiction,
  UpdateTaxJurisdictionInput,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapTaxJurisdictionRow, type Row } from './mappers';
import { parseCustomerAddress } from './customerAddress';

/**
 * #13 — sales-tax RATE AUTOMATION (address-based tax-code selection). ADVISORY-ONLY.
 *
 * The API seam for accounting.tax_jurisdictions (migration 20260608190100) and the
 * accounting.resolve_tax_code_for_address RPC. A jurisdiction maps a geography
 * (country/state/county/city/zip) to the COMPOSITE accounting.tax_codes row to apply —
 * it never invents a rate (it points at a tax_code that was already seeded with its
 * composing tax_rates), so the existing TAX-SYNC drift framework keeps those rates current.
 *
 * resolveForAddress() calls the SECURITY DEFINER RPC, which returns the best-matching
 * jurisdiction's tax_code_id by specificity (zip > city > county > state) or NULL. It moves
 * NO money and posts NO journal entry — it is a lookup the invoice/estimate create screens
 * use to PRE-FILL (suggest) a tax code, which the user can always override.
 *
 * DISCLAIMER (G9): the seeded jurisdictions are REPRESENTATIVE ONLY; ZIP-level mapping is an
 * approximation (a ZIP can straddle districts — rooftop accuracy needs a paid provider, a
 * future upgrade). Always verify with a CPA/EA. The UI carries the banner on every screen
 * that shows a resolved code.
 *
 * Reads THROW so React Query surfaces errors; writes return null on failure (module
 * convention, cf. dimensionsService / customersService).
 */

const str = (v: unknown): string => (v == null ? '' : String(v));

// parseCustomerAddress (tax-resolution view of the billing/shipping jsonb) lives in
// ./customerAddress alongside the display reader + serializer; re-exported for back-compat.
export { parseCustomerAddress };

/** The DB row shape the upsert writes (camel → snake). Only defined fields are sent. */
function toRow(input: NewTaxJurisdictionInput): Record<string, unknown> {
  const trim = (v: string | null | undefined): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s;
  };
  return {
    country: trim(input.country) ?? 'US',
    state: trim(input.state),
    county: trim(input.county),
    city: trim(input.city),
    zip: trim(input.zip),
    tax_code_id: input.taxCodeId,
    priority: input.priority ?? 0,
  };
}

export const taxJurisdictionsService = {
  /**
   * All jurisdiction mappings, most specific first (zip, then city, then county, then state),
   * then by priority — the same ordering the resolver scores by, so the management screen
   * reads top-to-bottom in resolution order. Reads throw.
   */
  async list(): Promise<TaxJurisdiction[]> {
    const { data, error } = await acct()
      .from('tax_jurisdictions')
      .select('*')
      .order('zip', { ascending: true, nullsFirst: false })
      .order('city', { ascending: true, nullsFirst: false })
      .order('county', { ascending: true, nullsFirst: false })
      .order('state', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapTaxJurisdictionRow);
  },

  async getById(id: string): Promise<TaxJurisdiction | null> {
    const { data, error } = await acct()
      .from('tax_jurisdictions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapTaxJurisdictionRow(data as Row);
  },

  /** Create one mapping. Returns the created row, or null on failure. */
  async create(input: NewTaxJurisdictionInput): Promise<TaxJurisdiction | null> {
    const { data, error } = await acct()
      .from('tax_jurisdictions')
      .insert(toRow(input))
      .select('*')
      .single();
    if (error || !data) return null;
    return mapTaxJurisdictionRow(data as Row);
  },

  /**
   * Upsert: update when `id` is present, else create. Mirrors the lightweight CRUD shape the
   * other settings services use. On update only the provided fields are written.
   */
  async upsert(input: UpdateTaxJurisdictionInput): Promise<TaxJurisdiction | null> {
    if (!input.id) return this.create(input);
    const row: Record<string, unknown> = {};
    const trim = (v: string | null | undefined): string | null => {
      const s = v == null ? '' : String(v).trim();
      return s === '' ? null : s;
    };
    if (input.country !== undefined) row.country = trim(input.country) ?? 'US';
    if (input.state !== undefined) row.state = trim(input.state);
    if (input.county !== undefined) row.county = trim(input.county);
    if (input.city !== undefined) row.city = trim(input.city);
    if (input.zip !== undefined) row.zip = trim(input.zip);
    if (input.taxCodeId !== undefined) row.tax_code_id = input.taxCodeId;
    if (input.priority !== undefined) row.priority = input.priority ?? 0;
    const { data, error } = await acct()
      .from('tax_jurisdictions')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapTaxJurisdictionRow(data as Row);
  },

  /** Remove a mapping. Returns true on success. */
  async remove(id: string): Promise<boolean> {
    const { error } = await acct().from('tax_jurisdictions').delete().eq('id', id);
    return !error;
  },

  /**
   * Resolve the best-matching tax_code_id for an address via the SECURITY DEFINER RPC
   * (specificity: zip > city > county > state). Returns null when nothing matches OR on any
   * error — this is an ADVISORY suggestion, so it degrades to "no suggestion" rather than
   * throwing or blocking the create flow. The caller then falls back to the customer/org
   * default and the user can always override.
   */
  async resolveForAddress(addr: CustomerAddress | null | undefined): Promise<string | null> {
    if (!addr) return null;
    const { data, error } = await acct().rpc('resolve_tax_code_for_address', {
      p_country: addr.country ?? 'US',
      p_state: addr.state ?? null,
      p_county: addr.county ?? null,
      p_city: addr.city ?? null,
      p_zip: addr.zip ?? null,
    });
    if (error || data == null) return null;
    return str(data) || null;
  },

  /**
   * Read a customer's billing (preferred) or shipping address as a normalized CustomerAddress,
   * for the invoice/estimate auto-suggest. The Customer domain type does not carry the raw
   * jsonb address, so this reads the two columns directly. Returns null when the customer has
   * no usable address. Reads throw on a real DB error; a missing customer resolves to null.
   */
  async getCustomerAddress(customerId: string): Promise<CustomerAddress | null> {
    const { data, error } = await acct()
      .from('customers')
      .select('billing_address, shipping_address')
      .eq('id', customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Row;
    return parseCustomerAddress(row.billing_address) ?? parseCustomerAddress(row.shipping_address);
  },
};
