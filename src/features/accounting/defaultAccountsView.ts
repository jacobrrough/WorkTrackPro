/**
 * COA-EXPAND — pure view helpers for the read-only "Default GL accounts" panel on the
 * Accounting Settings screen. They turn the resolved `settings.default_accounts` mapping
 * (DefaultAccounts, ids) plus the chart of accounts into render-ready rows that name which
 * account each posting role resolves to. NO money math, NO I/O — just a join + labels —
 * so this whole module is trivially unit-testable (mirrors periodLockView.ts).
 *
 * Why a UI panel at all: COA-EXPAND adds STRUCTURAL accounts (3050 Opening Balance Equity,
 * 2050 Opening Balance Liabilities, 1250/4900/6900 uncategorized inboxes, 1260 Payment
 * Processor Clearing) that LATER modules post against by KEY, not by hardcoded id. Before
 * those modules (import/migration, A4 bank-feed rules) go live, an admin needs to SEE that
 * each key actually resolves to the expected chart account — this panel is that proof. It
 * is read-only: the mapping is seeded by migration (…003/…018/…021), so the UI never writes
 * it (consistent with the API lane, which added no mutation).
 */
import type { Account, DefaultAccounts } from './types';

/**
 * Which group a default-account row belongs to, so the panel can foreground the new
 * COA-EXPAND structural accounts (the reason this module exists) above the long-standing
 * core mappings.
 */
export type DefaultAccountGroup = 'structural' | 'core';

/**
 * One default-account mapping to render: the human label, the `DefaultAccounts` key it
 * reads, the account NUMBER it is expected to resolve to (per the seeding migration —
 * shown as a hint so a mis-seed is obvious), and a one-line "why it matters".
 */
export interface DefaultAccountSpec {
  /** The DefaultAccounts field this row reads (also the stable React key). */
  key: keyof DefaultAccounts;
  /** Human label for the posting role. */
  label: string;
  /** Account number this key is seeded to resolve to (display hint only). */
  expectedNumber: string;
  /** One-line description of what posts here / why it matters. */
  description: string;
  group: DefaultAccountGroup;
}

/**
 * The default-account mappings worth surfacing, in display order. The COA-EXPAND
 * structural accounts come first (they are the point of this module); the core
 * AR/income/sales-tax/cash mappings (seeded by migration …003) follow for completeness.
 * This is a curated subset of DefaultAccounts — every entry corresponds to a real seeded
 * key; not every DefaultAccounts field needs a row.
 */
export const DEFAULT_ACCOUNT_SPECS: DefaultAccountSpec[] = [
  // ── COA-EXPAND structural accounts (migration 20260601000021) ─────────────────
  {
    key: 'openingBalanceEquity',
    label: 'Opening Balance Equity',
    expectedNumber: '3050',
    description: 'Equity offset the import/migration module posts historical opening balances against.',
    group: 'structural',
  },
  {
    key: 'uncategorizedIncome',
    label: 'Uncategorized Income',
    expectedNumber: '4900',
    description: 'Bank-feed income inbox; the A4 rules engine recategorizes rows out of it.',
    group: 'structural',
  },
  {
    key: 'uncategorizedExpense',
    label: 'Uncategorized Expense',
    expectedNumber: '6900',
    description: 'Bank-feed expense inbox for transactions awaiting a category.',
    group: 'structural',
  },
  {
    key: 'paymentProcessorClearing',
    label: 'Payment Processor Clearing',
    expectedNumber: '1260',
    description: 'Holds Stripe/PayPal money in transit until it settles into the bank.',
    group: 'structural',
  },
  // ── Core mappings (migration 20260601000003) ──────────────────────────────────
  {
    key: 'accountsReceivable',
    label: 'Accounts Receivable',
    expectedNumber: '1200',
    description: 'Debited when an invoice is sent; cleared when the customer pays.',
    group: 'core',
  },
  {
    key: 'accountsPayable',
    label: 'Accounts Payable',
    expectedNumber: '2000',
    description: 'Credited when a bill is entered; cleared when the vendor is paid.',
    group: 'core',
  },
  {
    key: 'salesIncome',
    label: 'Sales Income',
    expectedNumber: '4000',
    description: 'Default income account for invoice lines that name no other.',
    group: 'core',
  },
  {
    key: 'salesTaxPayable',
    label: 'Sales Tax Payable',
    expectedNumber: '2200',
    description: 'Liability the sales tax collected on invoices accrues to.',
    group: 'core',
  },
  {
    key: 'cash',
    label: 'Cash / bank',
    expectedNumber: '1000',
    description: 'Default cash account payments are deposited to and disbursements drawn from.',
    group: 'core',
  },
  {
    key: 'cogs',
    label: 'Cost of Goods Sold',
    expectedNumber: '5000',
    description: 'Debited when inventory is relieved to COGS on job consumption.',
    group: 'core',
  },
];

/** A spec resolved against the chart of accounts: the configured account, or null. */
export interface ResolvedDefaultAccount extends DefaultAccountSpec {
  /** The account id from settings.default_accounts for this key, or null if unset. */
  accountId: string | null;
  /** The matching chart-of-accounts account, or null if unset / not found. */
  account: Account | null;
  /** True when the key has an id AND that id matches a real account. */
  configured: boolean;
}

/**
 * Resolve every default-account spec against the live mapping + chart of accounts. Pure:
 * builds an id→account index and joins. An unset key (null id) or a dangling id (no
 * matching account) both yield `configured: false` so the panel can flag it for an admin
 * to fix before the consumer modules run.
 */
export function resolveDefaultAccounts(
  defaults: DefaultAccounts | null | undefined,
  accounts: Account[]
): ResolvedDefaultAccount[] {
  const byId = new Map<string, Account>();
  for (const a of accounts) byId.set(a.id, a);

  return DEFAULT_ACCOUNT_SPECS.map((spec) => {
    const accountId = defaults ? (defaults[spec.key] ?? null) : null;
    const account = accountId ? (byId.get(accountId) ?? null) : null;
    return { ...spec, accountId, account, configured: account != null };
  });
}

/** Resolved rows for one group, preserving DEFAULT_ACCOUNT_SPECS order. */
export function resolvedByGroup(
  rows: ResolvedDefaultAccount[],
  group: DefaultAccountGroup
): ResolvedDefaultAccount[] {
  return rows.filter((r) => r.group === group);
}

/**
 * Short summary for the panel header, e.g. "3 of 4 configured". Counts only the rows in
 * the given group (or all rows when no group is passed).
 */
export function configuredSummary(
  rows: ResolvedDefaultAccount[],
  group?: DefaultAccountGroup
): { configured: number; total: number; label: string } {
  const scoped = group ? resolvedByGroup(rows, group) : rows;
  const configured = scoped.filter((r) => r.configured).length;
  const total = scoped.length;
  return { configured, total, label: `${configured} of ${total} configured` };
}
