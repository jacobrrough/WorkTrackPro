import type { CustomerAddress } from '../../../features/accounting/types';

/**
 * Helpers for the customer billing/shipping address jsonb. There is no canonical stored shape,
 * so the readers tolerate common key variants (line1/street/address1, zip/postalCode, …). Two
 * read flavors:
 *   - readCustomerAddress  → DISPLAY/EDIT: keeps a street-only address (line1 with no geo).
 *   - parseCustomerAddress → TAX RESOLUTION: requires a geographic component, since a bare
 *     street can never resolve a jurisdiction.
 * serializeCustomerAddress writes the editable fields back to a canonical blob.
 */

function picker(o: Record<string, unknown>) {
  return (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = o[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
}

/** Read a jsonb blob into a CustomerAddress. null only when no usable field exists (line1 incl). */
export function readCustomerAddress(raw: unknown): CustomerAddress | null {
  if (!raw || typeof raw !== 'object') return null;
  const pick = picker(raw as Record<string, unknown>);
  const addr: CustomerAddress = {
    country: pick('country', 'countryCode', 'country_code') ?? 'US',
    line1: pick('line1', 'street', 'address1', 'address', 'addr1', 'line_1'),
    city: pick('city', 'town', 'locality'),
    state: pick('state', 'region', 'province', 'stateCode', 'state_code'),
    county: pick('county', 'district', 'subAdministrativeArea'),
    zip: pick('zip', 'postalCode', 'postal_code', 'zipCode', 'zip_code', 'postcode'),
  };
  if (!addr.line1 && !addr.state && !addr.county && !addr.city && !addr.zip) return null;
  return addr;
}

/**
 * Tax-resolution view: like readCustomerAddress but requires a geographic component (state /
 * county / city / zip). A bare street returns null so the jurisdiction resolver skips it.
 */
export function parseCustomerAddress(raw: unknown): CustomerAddress | null {
  const addr = readCustomerAddress(raw);
  if (!addr) return null;
  if (!addr.state && !addr.county && !addr.city && !addr.zip) return null;
  return addr;
}

/**
 * Serialize editable address fields back to the canonical jsonb the readers understand. Returns
 * null when every field is blank, so clearing the form clears the column.
 */
export function serializeCustomerAddress(
  addr: Partial<CustomerAddress> | null | undefined
): Record<string, unknown> | null {
  if (!addr) return null;
  const t = (v: string | null | undefined): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s;
  };
  const out = {
    line1: t(addr.line1),
    city: t(addr.city),
    state: t(addr.state),
    county: t(addr.county),
    zip: t(addr.zip),
    country: t(addr.country),
  };
  if (!out.line1 && !out.city && !out.state && !out.county && !out.zip) return null;
  return { ...out, country: out.country ?? 'US' };
}

/** One-line display string, e.g. "123 Main St, Lancaster, CA 93535". null when empty. */
export function formatCustomerAddress(addr: CustomerAddress | null | undefined): string | null {
  if (!addr) return null;
  const cityState = [addr.city, addr.state].filter(Boolean).join(', ');
  const tail = [cityState, addr.zip].filter(Boolean).join(' ');
  const parts = [addr.line1, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
