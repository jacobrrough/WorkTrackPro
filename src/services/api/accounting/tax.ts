import type { TaxCode } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import { mapTaxCodeRow, type Row } from './mappers';

/**
 * Sales-tax codes (accounting.tax_codes). A code's effective rate is the sum of the
 * decimal rates of its composing tax_rates (state + district), joined through
 * accounting.tax_code_rates. We fetch that nested in one query and reduce it to a
 * single `rate` on each TaxCode so the invoice layer can compute tax without extra
 * round-trips.
 *
 * DISCLAIMER: seeded rates are representative only — not certified tax software.
 * Always verify with a CPA/EA. (Surfaced in the UI per G9.)
 */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Sum the decimal rates of the tax_rates linked to a tax_codes row. */
function combinedRateFromJoin(row: Row): number {
  const joins = (row.tax_code_rates ?? []) as Row[];
  let rate = 0;
  for (const j of joins) {
    const tr = (j.tax_rate ?? j.tax_rates ?? null) as Row | null;
    if (tr && (tr.is_active === undefined || tr.is_active !== false)) {
      rate += num(tr.rate);
    }
  }
  return rate;
}

const SELECT_WITH_RATES = '*, tax_code_rates(tax_rate:tax_rates(id, rate, is_active))';

export const taxService = {
  /** Active tax codes with their combined decimal rate. */
  async getAll(includeInactive = false): Promise<TaxCode[]> {
    let q = acct().from('tax_codes').select(SELECT_WITH_RATES).order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Row[]).map((r) => mapTaxCodeRow(r, combinedRateFromJoin(r)));
  },

  async getById(id: string): Promise<TaxCode | null> {
    const { data, error } = await acct()
      .from('tax_codes')
      .select(SELECT_WITH_RATES)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Row;
    return mapTaxCodeRow(row, combinedRateFromJoin(row));
  },

  /** The code flagged is_default, if any (e.g. CA statewide). */
  async getDefault(): Promise<TaxCode | null> {
    const { data, error } = await acct()
      .from('tax_codes')
      .select(SELECT_WITH_RATES)
      .eq('is_default', true)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Row;
    return mapTaxCodeRow(row, combinedRateFromJoin(row));
  },
};
