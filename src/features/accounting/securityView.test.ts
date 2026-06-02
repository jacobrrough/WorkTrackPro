import { describe, it, expect } from 'vitest';
import {
  backupPolicyRows,
  canBackfill,
  chainBadgeLabel,
  chainBadgeTone,
  chainSummary,
  coverageHeadline,
  coveragePercent,
  coverageStatusLabel,
  coverageTone,
  failingRowCount,
  fieldLabel,
  formatBytes,
  grantableRoles,
  orderedRoleLabels,
  rateLimitRows,
  rbacSummary,
  roleLabel,
  shortHash,
  toneBadgeClass,
  toneBarClass,
  toneBorderClass,
  totalPending,
  userDisplayLabel,
  userSecondaryLabel,
  verificationSummary,
  verifyRowTone,
} from './securityView';
import type {
  AuditChainStatus,
  AuditChainVerifyRow,
  BackupPolicy,
  EncryptionCoverageRow,
  SecurityRateLimits,
  UserRoleSummary,
} from './types';

/**
 * PHASE E — SECURITY HARDENING (HELD / UNVERIFIED — NOT FOR FILING) presenter tests.
 * Pure display logic only; nothing here carries a monetary value or posts a journal entry.
 */

function covRow(over: Partial<EncryptionCoverageRow> = {}): EncryptionCoverageRow {
  const plaintextCount = over.plaintextCount ?? 0;
  const encryptedCount = over.encryptedCount ?? 0;
  return {
    field: over.field ?? 'vendors.tax_id',
    plaintextCount,
    encryptedCount,
    pendingCount: over.pendingCount ?? Math.max(plaintextCount - encryptedCount, 0),
  };
}

describe('encryption coverage presenters', () => {
  it('labels known fields and falls back to the raw key', () => {
    expect(fieldLabel('vendors.tax_id')).toBe('Vendor tax ID');
    expect(fieldLabel('employees.ssn')).toBe('Employee SSN');
    expect(fieldLabel('something.unknown')).toBe('something.unknown');
  });

  it('computes an integer cutover percent and clamps a shadow over-count to 100', () => {
    expect(coveragePercent({ plaintextCount: 4, encryptedCount: 1 })).toBe(25);
    expect(coveragePercent({ plaintextCount: 4, encryptedCount: 4 })).toBe(100);
    // more encrypted than plaintext (shadow over-count) must not exceed 100
    expect(coveragePercent({ plaintextCount: 2, encryptedCount: 5 })).toBe(100);
  });

  it('treats a field with no plaintext as vacuously complete (100%)', () => {
    expect(coveragePercent({ plaintextCount: 0, encryptedCount: 0 })).toBe(100);
  });

  it('produces a status label per state', () => {
    expect(coverageStatusLabel(covRow({ plaintextCount: 0, encryptedCount: 0 }))).toBe('No data');
    expect(coverageStatusLabel(covRow({ plaintextCount: 3, encryptedCount: 3 }))).toBe('Migrated');
    expect(coverageStatusLabel(covRow({ plaintextCount: 3, encryptedCount: 0 }))).toBe('Plaintext only');
    expect(coverageStatusLabel(covRow({ plaintextCount: 3, encryptedCount: 1 }))).toBe('2 pending');
  });

  it('assigns the right tone per state', () => {
    expect(coverageTone(covRow({ plaintextCount: 0, encryptedCount: 0 }))).toBe('neutral');
    expect(coverageTone(covRow({ plaintextCount: 3, encryptedCount: 3 }))).toBe('good');
    expect(coverageTone(covRow({ plaintextCount: 3, encryptedCount: 0 }))).toBe('bad');
    expect(coverageTone(covRow({ plaintextCount: 3, encryptedCount: 1 }))).toBe('warn');
  });

  it('sums pending counts and floors negatives', () => {
    const rows = [
      covRow({ field: 'vendors.tax_id', plaintextCount: 5, encryptedCount: 2 }), // 3
      covRow({ field: 'employees.ssn', plaintextCount: 1, encryptedCount: 4, pendingCount: 0 }), // floored
    ];
    expect(totalPending(rows)).toBe(3);
  });

  it('headlines the cutover state without ever implying encryption is live at 0 pending', () => {
    expect(coverageHeadline([])).toMatch(/No sensitive fields/i);
    const done = coverageHeadline([covRow({ plaintextCount: 2, encryptedCount: 2 })]);
    expect(done).toMatch(/sign-off/i);
    const pending = coverageHeadline([covRow({ plaintextCount: 2, encryptedCount: 0 })]);
    expect(pending).toMatch(/plaintext/i);
    expect(pending).toMatch(/2 values/i);
  });
});

function status(over: Partial<AuditChainStatus> = {}): AuditChainStatus {
  return {
    verified: over.verified ?? true,
    chainedRows: over.chainedRows ?? 5,
    unchainedRows: over.unchainedRows ?? 0,
    firstBreakSeq: over.firstBreakSeq ?? null,
  };
}

describe('audit hash-chain presenters', () => {
  it('badges an intact, fully-chained status', () => {
    expect(chainBadgeLabel(status())).toBe('Intact');
    expect(chainBadgeTone(status())).toBe('good');
  });

  it('badges a verified chain with pending legacy rows as a warning', () => {
    const s = status({ verified: true, unchainedRows: 3 });
    expect(chainBadgeLabel(s)).toBe('Intact (backfill pending)');
    expect(chainBadgeTone(s)).toBe('warn');
  });

  it('badges a real break as a tamper (bad)', () => {
    const s = status({ verified: false, firstBreakSeq: 8 });
    expect(chainBadgeLabel(s)).toBe('Tamper detected');
    expect(chainBadgeTone(s)).toBe('bad');
    expect(chainSummary(s)).toMatch(/breaks at sequence 8/);
  });

  it('badges a not-yet-established chain (no break, not verified) as a warning', () => {
    const s = status({ verified: false, firstBreakSeq: null, chainedRows: 0, unchainedRows: 4 });
    expect(chainBadgeLabel(s)).toBe('Not established');
    expect(chainBadgeTone(s)).toBe('warn');
  });

  it('degrades a null status conservatively', () => {
    expect(chainBadgeLabel(null)).toBe('Unknown');
    expect(chainBadgeTone(null)).toBe('neutral');
    expect(chainSummary(null)).toMatch(/unavailable/i);
  });

  it('offers the backfill only when legacy rows remain', () => {
    expect(canBackfill(status({ unchainedRows: 0 }))).toBe(false);
    expect(canBackfill(status({ unchainedRows: 2 }))).toBe(true);
    expect(canBackfill(null)).toBe(false);
  });
});

function verifyRow(over: Partial<AuditChainVerifyRow> = {}): AuditChainVerifyRow {
  return {
    chainSeq: over.chainSeq ?? 1,
    ok: over.ok ?? true,
    reason: over.reason ?? 'ok',
    storedHash: over.storedHash ?? 'aaaaaaaaaaaaaaaa',
    expectedHash: over.expectedHash ?? 'aaaaaaaaaaaaaaaa',
  };
}

describe('verification-row presenters', () => {
  it('truncates a long hash and passes through a short/null one', () => {
    expect(shortHash(null)).toBe('—');
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash('0123456789abcdef0123456789')).toBe('01234567…456789');
  });

  it('tones an ok row good and a failing row bad', () => {
    expect(verifyRowTone(verifyRow({ ok: true }))).toBe('good');
    expect(verifyRowTone(verifyRow({ ok: false }))).toBe('bad');
  });

  it('counts failing rows and summarizes the pass', () => {
    expect(failingRowCount([verifyRow(), verifyRow({ chainSeq: 2 })])).toBe(0);
    expect(verificationSummary([])).toMatch(/No chained/i);
    expect(verificationSummary([verifyRow(), verifyRow({ chainSeq: 2 })])).toMatch(/All 2 inspected rows verify/);
    const broken = [
      verifyRow({ chainSeq: 1 }),
      verifyRow({ chainSeq: 2, ok: false, reason: 'row_hash mismatch (row contents altered)' }),
    ];
    expect(failingRowCount(broken)).toBe(1);
    expect(verificationSummary(broken)).toMatch(/failed at sequence 2/);
    expect(verificationSummary(broken)).toMatch(/mismatch/);
  });
});

describe('rate-limit + backup presenters', () => {
  const limits: SecurityRateLimits = {
    defaultPerMinute: 30,
    taxRefreshPerHour: 12,
    submitProposalPerHour: 20,
    addonPerMinute: 60,
    maxBodyBytes: 262144,
  };

  it('formats bytes compactly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(262144)).toBe('256 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('builds labelled rate-limit rows including the byte cap', () => {
    const rows = rateLimitRows(limits);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ label: 'Default (per route)', value: '30 / min' });
    expect(rows[4]).toEqual({ label: 'Max request body', value: '256 KB' });
  });

  it('builds labelled backup-policy rows', () => {
    const policy: BackupPolicy = {
      schedule: 'manual',
      encryption: 'AES-256-GCM',
      retentionDays: 30,
      restoreMode: 'manual-supervised',
      pitrExpectation: 'per-Supabase-plan',
    };
    const rows = backupPolicyRows(policy);
    expect(rows[0]).toEqual({ label: 'Schedule', value: 'manual' });
    expect(rows[2]).toEqual({ label: 'Retention', value: '30 days' });
    expect(rows[4]).toEqual({ label: 'Point-in-time recovery', value: 'per-Supabase-plan' });
  });
});

function summary(over: Partial<UserRoleSummary> = {}): UserRoleSummary {
  return {
    userId: over.userId ?? 'u1',
    userEmail: over.userEmail ?? null,
    userName: over.userName ?? null,
    roles: over.roles ?? [],
    grants: over.grants ?? [],
  };
}

describe('tone class mappers', () => {
  it('maps each tone to a badge / border / bar class and falls back on neutral', () => {
    expect(toneBadgeClass('good')).toContain('green');
    expect(toneBadgeClass('warn')).toContain('amber');
    expect(toneBadgeClass('bad')).toContain('red');
    expect(toneBadgeClass('neutral')).toContain('slate');
    expect(toneBorderClass('good')).toContain('green');
    expect(toneBorderClass('bad')).toContain('red');
    expect(toneBorderClass('neutral')).toContain('white');
    expect(toneBarClass('warn')).toBe('bg-amber-500');
    expect(toneBarClass('neutral')).toBe('bg-white/20');
  });
});

describe('RBAC presenters', () => {
  it('labels roles and falls back to the raw key', () => {
    expect(roleLabel('accounting_admin')).toBe('Accounting admin');
    expect(roleLabel('viewer')).toBe('Viewer');
    expect(roleLabel('mystery')).toBe('mystery');
  });

  it('orders held roles by privilege regardless of input order', () => {
    expect(orderedRoleLabels(['viewer', 'accounting_admin'])).toEqual(['Accounting admin', 'Viewer']);
    expect(orderedRoleLabels(['payroll', 'accountant'])).toEqual(['Accountant', 'Payroll']);
  });

  it('derives the grantable (not-yet-held) role set', () => {
    expect(grantableRoles(['accounting_admin', 'accountant', 'payroll', 'viewer'])).toEqual([]);
    expect(grantableRoles(['viewer'])).toEqual(['accounting_admin', 'accountant', 'payroll']);
  });

  it('picks display + secondary labels by available identity', () => {
    expect(userDisplayLabel(summary({ userName: 'Ada', userEmail: 'a@b.com' }))).toBe('Ada');
    expect(userDisplayLabel(summary({ userName: null, userEmail: 'a@b.com' }))).toBe('a@b.com');
    expect(userDisplayLabel(summary({ userName: null, userEmail: null, userId: 'u9' }))).toBe('u9');
    // secondary: email under a shown name, else the id
    expect(userSecondaryLabel(summary({ userName: 'Ada', userEmail: 'a@b.com', userId: 'u1' }))).toBe('a@b.com');
    expect(userSecondaryLabel(summary({ userName: null, userEmail: 'a@b.com', userId: 'u1' }))).toBe('u1');
  });

  it('summarizes the whole grant set', () => {
    expect(rbacSummary([])).toMatch(/No accounting roles/i);
    const s = rbacSummary([
      summary({ userId: 'u1', roles: ['accounting_admin', 'viewer'] }),
      summary({ userId: 'u2', roles: ['payroll'] }),
    ]);
    expect(s).toMatch(/3 role grants across 2 users/);
  });
});
