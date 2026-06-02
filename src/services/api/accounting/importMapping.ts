/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING. Part of the FLAG-DARK import/migration module;
 *     requires CPA and/or security sign-off before enabling. HUMAN MUST VERIFY: account-
 *     mapping fidelity, no double-posting, and that opening balances reconcile to the
 *     source trial balance. The helpers below SUGGEST mappings and CHECK reconciliation;
 *     a human confirms every mapping in the wizard, and only an explicit admin commit
 *     posts anything (via accounting.commit_import_batch).
 *
 * Pure, dependency-free mapping + reconciliation helpers for the import/migration wizard.
 * No Supabase, no React — trivially unit-testable; zero weight in the flag-off bundle.
 *
 * Three jobs:
 *   1) suggestAccountMatch — propose a target accounting.accounts row for a parsed source
 *      account (exact number, then normalized name, then type-compatible) so the wizard
 *      pre-fills the dropdown. A human confirms or overrides.
 *   2) resolveMappedPayload — turn a staging row's candidate `mapped` (which references
 *      source account KEYS) into the exact shape commit_import_batch consumes (target
 *      account UUIDs bound from the account map). Surfaces any unresolved source key so a
 *      'ready' batch never carries an unbound account id.
 *   3) reconcileOpeningBalances — sum the opening-balance rows in INTEGER CENTS and report
 *      whether the source trial balance balances (Σdebits = Σcredits), plus the equity/
 *      liability offset plugs the commit will book. Lets the UI prove "reconciles to the
 *      source TB" before any admin commit.
 *
 * All money math is integer CENTS (G6).
 */
import type {
  Account,
  AccountType,
  ImportAccountMap,
  ImportOffset,
  MappedJournalEntry,
  MappedJournalLine,
  MappedOpeningBalance,
  ParsedSourceAccount,
} from '../../../features/accounting/types';
import { classifyAccountType } from './importParsers';

// ── Account-match suggestion ──────────────────────────────────────────────────

export type MatchConfidence = 'exact' | 'strong' | 'weak' | 'none';

export interface AccountMatchSuggestion {
  /** The suggested target account id, or null when nothing plausible matched. */
  targetAccountId: string | null;
  confidence: MatchConfidence;
  /** Why we suggested it (for the wizard's tooltip / a reviewer). */
  reason: string;
  /** When no target matched, the AccountType we inferred for a create-as-new default. */
  inferredType: AccountType | null;
}

/** Normalize an account name/number for comparison (case/space/punctuation-insensitive). */
function normName(v: string | null | undefined): string {
  return (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Suggest a target account in OUR chart for a parsed source account. Precedence:
 *   1) exact account-number match (when the source carries a number) → 'exact'
 *   2) exact normalized-name match → 'strong'
 *   3) the source name appears in (or contains) a target name, same inferred type → 'weak'
 *   4) nothing → 'none', with an inferred AccountType for a create-as-new default.
 * Inactive target accounts are never suggested.
 */
export function suggestAccountMatch(
  source: ParsedSourceAccount,
  chart: Account[]
): AccountMatchSuggestion {
  const active = chart.filter((a) => a.isActive);
  const cls = classifyAccountType(source.sourceAccountType);
  const inferredType = cls?.type ?? null;

  // The source key is the number when the parser used one; otherwise it's the name.
  const sourceKeyNorm = normName(source.sourceAccountKey);
  const sourceNameNorm = normName(source.sourceAccountName ?? source.sourceAccountKey);

  // 1) exact account-number match.
  const byNumber = active.find((a) => a.accountNumber && normName(a.accountNumber) === sourceKeyNorm);
  if (byNumber) {
    return {
      targetAccountId: byNumber.id,
      confidence: 'exact',
      reason: `Matched account number ${byNumber.accountNumber}.`,
      inferredType,
    };
  }

  // 2) exact normalized-name match.
  const byName = active.find((a) => normName(a.name) === sourceNameNorm && sourceNameNorm !== '');
  if (byName) {
    return {
      targetAccountId: byName.id,
      confidence: 'strong',
      reason: `Matched account name "${byName.name}".`,
      inferredType,
    };
  }

  // 3) substring match constrained to the inferred type (avoid cross-type false hits).
  if (sourceNameNorm.length >= 4) {
    const candidate = active.find((a) => {
      if (inferredType && a.accountType !== inferredType) return false;
      const an = normName(a.name);
      return an.includes(sourceNameNorm) || sourceNameNorm.includes(an);
    });
    if (candidate) {
      return {
        targetAccountId: candidate.id,
        confidence: 'weak',
        reason: `Name resembles "${candidate.name}"${inferredType ? ` (both ${inferredType})` : ''}. Verify.`,
        inferredType,
      };
    }
  }

  return {
    targetAccountId: null,
    confidence: 'none',
    reason: inferredType
      ? `No match; inferred type "${inferredType}" from "${source.sourceAccountType ?? '—'}". Map or create.`
      : 'No match and type could not be inferred. Map manually.',
    inferredType,
  };
}

/**
 * Build the source-key → target-account-id lookup from the account-map rows. Only rows
 * that resolved to a concrete target are included (create-as-new rows whose target was
 * filled in by the commit RPC are also included once they carry a targetAccountId).
 */
export function buildAccountResolution(maps: ImportAccountMap[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of maps) {
    if (row.status === 'ignored') continue;
    if (row.targetAccountId) m.set(row.sourceAccountKey, row.targetAccountId);
  }
  return m;
}

// ── Resolve a staged `mapped` payload to the DB-consumable shape ───────────────

export interface ResolveResult<T> {
  /** The resolved payload (target ids bound), or null when something is unresolved. */
  mapped: T | null;
  /** Source account keys that had no target in the resolution map. */
  unresolvedKeys: string[];
}

/**
 * Read a value from a payload by either its camelCase or snake_case key. The parser writes
 * camelCase CANDIDATES into staging; the resolve step rewrites them to snake_case (what the
 * commit RPC reads). Making the resolvers casing-tolerant keeps resolveAndPrepare IDEMPOTENT:
 * re-running it on an already-resolved (snake_case) row reads the same fields and re-resolves
 * to the same payload instead of treating it as unmapped.
 */
function dual(o: Record<string, unknown>, camel: string, snake: string): unknown {
  return o[camel] !== undefined ? o[camel] : o[snake];
}
function dualStr(o: Record<string, unknown>, camel: string, snake: string): string | null {
  const v = dual(o, camel, snake);
  return v == null ? null : String(v);
}
function dualNum(o: Record<string, unknown>, camel: string, snake: string): number {
  const v = dual(o, camel, snake);
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve an OPENING-BALANCE candidate payload: bind `targetAccountId` from the source key
 * via the resolution map. Accepts a camelCase candidate OR an already-resolved snake_case
 * payload (idempotent). A directly-set target id (a human picked one) wins. Returns the
 * unresolved key when neither a direct id nor a mapped source key resolves. The output is
 * always the camelCase domain shape (the service converts it to snake_case for the DB).
 */
export function resolveOpeningBalance(
  candidate: MappedOpeningBalance | Record<string, unknown>,
  resolution: Map<string, string>
): ResolveResult<MappedOpeningBalance> {
  const o = candidate as Record<string, unknown>;
  const directRaw = dualStr(o, 'targetAccountId', 'target_account_id');
  const direct = directRaw && directRaw.trim() !== '' ? directRaw : null;
  const sourceKey = dualStr(o, 'sourceAccountKey', 'source_account_key');
  const viaKey = sourceKey ? resolution.get(sourceKey) ?? null : null;
  const targetAccountId = direct ?? viaKey;
  if (!targetAccountId) {
    return { mapped: null, unresolvedKeys: [sourceKey ?? '(no source key)'] };
  }
  return {
    mapped: {
      targetAccountId,
      debitCents: dualNum(o, 'debitCents', 'debit_cents'),
      creditCents: dualNum(o, 'creditCents', 'credit_cents'),
      offset: (dualStr(o, 'offset', 'offset') as ImportOffset | null) ?? 'equity',
      memo: dualStr(o, 'memo', 'memo'),
      customerId: dualStr(o, 'customerId', 'customer_id'),
      vendorId: dualStr(o, 'vendorId', 'vendor_id'),
      jobId: dualStr(o, 'jobId', 'job_id'),
    },
    unresolvedKeys: [],
  };
}

/**
 * Resolve a JOURNAL-ENTRY candidate payload: bind every line's `accountId` from its source
 * key. Casing-tolerant + idempotent (accepts camelCase candidates or snake_case resolved
 * lines). Collects ALL unresolved keys rather than failing on the first. The output is the
 * camelCase domain shape (the service converts it to snake_case for the DB).
 */
export function resolveJournalEntry(
  candidate: MappedJournalEntry | Record<string, unknown>,
  resolution: Map<string, string>
): ResolveResult<MappedJournalEntry> {
  const o = candidate as Record<string, unknown>;
  const linesRaw = Array.isArray(o.lines) ? (o.lines as Array<Record<string, unknown>>) : [];
  const unresolvedKeys: string[] = [];
  const lines: MappedJournalLine[] = linesRaw.map((ln) => {
    const directRaw = dualStr(ln, 'accountId', 'account_id');
    const direct = directRaw && directRaw.trim() !== '' ? directRaw : null;
    const sourceKey = dualStr(ln, 'sourceAccountKey', 'source_account_key');
    const viaKey = sourceKey ? resolution.get(sourceKey) ?? null : null;
    const accountId = direct ?? viaKey;
    if (!accountId) unresolvedKeys.push(sourceKey ?? '(no source key)');
    return {
      accountId: accountId ?? '',
      debitCents: dualNum(ln, 'debitCents', 'debit_cents'),
      creditCents: dualNum(ln, 'creditCents', 'credit_cents'),
      memo: dualStr(ln, 'memo', 'memo'),
      customerId: dualStr(ln, 'customerId', 'customer_id'),
      vendorId: dualStr(ln, 'vendorId', 'vendor_id'),
      jobId: dualStr(ln, 'jobId', 'job_id'),
    };
  });
  if (unresolvedKeys.length > 0) return { mapped: null, unresolvedKeys };
  return { mapped: { memo: dualStr(o, 'memo', 'memo'), lines }, unresolvedKeys: [] };
}

// ── DB shape conversion (camelCase domain → snake_case the commit RPC reads) ───
//
// CRITICAL: accounting.commit_import_batch reads SNAKE_CASE keys from import_staging.mapped
// (`target_account_id`, `debit_cents`, `credit_cents`, `customer_id`, `vendor_id`, `job_id`,
// and per-line `account_id`; `offset` and `memo` are already single words). The camelCase
// domain payloads above are for the wizard/preview; what we PERSIST for commit must be the
// snake_case shape below, or the RPC reads NULLs and the opening balance posts wrong/empty.
// These converters are the single source of truth for that mapping; the service applies them
// to whatever it writes to import_staging.mapped.

/** The exact opening-balance jsonb shape the commit RPC consumes (snake_case). */
export interface DbMappedOpeningBalance {
  target_account_id: string;
  debit_cents: number;
  credit_cents: number;
  offset: ImportOffset;
  memo: string | null;
  customer_id: string | null;
  vendor_id: string | null;
  job_id: string | null;
}

/** The exact journal-entry jsonb shape the commit RPC consumes (snake_case lines). */
export interface DbMappedJournalLine {
  account_id: string;
  debit_cents: number;
  credit_cents: number;
  memo: string | null;
  customer_id: string | null;
  vendor_id: string | null;
  job_id: string | null;
}

export interface DbMappedJournalEntry {
  memo: string | null;
  lines: DbMappedJournalLine[];
}

/** Convert a resolved (camelCase) opening balance to the snake_case shape the RPC reads. */
export function toDbOpeningBalance(m: MappedOpeningBalance): DbMappedOpeningBalance {
  return {
    target_account_id: m.targetAccountId,
    debit_cents: Math.round(m.debitCents || 0),
    credit_cents: Math.round(m.creditCents || 0),
    offset: m.offset ?? 'equity',
    memo: m.memo ?? null,
    customer_id: m.customerId ?? null,
    vendor_id: m.vendorId ?? null,
    job_id: m.jobId ?? null,
  };
}

/** Convert a resolved (camelCase) journal entry to the snake_case shape the RPC reads. */
export function toDbJournalEntry(m: MappedJournalEntry): DbMappedJournalEntry {
  return {
    memo: m.memo ?? null,
    lines: m.lines.map((ln) => ({
      account_id: ln.accountId,
      debit_cents: Math.round(ln.debitCents || 0),
      credit_cents: Math.round(ln.creditCents || 0),
      memo: ln.memo ?? null,
      customer_id: ln.customerId ?? null,
      vendor_id: ln.vendorId ?? null,
      job_id: ln.jobId ?? null,
    })),
  };
}

// ── Reconciliation to the source trial balance ─────────────────────────────────

export interface OffsetPlug {
  offset: ImportOffset;
  /** The plug line booked to the offset account, integer cents (debit-positive). */
  debitCents: number;
  creditCents: number;
}

export interface OpeningBalanceReconciliation {
  /** Σ of all target-line debits across opening-balance rows (cents). */
  totalDebitCents: number;
  /** Σ of all target-line credits across opening-balance rows (cents). */
  totalCreditCents: number;
  /**
   * The offset plug lines the commit will book (one per used bucket) so the single
   * opening-balance entry balances. equity → 3050, liability → 2050.
   */
  plugs: OffsetPlug[];
  /**
   * True when the WHOLE entry (target lines + offset plugs) balances to the cent — it
   * always does by construction of the plugs, so this is really a sanity assertion. The
   * meaningful human check is `sourceBalances` below.
   */
  entryBalances: boolean;
  /**
   * True when the source trial balance ITSELF balances (Σ target debits = Σ target
   * credits) WITHOUT any plug. A well-formed source TB balances; if this is false, the
   * difference is being absorbed by Opening Balance Equity/Liabilities — surface it so a
   * human reconciles before committing.
   */
  sourceBalances: boolean;
  /** Σdebits − Σcredits across the target lines only (cents); 0 ⇒ source balances. */
  sourceImbalanceCents: number;
  /** Number of opening-balance rows considered (non-skipped, with a target). */
  rowCount: number;
}

/**
 * Reconcile a set of resolved opening-balance payloads in INTEGER CENTS. Computes the per-
 * bucket net so the offset plug(s) the commit RPC will book are known up front, and
 * reports whether the source TB balances on its own. Mirrors EXACTLY the offset math in
 * accounting.commit_import_batch (the offset carries the negative of each row's net
 * debit−credit), so the UI's preview equals what posts.
 */
export function reconcileOpeningBalances(
  rows: Array<MappedOpeningBalance | Record<string, unknown>>
): OpeningBalanceReconciliation {
  let totalDebitCents = 0;
  let totalCreditCents = 0;
  let netEquity = 0; // Σ(debit − credit) for rows whose offset bucket is equity.
  let netLiability = 0; // Σ(debit − credit) for rows whose offset bucket is liability.

  // Casing-tolerant: a row may be a camelCase candidate or a snake_case resolved payload.
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const d = Math.max(0, Math.round(dualNum(r, 'debitCents', 'debit_cents')));
    const c = Math.max(0, Math.round(dualNum(r, 'creditCents', 'credit_cents')));
    totalDebitCents += d;
    totalCreditCents += c;
    if ((dualStr(r, 'offset', 'offset') ?? 'equity') === 'liability') netLiability += d - c;
    else netEquity += d - c;
  }

  const plugs: OffsetPlug[] = [];
  // The offset carries the NEGATIVE of the bucket's net (a net debit excess needs a credit
  // plug, and vice versa) — identical to the RPC.
  if (netEquity !== 0) {
    plugs.push({
      offset: 'equity',
      debitCents: netEquity < 0 ? -netEquity : 0,
      creditCents: netEquity > 0 ? netEquity : 0,
    });
  }
  if (netLiability !== 0) {
    plugs.push({
      offset: 'liability',
      debitCents: netLiability < 0 ? -netLiability : 0,
      creditCents: netLiability > 0 ? netLiability : 0,
    });
  }

  const plugDebit = plugs.reduce((s, p) => s + p.debitCents, 0);
  const plugCredit = plugs.reduce((s, p) => s + p.creditCents, 0);
  const entryBalances = totalDebitCents + plugDebit === totalCreditCents + plugCredit;
  const sourceImbalanceCents = totalDebitCents - totalCreditCents;

  return {
    totalDebitCents,
    totalCreditCents,
    plugs,
    entryBalances,
    sourceBalances: sourceImbalanceCents === 0,
    sourceImbalanceCents,
    rowCount: rows.length,
  };
}

// ── Wizard completeness gates ──────────────────────────────────────────────────

/**
 * Is the account-map wizard complete enough to mark the batch 'ready'? Every map row must
 * be 'mapped' (has a target or create-as-new) or 'ignored'; a create-as-new row must carry
 * a new_account_type. Returns the blocking source keys (empty ⇒ complete).
 */
export function accountMapBlockers(maps: ImportAccountMap[]): string[] {
  const blockers: string[] = [];
  for (const row of maps) {
    if (row.status === 'ignored') continue;
    if (row.createAsNew) {
      if (!row.newAccountType) blockers.push(`${row.sourceAccountKey} (create-as-new needs a type)`);
      continue;
    }
    if (!row.targetAccountId) blockers.push(`${row.sourceAccountKey} (unmapped)`);
  }
  return blockers;
}

/** Derive the normal balance from an account type (asset/expense → debit, else credit). */
export function normalBalanceForType(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}
