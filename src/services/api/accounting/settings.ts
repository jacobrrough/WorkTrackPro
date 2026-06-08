import type { DefaultAccounts, DunningConfig } from '../../../features/accounting/types';
import { toIsoDate } from '../../../features/accounting/periodLock';
import { acct } from './accountingClient';
import type { Row } from './mappers';

/**
 * Reads accounting.settings. The posting layer needs the `default_accounts`
 * mapping (AR / income / sales-tax / cash account ids) seeded by migration 3 so it
 * never hardcodes account numbers. Reads throw so React Query surfaces failures.
 */

const nstr = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * Map the `closed_through_date` settings value to a bare `YYYY-MM-DD` string, or null
 * when the books are open. The DB stores this KV row's value as a JSON date string
 * ("2026-01-31") or the JSON literal null (migration 20260601000016). supabase-js
 * surfaces a jsonb column already JSON-parsed, so the value arrives as a JS string or
 * null here — we still normalize defensively via toIsoDate (handles a stray timestamp
 * suffix and rejects anything that is not a calendar date). Pure; exported for tests.
 */
export function mapClosedThroughDate(value: unknown): string | null {
  return typeof value === 'string' ? toIsoDate(value) : null;
}

/** Map the snake_case default_accounts JSON blob to the camelCase domain shape. */
export function mapDefaultAccounts(value: Record<string, unknown> | null): DefaultAccounts {
  const v = value ?? {};
  return {
    cash: nstr(v.cash),
    undepositedFunds: nstr(v.undeposited_funds),
    accountsReceivable: nstr(v.accounts_receivable),
    // #10 progress-billing retainage asset (migration 20260608180100 adds this key).
    retainageReceivable: nstr(v.retainage_receivable),
    inventoryAsset: nstr(v.inventory_asset),
    accountsPayable: nstr(v.accounts_payable),
    salesTaxPayable: nstr(v.sales_tax_payable),
    salesIncome: nstr(v.sales_income),
    serviceIncome: nstr(v.service_income),
    cogs: nstr(v.cogs),
    operatingExpenses: nstr(v.operating_expenses),
    // D3 fixed-asset defaults (added to the blob by migration 20260601000018).
    fixedAsset: nstr(v.fixed_asset),
    accumulatedDepreciation: nstr(v.accumulated_depreciation),
    depreciationExpense: nstr(v.depreciation_expense),
    // COA-EXPAND structural defaults (added to the blob by migration 20260601000021).
    openingBalanceEquity: nstr(v.opening_balance_equity),
    uncategorizedIncome: nstr(v.uncategorized_income),
    uncategorizedExpense: nstr(v.uncategorized_expense),
    paymentProcessorClearing: nstr(v.payment_processor_clearing),
  };
}

/** Sensible defaults so the dunning panel always renders even before the seed row is read. */
export const DEFAULT_DUNNING_CONFIG: DunningConfig = {
  enabled: false,
  offsetsDays: [-3, 0, 7, 14],
  fromEmail: '',
  subjectTemplate: 'Invoice {{invoiceNumber}} — balance due {{balanceDue}}',
  bodyTemplate:
    'Hi {{customerName}},\n\nThis is a friendly reminder that invoice {{invoiceNumber}} has a balance due of {{balanceDue}}. You can view and download it from the secure link in this email.\n\nThank you.',
  maxPerRun: 200,
};

/** Map the stored 'dunning' JSON blob to the typed DunningConfig (defensive, never throws). */
export function mapDunningConfig(value: unknown): DunningConfig {
  const v = (value ?? {}) as Record<string, unknown>;
  const offsets = Array.isArray(v.offsetsDays)
    ? v.offsetsDays.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n))
    : DEFAULT_DUNNING_CONFIG.offsetsDays;
  const maxPerRun = Number.isFinite(Number(v.maxPerRun))
    ? Math.trunc(Number(v.maxPerRun))
    : DEFAULT_DUNNING_CONFIG.maxPerRun;
  const str = (x: unknown, fallback: string) => (typeof x === 'string' ? x : fallback);
  return {
    enabled: v.enabled === true,
    offsetsDays: [...new Set(offsets)].sort((a, b) => a - b),
    fromEmail: str(v.fromEmail, ''),
    subjectTemplate: str(v.subjectTemplate, DEFAULT_DUNNING_CONFIG.subjectTemplate),
    bodyTemplate: str(v.bodyTemplate, DEFAULT_DUNNING_CONFIG.bodyTemplate),
    maxPerRun: maxPerRun > 0 ? maxPerRun : DEFAULT_DUNNING_CONFIG.maxPerRun,
  };
}

export const accountingSettingsService = {
  /** Raw value for a settings key, or null when missing. */
  async getSetting(key: string): Promise<unknown> {
    const { data, error } = await acct()
      .from('settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();
    if (error) throw error;
    return (data as Row | null)?.setting_value ?? null;
  },

  /** Resolved default GL account ids used by the posting layer. */
  async getDefaultAccounts(): Promise<DefaultAccounts> {
    const value = (await this.getSetting('default_accounts')) as Record<string, unknown> | null;
    return mapDefaultAccounts(value);
  },

  /**
   * The current books-closed (period lock) date as `YYYY-MM-DD`, or null when the
   * books are open. No journal entry dated ON OR BEFORE this date may be posted or
   * voided (enforced by the DB guards in migration 20260601000016). Reads throw so
   * React Query surfaces failures.
   */
  async getClosedThroughDate(): Promise<string | null> {
    return mapClosedThroughDate(await this.getSetting('closed_through_date'));
  },

  /**
   * Set or clear the books-closed date. Calls the SECURITY DEFINER RPC
   * accounting.set_closed_through_date, which is accounting_admin-ONLY (a plain
   * accountant gets `insufficient_privilege`) and writes through the audited settings
   * table. Pass null to RE-OPEN the books (clear the lock). Returns a write-style
   * result; on failure `error` carries the DB message (e.g. the privilege error) for
   * inline display. Never throws on an expected DB rejection.
   */
  async setClosedThroughDate(date: string | null): Promise<{ ok: boolean; error?: string }> {
    // Normalize a UI value ("" from a cleared input, or a stray timestamp) to a bare
    // date or null, so we hand the RPC exactly a `date` or SQL NULL.
    const p_date = toIsoDate(date);
    const { error } = await acct().rpc('set_closed_through_date', { p_date });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * #6 — the dunning (invoice-reminder) config stored under the 'dunning' settings key.
   * Read returns DEFAULT_DUNNING_CONFIG when the row is absent. The SCHEDULED function is
   * separately hard-gated by the server env ACCOUNTING_DUNNING_ENABLED; `enabled` here is
   * the per-tenant soft switch on top of that gate.
   */
  async getDunningConfig(): Promise<DunningConfig> {
    const value = await this.getSetting('dunning');
    return value == null ? { ...DEFAULT_DUNNING_CONFIG } : mapDunningConfig(value);
  },

  /**
   * Upsert the 'dunning' config. Writes the typed blob back as JSON through the audited
   * accounting.settings table (RLS: accounting writer). Returns a write-style result so the
   * panel can show a DB error inline.
   */
  async setDunningConfig(config: DunningConfig): Promise<{ ok: boolean; error?: string }> {
    const normalized = mapDunningConfig(config);
    const { error } = await acct()
      .from('settings')
      .upsert({ setting_key: 'dunning', setting_value: normalized }, { onConflict: 'setting_key' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};
