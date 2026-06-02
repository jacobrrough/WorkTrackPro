import { describe, it, expect } from 'vitest';
import {
  mapAuditChainStatus,
  mapAuditChainVerifyRow,
  mapBackupPolicy,
  mapEncryptionCoverageRow,
  mapRoleCandidateRow,
  mapSecurityRateLimits,
  mapUserRoleGrantRow,
} from './mappers';

/**
 * PHASE E — SECURITY HARDENING (HELD / UNVERIFIED — NOT FOR FILING) mapper tests.
 * These mappers carry NO monetary value; they back the encryption-coverage, audit
 * hash-chain, RBAC and security-settings read surfaces. Every parse is defensive
 * (stringified jsonb / null / garbage must degrade, never throw).
 */

describe('mapEncryptionCoverageRow', () => {
  it('narrows the counts and derives pendingCount (plaintext − encrypted, floored at 0)', () => {
    const r = mapEncryptionCoverageRow({
      field: 'vendors.tax_id',
      plaintext_count: 5,
      encrypted_count: 2,
    });
    expect(r).toEqual({
      field: 'vendors.tax_id',
      plaintextCount: 5,
      encryptedCount: 2,
      pendingCount: 3,
    });
  });

  it('floors pendingCount at 0 when more rows are encrypted than plaintext', () => {
    const r = mapEncryptionCoverageRow({
      field: 'employees.ssn',
      plaintext_count: 1,
      encrypted_count: 4,
    });
    expect(r.pendingCount).toBe(0);
  });

  it('coerces missing/garbage counts to 0', () => {
    const r = mapEncryptionCoverageRow({ field: 'bank_accounts.mask' });
    expect(r).toEqual({
      field: 'bank_accounts.mask',
      plaintextCount: 0,
      encryptedCount: 0,
      pendingCount: 0,
    });
  });
});

describe('mapAuditChainStatus', () => {
  it('decodes a verified, fully-chained status', () => {
    const s = mapAuditChainStatus({
      verified: true,
      chainedRows: 9,
      unchainedRows: 0,
      firstBreakSeq: null,
    });
    expect(s).toEqual({ verified: true, chainedRows: 9, unchainedRows: 0, firstBreakSeq: null });
  });

  it('surfaces a break sequence and keeps verified=false', () => {
    const s = mapAuditChainStatus({
      verified: false,
      chainedRows: 9,
      unchainedRows: 0,
      firstBreakSeq: 8,
    });
    expect(s.verified).toBe(false);
    expect(s.firstBreakSeq).toBe(8);
  });

  it('parses a stringified jsonb object', () => {
    const s = mapAuditChainStatus(
      JSON.stringify({ verified: true, chainedRows: 3, unchainedRows: 1, firstBreakSeq: null })
    );
    expect(s.verified).toBe(true);
    expect(s.chainedRows).toBe(3);
    expect(s.unchainedRows).toBe(1);
  });

  it('accepts snake_case keys defensively', () => {
    const s = mapAuditChainStatus({
      verified: false,
      chained_rows: 2,
      unchained_rows: 5,
      first_break_seq: 1,
    });
    expect(s.chainedRows).toBe(2);
    expect(s.unchainedRows).toBe(5);
    expect(s.firstBreakSeq).toBe(1);
  });

  it('degrades a null/garbage value to a conservative not-verified badge (never throws)', () => {
    expect(mapAuditChainStatus(null)).toEqual({
      verified: false,
      chainedRows: 0,
      unchainedRows: 0,
      firstBreakSeq: null,
    });
    expect(mapAuditChainStatus('not json')).toEqual({
      verified: false,
      chainedRows: 0,
      unchainedRows: 0,
      firstBreakSeq: null,
    });
    // A truthy-but-non-boolean `verified` must NOT be treated as verified.
    expect(mapAuditChainStatus({ verified: 'yes' }).verified).toBe(false);
  });
});

describe('mapAuditChainVerifyRow', () => {
  it('maps an ok row', () => {
    const r = mapAuditChainVerifyRow({
      chain_seq: 1,
      ok: true,
      reason: 'ok',
      stored_hash: 'abc',
      expected_hash: 'abc',
    });
    expect(r).toEqual({
      chainSeq: 1,
      ok: true,
      reason: 'ok',
      storedHash: 'abc',
      expectedHash: 'abc',
    });
  });

  it('maps a failing row and keeps ok strictly boolean', () => {
    const r = mapAuditChainVerifyRow({
      chain_seq: 8,
      ok: false,
      reason: 'row_hash mismatch (row contents altered)',
      stored_hash: 'aaa',
      expected_hash: 'bbb',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('mismatch');
    expect(r.storedHash).toBe('aaa');
    expect(r.expectedHash).toBe('bbb');
  });

  it('coerces a non-boolean ok to false and null hashes', () => {
    const r = mapAuditChainVerifyRow({ chain_seq: 2, ok: 1, reason: 'x' });
    expect(r.ok).toBe(false);
    expect(r.storedHash).toBeNull();
    expect(r.expectedHash).toBeNull();
  });
});

describe('mapUserRoleGrantRow', () => {
  it('maps a grant with an embedded profile (full_name)', () => {
    const r = mapUserRoleGrantRow({
      id: 'g1',
      user_id: 'u1',
      role: 'accountant',
      granted_by: 'admin1',
      granted_at: '2026-06-01T00:00:00Z',
      user: { id: 'u1', email: 'a@b.com', full_name: 'Ada Lovelace' },
    });
    expect(r).toEqual({
      id: 'g1',
      userId: 'u1',
      role: 'accountant',
      grantedBy: 'admin1',
      grantedAt: '2026-06-01T00:00:00Z',
      userEmail: 'a@b.com',
      userName: 'Ada Lovelace',
    });
  });

  it('defaults an unknown role to viewer (least privilege) and leaves hydration undefined', () => {
    const r = mapUserRoleGrantRow({
      id: 'g2',
      user_id: 'u2',
      role: 'superuser',
      granted_by: null,
      granted_at: '2026-06-01T00:00:00Z',
    });
    expect(r.role).toBe('viewer');
    expect(r.grantedBy).toBeNull();
    expect(r.userEmail).toBeUndefined();
    expect(r.userName).toBeUndefined();
  });

  it('resolves the embedded profile under a `profile` key and a `name`/`display_name` fallback', () => {
    const r = mapUserRoleGrantRow({
      id: 'g3',
      user_id: 'u3',
      role: 'payroll',
      granted_at: '2026-06-01T00:00:00Z',
      profile: { id: 'u3', email: null, display_name: 'Grace' },
    });
    expect(r.userName).toBe('Grace');
    expect(r.userEmail).toBeNull();
  });
});

describe('mapRoleCandidateRow', () => {
  it('maps a profile to a candidate', () => {
    const r = mapRoleCandidateRow({ id: 'u9', email: 'c@d.com', full_name: 'Carl' });
    expect(r).toEqual({ userId: 'u9', email: 'c@d.com', name: 'Carl' });
  });

  it('tolerates a null email/name', () => {
    const r = mapRoleCandidateRow({ id: 'u10' });
    expect(r).toEqual({ userId: 'u10', email: null, name: null });
  });
});

describe('mapSecurityRateLimits', () => {
  it('decodes the seeded shape', () => {
    const s = mapSecurityRateLimits({
      defaultPerMinute: 30,
      taxRefreshPerHour: 12,
      submitProposalPerHour: 20,
      addonPerMinute: 60,
      maxBodyBytes: 262144,
    });
    expect(s).toEqual({
      defaultPerMinute: 30,
      taxRefreshPerHour: 12,
      submitProposalPerHour: 20,
      addonPerMinute: 60,
      maxBodyBytes: 262144,
    });
  });

  it('falls back to the seed defaults on a null/garbage value', () => {
    expect(mapSecurityRateLimits(null)).toEqual({
      defaultPerMinute: 30,
      taxRefreshPerHour: 12,
      submitProposalPerHour: 20,
      addonPerMinute: 60,
      maxBodyBytes: 262144,
    });
    expect(mapSecurityRateLimits('nope').defaultPerMinute).toBe(30);
  });

  it('parses a stringified jsonb object and keeps provided overrides', () => {
    const s = mapSecurityRateLimits(JSON.stringify({ defaultPerMinute: 5, maxBodyBytes: 1024 }));
    expect(s.defaultPerMinute).toBe(5);
    expect(s.maxBodyBytes).toBe(1024);
    // unspecified keys fall back to the seed default
    expect(s.addonPerMinute).toBe(60);
  });
});

describe('mapBackupPolicy', () => {
  it('decodes the seeded shape', () => {
    const p = mapBackupPolicy({
      schedule: 'manual',
      encryption: 'AES-256-GCM',
      retentionDays: 30,
      restoreMode: 'manual-supervised',
      pitrExpectation: 'per-Supabase-plan',
    });
    expect(p).toEqual({
      schedule: 'manual',
      encryption: 'AES-256-GCM',
      retentionDays: 30,
      restoreMode: 'manual-supervised',
      pitrExpectation: 'per-Supabase-plan',
    });
  });

  it('falls back to documented defaults on a null/garbage value', () => {
    expect(mapBackupPolicy(null)).toEqual({
      schedule: 'manual',
      encryption: 'AES-256-GCM',
      retentionDays: 30,
      restoreMode: 'manual-supervised',
      pitrExpectation: 'per-Supabase-plan',
    });
  });
});
