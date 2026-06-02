/**
 * Pure presentation helpers for the PHASE E SECURITY HARDENING screens (UI lane).
 * No React, no Supabase — trivially unit-testable (see securityView.test.ts).
 *
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. The whole module is FLAG-DARK and
 *     requires a SECURITY review before it is enabled; every security screen renders the
 *     UnverifiedBanner. NOTHING in this module moves money or posts a journal entry.
 *
 * This file turns the raw security read-models (encryption coverage counts, the audit
 * hash-chain status/verification, the role grants, and the read-only rate-limit / backup
 * blobs) into the human strings, badges, and tone classes the screens render — kept here
 * (not inline in the components) so the labels, the cutover math, the chain-status
 * interpretation, and the field/role display names are covered by fast tests and stay
 * consistent across the four screens.
 *
 * A COVERAGE figure here is a COUNT of rows, never a monetary value — there is no
 * integer-cents treatment. A pay-rate figure surfaced anywhere in this module is a count of
 * rows holding an encrypted value, not a dollar amount.
 */

import type {
  AccountingRoleKey,
  AuditChainStatus,
  AuditChainVerifyRow,
  BackupPolicy,
  EncryptionCoverageRow,
  SecurityRateLimits,
  UserRoleSummary,
} from './types';
import { ACCOUNTING_ROLE_KEYS, ACCOUNTING_ROLE_LABELS } from './types';

// ── Tone vocabulary (matches the dark-theme classes the screens already use) ───────────

/** A semantic tone the screens map to Tailwind classes (kept abstract so tests are stable). */
export type SecurityTone = 'good' | 'warn' | 'bad' | 'neutral';

/** Map a semantic tone to the dark-theme badge classes the screens use. */
export function toneBadgeClass(tone: SecurityTone): string {
  switch (tone) {
    case 'good':
      return 'bg-green-500/15 text-green-300';
    case 'warn':
      return 'bg-amber-500/15 text-amber-300';
    case 'bad':
      return 'bg-red-500/15 text-red-300';
    default:
      return 'bg-white/10 text-slate-400';
  }
}

/** Map a semantic tone to a left-border accent for a row/card. */
export function toneBorderClass(tone: SecurityTone): string {
  switch (tone) {
    case 'good':
      return 'border-green-500/30';
    case 'warn':
      return 'border-amber-500/30';
    case 'bad':
      return 'border-red-500/40';
    default:
      return 'border-white/10';
  }
}

/** Map a tone to a progress-bar fill color (encryption cutover). */
export function toneBarClass(tone: SecurityTone): string {
  switch (tone) {
    case 'good':
      return 'bg-green-500';
    case 'warn':
      return 'bg-amber-500';
    case 'bad':
      return 'bg-red-500';
    default:
      return 'bg-white/20';
  }
}

// ── E1: encryption coverage / cutover progress ─────────────────────────────────────────

/** Human-friendly label for a sensitive field key ("vendors.tax_id" → "Vendor tax ID"). */
const FIELD_LABELS: Record<string, string> = {
  'vendors.tax_id': 'Vendor tax ID',
  'bank_accounts.mask': 'Bank account mask',
  'employees.ssn': 'Employee SSN',
  'employees.bank_routing': 'Employee bank routing',
  'employees.bank_account': 'Employee bank account',
  'employees.pay_rate_cents': 'Employee pay rate',
};

/** Display name for a coverage field; falls back to the raw "table.column" key. */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Per-field cutover percentage: encrypted ÷ plaintext, as an integer 0–100. When there is no
 * plaintext to migrate (plaintextCount === 0) the field is vacuously complete → 100. Encrypted
 * never exceeds the denominator for display purposes (clamped), so a shadow over-count cannot
 * read as >100%.
 */
export function coveragePercent(
  row: Pick<EncryptionCoverageRow, 'plaintextCount' | 'encryptedCount'>
): number {
  const plaintext = Math.max(0, Math.floor(row.plaintextCount));
  const encrypted = Math.max(0, Math.floor(row.encryptedCount));
  if (plaintext === 0) return 100;
  const pct = Math.round((Math.min(encrypted, plaintext) / plaintext) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** A short cutover status label for one field, driven by its pending count. */
export function coverageStatusLabel(
  row: Pick<EncryptionCoverageRow, 'plaintextCount' | 'encryptedCount' | 'pendingCount'>
): string {
  if (row.plaintextCount === 0 && row.encryptedCount === 0) return 'No data';
  if (row.pendingCount === 0) return 'Migrated';
  if (row.encryptedCount === 0) return 'Plaintext only';
  return `${row.pendingCount} pending`;
}

/** Tone for a field's cutover row: complete → good, partway → warn, nothing migrated yet → bad. */
export function coverageTone(
  row: Pick<EncryptionCoverageRow, 'plaintextCount' | 'encryptedCount' | 'pendingCount'>
): SecurityTone {
  if (row.plaintextCount === 0 && row.encryptedCount === 0) return 'neutral';
  if (row.pendingCount === 0) return 'good';
  if (row.encryptedCount === 0) return 'bad';
  return 'warn';
}

/** Total rows still awaiting backfill across every field (Σ pendingCount). */
export function totalPending(rows: EncryptionCoverageRow[]): number {
  return rows.reduce((sum, r) => sum + Math.max(0, r.pendingCount), 0);
}

/**
 * One-line headline for the whole encryption section. Foregrounds that the accessors are the
 * CUTOVER seam and the live forms still write plaintext (G8), so "0 pending" never reads as
 * "encryption is live".
 */
export function coverageHeadline(rows: EncryptionCoverageRow[]): string {
  if (rows.length === 0) return 'No sensitive fields are tracked yet.';
  const pending = totalPending(rows);
  if (pending === 0) {
    return 'Every tracked value has a ciphertext shadow. Plaintext columns are retired only after sign-off.';
  }
  return `${pending} value${pending === 1 ? '' : 's'} across ${rows.length} field${
    rows.length === 1 ? '' : 's'
  } still hold only plaintext. The live forms write plaintext until the post-sign-off cutover.`;
}

// ── E2: audit hash-chain integrity ──────────────────────────────────────────────────────

/** The integrity badge text for the audit hash-chain status. */
export function chainBadgeLabel(status: AuditChainStatus | null | undefined): string {
  if (!status) return 'Unknown';
  if (status.firstBreakSeq != null && !status.verified) return 'Tamper detected';
  if (status.verified) {
    return status.unchainedRows > 0 ? 'Intact (backfill pending)' : 'Intact';
  }
  // Not verified but no break sequence reported → treat as not-yet-established.
  return 'Not established';
}

/** The integrity badge tone: a real break is bad, a pending backfill is a warn, intact is good. */
export function chainBadgeTone(status: AuditChainStatus | null | undefined): SecurityTone {
  if (!status) return 'neutral';
  if (status.firstBreakSeq != null && !status.verified) return 'bad';
  if (status.verified) return status.unchainedRows > 0 ? 'warn' : 'good';
  return 'warn';
}

/** A sentence describing the chain status for the overview card. */
export function chainSummary(status: AuditChainStatus | null | undefined): string {
  if (!status) return 'The audit-chain status is unavailable.';
  if (status.firstBreakSeq != null && !status.verified) {
    return `The hash chain breaks at sequence ${status.firstBreakSeq}. ${status.chainedRows} row${
      status.chainedRows === 1 ? '' : 's'
    } verified before the break. Investigate before trusting the audit log.`;
  }
  if (status.verified) {
    const base = `All ${status.chainedRows} chained audit row${
      status.chainedRows === 1 ? '' : 's'
    } verify against the SHA-256 hash chain.`;
    if (status.unchainedRows > 0) {
      return `${base} ${status.unchainedRows} legacy row${
        status.unchainedRows === 1 ? '' : 's'
      } pre-date the chain and await the one-time backfill.`;
    }
    return base;
  }
  return `The hash chain is not yet established. ${status.unchainedRows} legacy row${
    status.unchainedRows === 1 ? '' : 's'
  } await the one-time backfill.`;
}

/** Whether the supervised one-time backfill button should be offered (legacy rows remain). */
export function canBackfill(status: AuditChainStatus | null | undefined): boolean {
  return !!status && status.unchainedRows > 0;
}

/** Truncate a hex hash for compact display ("abc…ef0"); null/short values pass through. */
export function shortHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Tone for a single verification row (the genesis/ok rows are good, a failing row is bad). */
export function verifyRowTone(row: Pick<AuditChainVerifyRow, 'ok'>): SecurityTone {
  return row.ok ? 'good' : 'bad';
}

/** Count of failing rows in a verification result (almost always 0 or 1 — the DB reports the first break once). */
export function failingRowCount(rows: AuditChainVerifyRow[]): number {
  return rows.reduce((n, r) => n + (r.ok ? 0 : 1), 0);
}

/** A one-line summary of a full verification pass for the detail screen header. */
export function verificationSummary(rows: AuditChainVerifyRow[]): string {
  if (rows.length === 0) return 'No chained audit rows to verify yet.';
  const failing = failingRowCount(rows);
  if (failing === 0) {
    return `All ${rows.length} inspected row${rows.length === 1 ? '' : 's'} verify.`;
  }
  const firstBreak = rows.find((r) => !r.ok);
  return `Verification failed at sequence ${firstBreak?.chainSeq ?? '?'}: ${
    firstBreak?.reason ?? 'unknown reason'
  }.`;
}

// ── E5: read-only rate-limit summary ─────────────────────────────────────────────────────

/** Format a byte count compactly for the body-cap display (262144 → "256 KB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb % 1 === 0 ? kb : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb % 1 === 0 ? mb : mb.toFixed(1)} MB`;
}

/** A labelled rate-limit row for the read-only Security Overview table. */
export interface RateLimitDisplayRow {
  label: string;
  value: string;
}

/** Turn the rate-limit blob into labelled display rows (per the seeded shape). */
export function rateLimitRows(limits: SecurityRateLimits): RateLimitDisplayRow[] {
  return [
    { label: 'Default (per route)', value: `${limits.defaultPerMinute} / min` },
    { label: 'Tax-table refresh', value: `${limits.taxRefreshPerHour} / hour` },
    { label: 'Submit proposal', value: `${limits.submitProposalPerHour} / hour` },
    { label: 'Gmail add-on', value: `${limits.addonPerMinute} / min` },
    { label: 'Max request body', value: formatBytes(limits.maxBodyBytes) },
  ];
}

// ── E4: read-only backup policy ───────────────────────────────────────────────────────────

/** A labelled backup-policy row for the read-only Backup/Restore STUB screen. */
export interface BackupPolicyDisplayRow {
  label: string;
  value: string;
}

/** Turn the backup-policy blob into labelled display rows. */
export function backupPolicyRows(policy: BackupPolicy): BackupPolicyDisplayRow[] {
  return [
    { label: 'Schedule', value: policy.schedule },
    { label: 'Encryption', value: policy.encryption },
    {
      label: 'Retention',
      value: `${policy.retentionDays} day${policy.retentionDays === 1 ? '' : 's'}`,
    },
    { label: 'Restore mode', value: policy.restoreMode },
    { label: 'Point-in-time recovery', value: policy.pitrExpectation },
  ];
}

// ── RBAC: role display helpers ──────────────────────────────────────────────────────────────

/** A display label for a role key (falls back to the raw key for an unexpected value). */
export function roleLabel(role: AccountingRoleKey | string): string {
  return ACCOUNTING_ROLE_LABELS[role as AccountingRoleKey] ?? String(role);
}

/** The roles a user holds, in the canonical privilege order (admin → … → viewer), labelled. */
export function orderedRoleLabels(roles: AccountingRoleKey[]): string[] {
  return ACCOUNTING_ROLE_KEYS.filter((k) => roles.includes(k)).map(
    (k) => ACCOUNTING_ROLE_LABELS[k]
  );
}

/** The display label for one user-role summary row (name → email → id). */
export function userDisplayLabel(
  summary: Pick<UserRoleSummary, 'userName' | 'userEmail' | 'userId'>
): string {
  return summary.userName || summary.userEmail || summary.userId;
}

/** A short secondary line for a user row (email when a name is shown; the id otherwise). */
export function userSecondaryLabel(
  summary: Pick<UserRoleSummary, 'userName' | 'userEmail' | 'userId'>
): string {
  if (summary.userName && summary.userEmail) return summary.userEmail;
  if (!summary.userName && summary.userEmail) return summary.userId;
  return summary.userId;
}

/** The roles NOT yet held by a user — the grantable set for the "add role" picker. */
export function grantableRoles(held: AccountingRoleKey[]): AccountingRoleKey[] {
  return ACCOUNTING_ROLE_KEYS.filter((k) => !held.includes(k));
}

/** A one-line summary of the whole RBAC grant set for the screen header. */
export function rbacSummary(summaries: UserRoleSummary[]): string {
  if (summaries.length === 0) return 'No accounting roles are granted yet.';
  const grants = summaries.reduce((n, s) => n + s.roles.length, 0);
  return `${grants} role grant${grants === 1 ? '' : 's'} across ${summaries.length} user${
    summaries.length === 1 ? '' : 's'
  }.`;
}
