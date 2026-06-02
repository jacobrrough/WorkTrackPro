import type {
  DateRange,
  SalesTaxLiabilityReport,
  TaxAgency,
  TaxCalendar,
  TaxCalendarEntry,
} from '../../../features/accounting/types';
import {
  buildSalesTaxLiability,
  type InvoiceTaxInput,
  type LiabilityLineInput,
} from '../../../features/accounting/reports/salesTaxMath';
import {
  computeAgencyCalendar,
  fallbackRuleFor,
} from '../../../features/accounting/reports/taxCalendarMath';
import { toIsoDate } from '../../../features/accounting/periodLock';
import { acct } from './accountingClient';
import { accountingSettingsService } from './settings';
import { mapTaxAgencyRow, parseTaxFilingRules, type Row } from './mappers';

/**
 * C1 — Sales-tax REPORTING & tax calendar. REPORTING ONLY: no e-filing, no money
 * movement, no payroll, no notification delivery. Every figure ties back to the
 * POSTED ledger; nothing here writes (reads THROW so React Query surfaces them).
 *
 * Two read surfaces:
 *  1. getSalesTaxLiability(range) — tax COLLECTED = net credit to the 2200 "Sales Tax
 *     Payable" account on posted journal entries in range, attributed to a tax agency
 *     via each entry's source invoice's tax code → tax_rates → tax_agencies, with a
 *     CDTFA-style taxable/non-taxable summary. Any 2200 credit that cannot be tied to
 *     a source invoice/agency is surfaced in an explicit "Unattributed / review" bucket
 *     (the stop-condition) rather than guessed. The cents math + apportionment live in
 *     the pure salesTaxMath.ts; this service only does the Supabase I/O.
 *  2. getTaxFilingCalendar(asOf) — upcoming/recent filing deadlines computed from the
 *     `tax_filing_calendar` row in accounting.settings (falling back to each agency's
 *     own filing_frequency when no rule is present). Pure date math in taxCalendarMath.ts.
 *
 * DISCLAIMER (G9): seeded rates/cadences are REPRESENTATIVE only — "Not certified tax
 * software. Always verify with a CPA/EA. Representative rates only." Enforced on every
 * C1 screen and export in the UI/export lane.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Sum the active composing tax_rates of a join (state + district) to one decimal rate. */
function combinedRateFromRates(rates: Row[] | null | undefined): number {
  let rate = 0;
  for (const r of rates ?? []) {
    if (r && (r.is_active === undefined || r.is_active !== false)) rate += num(r.rate);
  }
  return rate;
}

/**
 * Resolve the GL account that holds sales tax payable. Prefer the configured
 * settings.default_accounts.sales_tax_payable id (never hardcode), then fall back to the
 * chart account numbered 2200. Returns { id, number } or nulls when unresolved (the
 * report then surfaces a zeroed, clearly-unconfigured result rather than guessing).
 */
async function resolveLiabilityAccount(): Promise<{ id: string | null; number: string | null }> {
  let id: string | null = null;
  try {
    const defaults = await accountingSettingsService.getDefaultAccounts();
    id = defaults.salesTaxPayable ?? null;
  } catch {
    id = null;
  }

  if (id) {
    const { data } = await acct()
      .from('accounts')
      .select('id, account_number')
      .eq('id', id)
      .maybeSingle();
    const row = data as Row | null;
    if (row) return { id: String(row.id), number: row.account_number == null ? null : String(row.account_number) };
  }

  // Fallback: the conventional 2200 "Sales Tax Payable" chart account.
  const { data } = await acct()
    .from('accounts')
    .select('id, account_number')
    .eq('account_number', '2200')
    .maybeSingle();
  const row = data as Row | null;
  if (row) return { id: String(row.id), number: row.account_number == null ? null : String(row.account_number) };
  return { id, number: null };
}

/** PostgREST select that pulls each invoice's tax-code→rates→agencies + its lines. */
const INVOICE_TAX_SELECT =
  'id, tax_code:tax_codes(id, tax_code_rates(tax_rate:tax_rates(id, rate, is_active, agency_id)))' +
  ', lines:invoice_lines(taxable, line_total, discount)';

/**
 * Build the per-invoice tax attribution inputs for a set of invoice ids: each invoice's
 * composing agency ids (deduped, only active rates) + its taxable / non-taxable sales
 * base (Σ line (line_total − discount), partitioned by the line's `taxable` flag).
 * Chunks the id list so a long IN(...) never blows the URL length.
 */
async function fetchInvoiceTaxInputs(invoiceIds: string[]): Promise<InvoiceTaxInput[]> {
  const out: InvoiceTaxInput[] = [];
  const CHUNK = 100;
  for (let i = 0; i < invoiceIds.length; i += CHUNK) {
    const slice = invoiceIds.slice(i, i + CHUNK);
    const { data, error } = await acct().from('invoices').select(INVOICE_TAX_SELECT).in('id', slice);
    if (error) throw error;
    // The deeply-nested embed makes PostgREST infer an error-union element type; the
    // accounting schema isn't in the generated Database types anyway, so we narrow via
    // unknown (the rest of the module treats accounting rows as Record<string, unknown>).
    for (const raw of (data ?? []) as unknown as Row[]) {
      const taxCode = (raw.tax_code ?? null) as Row | null;
      const codeRates = (taxCode?.tax_code_rates ?? []) as Row[];
      const agencyIds: string[] = [];
      const seen = new Set<string>();
      for (const j of codeRates) {
        const tr = (j.tax_rate ?? null) as Row | null;
        if (!tr) continue;
        if (tr.is_active === false) continue;
        const aid = tr.agency_id == null ? null : String(tr.agency_id);
        if (aid && !seen.has(aid)) {
          seen.add(aid);
          agencyIds.push(aid);
        }
      }

      let taxable = 0;
      let nonTaxable = 0;
      for (const line of (raw.lines ?? []) as Row[]) {
        // Net of any line discount; mirrors how the invoice subtotal was built.
        const net = num(line.line_total) - num(line.discount);
        if (line.taxable === false) nonTaxable += net;
        else taxable += net;
      }

      out.push({
        invoiceId: String(raw.id),
        agencyIds,
        taxableSales: taxable,
        nonTaxableSales: nonTaxable,
      });
    }
  }
  return out;
}

/** Fetch the agency master with each agency's combined (state + district) decimal rate. */
async function fetchAgencies(): Promise<TaxAgency[]> {
  const { data, error } = await acct()
    .from('tax_agencies')
    .select('id, name, liability_account_id, filing_frequency, created_at, tax_rates(rate, is_active)')
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) =>
    mapTaxAgencyRow(r, combinedRateFromRates(r.tax_rates as Row[] | null))
  );
}

export const salesTaxService = {
  /**
   * The CDTFA-style sales-tax liability report for an entry-date window. Sums posted
   * net credits to the 2200 account, attributes them to agencies via source invoices,
   * and surfaces any untied tax in the unattributed bucket. All aggregation is in the
   * pure salesTaxMath.ts (integer cents). Reads THROW on error.
   */
  async getSalesTaxLiability(range: DateRange = {}): Promise<SalesTaxLiabilityReport> {
    const liability = await resolveLiabilityAccount();

    // No liability account resolvable → a clearly-empty, unconfigured report (no guessing).
    if (!liability.id) {
      return buildSalesTaxLiability({
        range,
        liabilityAccountId: null,
        liabilityAccountNumber: liability.number,
        liabilityLines: [],
        invoices: [],
        agencies: await fetchAgencies(),
      });
    }

    // Posted journal lines that hit the liability account, in the entry-date window.
    // Inner-join the parent entry so we can filter status='posted' + entry_date and read
    // its source_type/source_id for attribution.
    let q = acct()
      .from('journal_lines')
      .select('debit, credit, entry:journal_entries!inner(id, status, entry_date, source_type, source_id)')
      .eq('account_id', liability.id)
      .eq('entry.status', 'posted');
    if (range.from) q = q.gte('entry.entry_date', range.from);
    if (range.to) q = q.lte('entry.entry_date', range.to);

    const { data, error } = await q;
    if (error) throw error;

    const liabilityLines: LiabilityLineInput[] = [];
    const invoiceIds = new Set<string>();
    for (const raw of (data ?? []) as Row[]) {
      const entry = (raw.entry ?? null) as Row | null;
      if (!entry) continue;
      const sourceType = String(entry.source_type ?? 'manual');
      const sourceId = entry.source_id == null ? null : String(entry.source_id);
      liabilityLines.push({
        journalEntryId: String(entry.id),
        sourceType,
        sourceId,
        debit: num(raw.debit),
        credit: num(raw.credit),
      });
      if (sourceType === 'invoice' && sourceId) invoiceIds.add(sourceId);
    }

    const [invoices, agencies] = await Promise.all([
      invoiceIds.size > 0 ? fetchInvoiceTaxInputs(Array.from(invoiceIds)) : Promise.resolve([]),
      fetchAgencies(),
    ]);

    return buildSalesTaxLiability({
      range,
      liabilityAccountId: liability.id,
      liabilityAccountNumber: liability.number,
      liabilityLines,
      invoices,
      agencies,
    });
  },

  /**
   * The read-only tax-calendar dashboard: upcoming/recent filing deadlines per agency,
   * soonest due first. Reads the `tax_filing_calendar` settings row for explicit rules
   * and falls back to each agency's own filing_frequency when a rule is absent. NO
   * notification is delivered — this only computes and returns the deadlines.
   *
   * @param asOf reference date `YYYY-MM-DD` (defaults to today). @param upcoming how many
   * upcoming periods to list per agency (default 4).
   */
  async getTaxFilingCalendar(asOf?: string, upcoming = 4): Promise<TaxCalendar> {
    const asOfIso = toIsoDate(asOf) ?? new Date().toISOString().slice(0, 10);

    const [rulesRaw, agencies] = await Promise.all([
      accountingSettingsService.getSetting('tax_filing_calendar'),
      fetchAgencies(),
    ]);
    const rules = parseTaxFilingRules(rulesRaw);
    const ruleByAgencyName = new Map(rules.map((r) => [r.agency, r]));

    const entries: TaxCalendarEntry[] = [];

    // One agency at a time: prefer its configured rule, else a frequency-derived fallback.
    for (const agency of agencies) {
      const rule = ruleByAgencyName.get(agency.name) ?? fallbackRuleFor(agency);
      entries.push(
        ...computeAgencyCalendar(rule, agency.id, agency.name, { asOf: asOfIso, upcoming })
      );
    }

    // Also surface any configured rule whose agency is NOT in the master (e.g. renamed),
    // so a stale config is visible rather than silently dropped.
    const agencyNames = new Set(agencies.map((a) => a.name));
    for (const rule of rules) {
      if (agencyNames.has(rule.agency)) continue;
      entries.push(...computeAgencyCalendar(rule, null, rule.agency, { asOf: asOfIso, upcoming }));
    }

    entries.sort((a, b) =>
      a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.agencyName.localeCompare(b.agencyName)
    );

    return { asOf: asOfIso, entries };
  },
};
