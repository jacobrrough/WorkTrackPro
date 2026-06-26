import type { Item, NewInvoiceLineInput } from '../types';

/** The subset of a sales-document line that a Products & Services pick seeds. */
export type ItemLinePatch = Pick<
  NewInvoiceLineInput,
  'itemId' | 'partId' | 'description' | 'unitPrice' | 'incomeAccountId' | 'taxCodeId' | 'lineTotal'
>;

/**
 * Seed a sales-document line from a Products & Services item (accounting.items), mirroring
 * how a part pick seeds from a part quote: SEED, don't lock — the user can still edit after.
 *
 *  - itemId is set and partId cleared (a line is a part XOR an item XOR free text).
 *  - description ← the item name.
 *  - unitPrice ← the item's sales price WHEN it carries a positive one; otherwise the line's
 *    current price is kept (many service items, e.g. "Labor Sales", carry a 0 price and are
 *    rate-entered per use, so we must not stomp a price the user already typed with 0).
 *  - incomeAccountId ← the item's income account, so the revenue posts to the right account
 *    (e.g. 4030 Sales, Labor / 4700 Sales, Delivery) instead of the catch-all sales income.
 *  - taxCodeId ← the item's default tax code WHEN it has one; otherwise left untouched so the
 *    document's header tax code still governs.
 *  - lineTotal is cleared so the amount recomputes from qty × rate.
 */
export function lineFromItem(
  item: Item,
  current: { unitPrice?: number | null } = {}
): ItemLinePatch {
  const hasPrice = item.salesPrice != null && item.salesPrice > 0;
  const patch: ItemLinePatch = {
    itemId: item.id,
    partId: null,
    description: item.name,
    unitPrice: hasPrice ? (item.salesPrice as number) : (current.unitPrice ?? 0),
    incomeAccountId: item.incomeAccountId,
    lineTotal: undefined,
  };
  // Only override the line's tax code when the item declares one; a null item default must
  // not clear a header/line tax code the user is relying on.
  if (item.defaultTaxCodeId) patch.taxCodeId = item.defaultTaxCodeId;
  return patch;
}
