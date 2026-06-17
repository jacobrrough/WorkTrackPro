/**
 * Shared header tax-code resolution for the sales-document editors (invoice/estimate
 * create + draft edit). Lifted VERBATIM from InvoiceCreateView so the create views and
 * the new detail-view draft editor resolve the effective code identically. The create
 * views import it from here and drop their local copies.
 */

/**
 * Resolve the header tax code to apply, with precedence: customer's preferred code, else the
 * address-based auto-suggestion (#13 — resolved from the customer's billing/shipping address),
 * else the org default code. Once the user has touched the Tax-code select we honor their raw
 * choice verbatim — including an explicit "No tax" (empty string) — so an intentional No-tax
 * selection is never re-seeded. `touched` distinguishes "the user has not chosen yet" (seed a
 * default) from "the user explicitly picked nothing". The address suggestion sits BELOW a
 * per-customer preferred code (an explicit customer setting wins) but ABOVE the org-wide
 * default, and is ADVISORY — the user can always override it.
 */
export function resolveEffectiveTaxCodeId(args: {
  rawTaxCodeId: string;
  touched: boolean;
  customerDefaultTaxCodeId: string | null | undefined;
  addressTaxCodeId?: string | null | undefined;
  orgDefaultTaxCodeId: string | null | undefined;
}): string {
  if (args.touched) return args.rawTaxCodeId;
  return args.customerDefaultTaxCodeId ?? args.addressTaxCodeId ?? args.orgDefaultTaxCodeId ?? '';
}
