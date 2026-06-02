/**
 * Pure bank-rules engine (A4 Banking).
 *
 * `applyRules` decides how a single imported transaction should be auto-categorized
 * by running it against the active `accounting.bank_rules`. It is deliberately free
 * of React/Supabase so the matching logic is trivially unit-testable; the service
 * (bankTransactions.import / autoCategorize) feeds it rows and persists the result
 * (set category_account_id / vendor + stamp applied_rule_id).
 *
 * SELECTION: the FIRST matching rule wins, where rules are ordered by `priority`
 * DESC and then by their original order (stable) — mirroring how the service should
 * fetch them (`order('priority', desc)`). A rule with a null `bankAccountId` is a
 * global rule that applies to every account; a rule scoped to a bank account only
 * matches transactions on that account.
 *
 * MATCHING:
 *   • description / merchant (text) support `contains` (case-insensitive substring),
 *     `equals` (case-insensitive exact), and `regex` (JS RegExp, case-insensitive).
 *   • amount supports `gt` / `lt`, compared against the transaction's MAGNITUDE
 *     (absolute dollars) — users author "amount > 100" thinking in positive dollars;
 *     the sign encodes deposit/withdrawal, not size. `contains`/`equals` on amount
 *     compare the formatted magnitude string ("42.5").
 * An invalid regex never throws — it simply doesn't match (and is reported as a
 * skipped rule via `validateRule` for the UI).
 */
import type {
  BankRule,
  BankTransaction,
  ParsedBankTransaction,
  RuleMatch,
} from '../../../features/accounting/types';

/** The subset of a transaction the engine reads (works for parsed or persisted rows). */
export type RuleEvaluable = Pick<
  BankTransaction,
  'amount' | 'description' | 'merchant'
> & { bankAccountId?: string | null };

const lc = (v: string | null | undefined): string => (v ?? '').toLowerCase();

/** True when a single rule matches a transaction. Pure; never throws. */
export function ruleMatches(rule: BankRule, txn: RuleEvaluable): boolean {
  if (!rule.isActive) return false;
  if (!rule.matchField || !rule.matchOp) return false;
  // Account scope: a rule bound to an account only applies to that account.
  if (rule.bankAccountId && txn.bankAccountId && rule.bankAccountId !== txn.bankAccountId) {
    return false;
  }
  const value = rule.matchValue ?? '';

  if (rule.matchField === 'amount') {
    const magnitude = Math.abs(txn.amount);
    if (rule.matchOp === 'gt' || rule.matchOp === 'lt') {
      const threshold = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(threshold)) return false;
      return rule.matchOp === 'gt' ? magnitude > threshold : magnitude < threshold;
    }
    // contains/equals/regex on amount compare its formatted magnitude.
    return textMatch(rule.matchOp, value, formatMagnitude(magnitude));
  }

  // Text fields. gt/lt are meaningless on text → no match.
  if (rule.matchOp === 'gt' || rule.matchOp === 'lt') return false;
  const haystack = rule.matchField === 'description' ? lc(txn.description) : lc(txn.merchant);
  return textMatch(rule.matchOp, value, haystack);
}

/** Case-insensitive text comparison for contains/equals/regex. `haystack` is pre-lowercased. */
function textMatch(op: 'contains' | 'equals' | 'regex', rawValue: string, haystack: string): boolean {
  const needle = rawValue.toLowerCase();
  if (op === 'contains') return needle !== '' && haystack.includes(needle);
  if (op === 'equals') return haystack === needle;
  // regex
  try {
    return new RegExp(rawValue, 'i').test(haystack);
  } catch {
    return false; // invalid pattern never matches (and never throws)
  }
}

/** Format a magnitude the way an `amount` text match expects ("42.5", "1000"). */
function formatMagnitude(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Apply the rule set to one transaction and return the winning match, or null.
 * Rules are evaluated in the given order; the caller is responsible for supplying
 * them priority-sorted (priority desc). The first rule that both matches AND sets at
 * least one of (account, vendor) wins — a rule that matches but assigns nothing is
 * skipped so it can't silently swallow a transaction from a later, useful rule.
 */
export function applyRules(txn: RuleEvaluable, rules: BankRule[]): RuleMatch | null {
  for (const rule of rules) {
    if (!ruleMatches(rule, txn)) continue;
    if (!rule.setAccountId && !rule.setVendorId) continue;
    return {
      setAccountId: rule.setAccountId ?? null,
      setVendorId: rule.setVendorId ?? null,
      ruleId: rule.id,
    };
  }
  return null;
}

/**
 * Bulk-apply rules to many parsed transactions (e.g. right after an import). Returns
 * a parallel array of matches (null where nothing matched) so the caller can stamp
 * category/vendor/applied_rule_id per row in one pass.
 */
export function applyRulesToBatch(
  txns: ParsedBankTransaction[],
  rules: BankRule[],
  bankAccountId: string
): (RuleMatch | null)[] {
  return txns.map((t) =>
    applyRules({ amount: t.amount, description: t.description, merchant: t.merchant, bankAccountId }, rules)
  );
}

/**
 * Validate a rule's shape before saving (UI-facing). Returns an error message or
 * null. Notably catches an invalid regex pattern and a non-numeric amount threshold
 * so a bad rule is rejected at authoring time rather than silently never matching.
 */
export function validateRule(rule: {
  matchField?: string | null;
  matchOp?: string | null;
  matchValue?: string | null;
  setAccountId?: string | null;
  setVendorId?: string | null;
}): string | null {
  if (!rule.matchField) return 'Choose a field to match (description, merchant, or amount).';
  if (!rule.matchOp) return 'Choose how to match (contains, equals, regex, greater/less than).';
  if (!rule.matchValue || rule.matchValue.trim() === '') return 'Enter a value to match against.';
  if (!rule.setAccountId && !rule.setVendorId) {
    return 'A rule must set a category account and/or a vendor.';
  }
  if (rule.matchField === 'amount') {
    if (rule.matchOp === 'gt' || rule.matchOp === 'lt') {
      const n = Number.parseFloat(rule.matchValue.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(n)) return 'Enter a numeric amount for a greater/less-than rule.';
    }
  } else if (rule.matchOp === 'gt' || rule.matchOp === 'lt') {
    return 'Greater/less-than only applies to the amount field.';
  }
  if (rule.matchOp === 'regex') {
    try {
      new RegExp(rule.matchValue, 'i');
    } catch {
      return 'That regular expression is not valid.';
    }
  }
  return null;
}
