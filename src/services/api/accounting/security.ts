/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E SECURITY HARDENING.
 *     The whole module is FLAG-DARK (VITE_ACCOUNTING_ENABLED off) and requires a SECURITY review
 *     (key management/rotation, encryption coverage, hash-chain integrity, backup/restore) before it
 *     is enabled. Every security screen renders the UnverifiedBanner (UI lane). See the build
 *     report "WHAT A HUMAN MUST VERIFY".
 *
 * The security service is the API seam for the Phase E DB layer (migrations 031/032/033):
 *   • E1 pgcrypto FIELD ENCRYPTION — the SECURITY DEFINER accessors are the ONLY authorized path to
 *     the `*_enc` ciphertext. The set_/get_ accessors re-check the role IN-BODY (can_write for
 *     vendor/bank, can_payroll for SSN/bank/wage), and the private key accessor _enc_key() is NOT
 *     client-reachable, so a stolen/mis-granted SELECT on the table yields only opaque bytea. These
 *     wrappers are provided for the documented post-sign-off CUTOVER backfill + verification; the
 *     live vendor/bank/employee forms keep writing PLAINTEXT until that cutover (G8: encryption is
 *     phased, never half-wired). encryptionCoverage() drives the cutover-progress display (COUNTS
 *     only — never values).
 *   • E2 TAMPER-EVIDENT AUDIT — accounting.audit() now populates a SHA-256 hash chain. This service
 *     reads the integrity badge (audit_chain_status), the full per-seq verification
 *     (verify_audit_chain), and exposes the ONE-TIME admin backfill of legacy rows
 *     (backfill_audit_chain — supervised; re-running forks the chain, so it is a deliberate step).
 *   • E5/E4 SECURITY SETTINGS — read-only rate-limit + backup-policy blobs from accounting.settings.
 *
 * DOUBLE-ENTRY (G3): NOTHING here moves money or posts a journal entry — vacuously satisfied.
 *
 * Convention (matches the rest of the module): reads THROW (React Query surfaces them); writes /
 * RPC writers RETURN a result object carrying the DB error string (RLS/role denial, a missing Vault
 * key, a not-found id), so an expected DB rejection is shown inline and never thrown. The DB role
 * gate is the real guard — these wrappers never decide authorization client-side.
 *
 * ISOLATION: every read/write is scoped to the `accounting` schema via acct(); nothing here touches
 * public.* except the RBAC candidate read (which is in rbac.ts, not this file).
 */
import type {
  AuditChainStatus,
  AuditChainVerifyRow,
  BackfillAuditChainResult,
  BackupPolicy,
  EncryptedFieldWriteResult,
  EncryptionCoverageRow,
  SecurityRateLimits,
} from '../../../features/accounting/types';
import { acct } from './accountingClient';
import {
  mapAuditChainStatus,
  mapAuditChainVerifyRow,
  mapBackupPolicy,
  mapEncryptionCoverageRow,
  mapSecurityRateLimits,
  type Row,
} from './mappers';

/** Decrypted employee bank pair returned by get_employee_bank (both null when unset). */
export interface EmployeeBank {
  bankRouting: string | null;
  bankAccount: string | null;
}

export const securityService = {
  // ── E1: encryption coverage (read-only probe — drives cutover progress) ───────

  /**
   * Per-field plaintext-vs-ciphertext COUNTS via accounting.encryption_coverage() (can_read()-gated
   * in the DB). COUNTS ONLY — the RPC never returns a sensitive value. Reads throw so React Query
   * surfaces a failure (e.g. a non-role caller's privilege error). Returned in the DB's field order.
   */
  async encryptionCoverage(): Promise<EncryptionCoverageRow[]> {
    const { data, error } = await acct().rpc('encryption_coverage');
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapEncryptionCoverageRow);
  },

  // ── E1: ciphertext accessors (the ONLY authorized read/write path) ────────────
  // Writers go through the SECURITY DEFINER set_* accessor, which encrypts under the Vault key and
  // re-checks the role in-body. A keyless/under-privileged caller, or a missing Vault key, comes
  // back as { ok:false, error } — never a thrown/half-written value. These are for the documented
  // post-sign-off CUTOVER backfill; the live forms still write plaintext until then.

  /** Encrypt + store a vendor tax id (can_write()-gated). Pass null to clear the ciphertext. */
  async setVendorTaxId(
    vendorId: string,
    plaintext: string | null
  ): Promise<EncryptedFieldWriteResult> {
    const { error } = await acct().rpc('set_vendor_tax_id', {
      p_vendor: vendorId,
      p_plaintext: plaintext,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Decrypt a vendor tax id (can_read()-gated). Null when never set. Reads throw on a DB error. */
  async getVendorTaxId(vendorId: string): Promise<string | null> {
    const { data, error } = await acct().rpc('get_vendor_tax_id', { p_vendor: vendorId });
    if (error) throw error;
    return data == null ? null : String(data);
  },

  /** Encrypt + store a bank-account mask (can_write()-gated). Pass null to clear. */
  async setBankAccountMask(
    accountId: string,
    plaintext: string | null
  ): Promise<EncryptedFieldWriteResult> {
    const { error } = await acct().rpc('set_bank_account_mask', {
      p_account: accountId,
      p_plaintext: plaintext,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Decrypt a bank-account mask (can_read()-gated). Null when never set. Reads throw on a DB error. */
  async getBankAccountMask(accountId: string): Promise<string | null> {
    const { data, error } = await acct().rpc('get_bank_account_mask', { p_account: accountId });
    if (error) throw error;
    return data == null ? null : String(data);
  },

  /** Encrypt + store an employee SSN (can_payroll()-gated — stricter than read/write). Null clears. */
  async setEmployeeSsn(
    employeeId: string,
    plaintext: string | null
  ): Promise<EncryptedFieldWriteResult> {
    const { error } = await acct().rpc('set_employee_ssn', {
      p_employee: employeeId,
      p_plaintext: plaintext,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Decrypt an employee SSN (can_payroll()-gated). Null when never set. Reads throw on a DB error. */
  async getEmployeeSsn(employeeId: string): Promise<string | null> {
    const { data, error } = await acct().rpc('get_employee_ssn', { p_employee: employeeId });
    if (error) throw error;
    return data == null ? null : String(data);
  },

  /**
   * Encrypt + store an employee's bank routing + account (can_payroll()-gated). Both written in one
   * call (mirrors the single set_employee_bank accessor); pass null for either to clear it.
   */
  async setEmployeeBank(
    employeeId: string,
    routingPlaintext: string | null,
    accountPlaintext: string | null
  ): Promise<EncryptedFieldWriteResult> {
    const { error } = await acct().rpc('set_employee_bank', {
      p_employee: employeeId,
      p_routing_plaintext: routingPlaintext,
      p_account_plaintext: accountPlaintext,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /**
   * Decrypt an employee's bank routing + account (can_payroll()-gated). The DB returns a single-row
   * table (bank_routing, bank_account); supabase-js surfaces it as a one-element array. Reads throw.
   */
  async getEmployeeBank(employeeId: string): Promise<EmployeeBank> {
    const { data, error } = await acct().rpc('get_employee_bank', { p_employee: employeeId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as Row | null;
    return {
      bankRouting: row?.bank_routing == null ? null : String(row.bank_routing),
      bankAccount: row?.bank_account == null ? null : String(row.bank_account),
    };
  },

  /**
   * Encrypt + store an employee pay rate in CENTS (can_payroll()-gated). SHADOW-ONLY: the payroll
   * engine still reads the plaintext pay_rate_cents — this is belt-and-suspenders-at-rest only, and
   * retiring the plaintext wage column is on the HUMAN-VERIFY list. Pass null to clear.
   */
  async setEmployeePayRate(
    employeeId: string,
    payRateCents: number | null
  ): Promise<EncryptedFieldWriteResult> {
    const { error } = await acct().rpc('set_employee_pay_rate', {
      p_employee: employeeId,
      p_pay_rate_cents: payRateCents,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Decrypt an employee pay rate in CENTS (can_payroll()-gated). Null when never set. Reads throw. */
  async getEmployeePayRate(employeeId: string): Promise<number | null> {
    const { data, error } = await acct().rpc('get_employee_pay_rate', { p_employee: employeeId });
    if (error) throw error;
    return data == null ? null : Number(data);
  },

  // ── E2: tamper-evident audit hash chain ──────────────────────────────────────

  /**
   * The audit-chain integrity badge via accounting.audit_chain_status() (can_read()-gated):
   * { verified, chainedRows, unchainedRows, firstBreakSeq }. `verified` is true only when the full
   * walk found NO break. `unchainedRows` are legacy pre-E2 rows awaiting the one-time backfill (NOT
   * a tamper). Reads throw so React Query surfaces a failure.
   */
  async auditChainStatus(): Promise<AuditChainStatus> {
    const { data, error } = await acct().rpc('audit_chain_status');
    if (error) throw error;
    return mapAuditChainStatus(data);
  },

  /**
   * The full per-seq audit-chain verification via accounting.verify_audit_chain(p_from)
   * (can_read()-gated): one row per inspected chain_seq with ok / reason / stored vs expected hash.
   * `from` defaults to 1 (genesis). The DB reports the FIRST break once (it chains from the stored
   * hash), so a single corrupted row is flagged exactly once rather than cascading. Reads throw.
   */
  async verifyAuditChain(from = 1): Promise<AuditChainVerifyRow[]> {
    const { data, error } = await acct().rpc('verify_audit_chain', { p_from: from });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapAuditChainVerifyRow);
  },

  /**
   * Run the ONE-TIME backfill of legacy (pre-E2) audit rows via accounting.backfill_audit_chain()
   * (accounting_admin-ONLY in the DB). Hashes every still-NULL row in (at, id) order, continuing the
   * chain from its tail, and returns how many rows were hashed. SUPERVISED + idempotent in the safe
   * direction (only fills NULL rows), but re-running after a tamper would "bless" it — so this is a
   * deliberate human step on the HUMAN-VERIFY list, NOT something to call automatically. A DB
   * rejection (non-admin) comes back { ok:false, error } and never throws.
   */
  async backfillAuditChain(): Promise<BackfillAuditChainResult> {
    const { data, error } = await acct().rpc('backfill_audit_chain');
    if (error) return { ok: false, hashed: 0, error: error.message };
    return { ok: true, hashed: data == null ? 0 : Number(data) };
  },

  // ── E5/E4: read-only security settings ────────────────────────────────────────

  /**
   * The default per-route rate limits the E5 Netlify limiter consumes (accounting.settings
   * 'security_rate_limits', migration 033). READ-ONLY display — the limiter is server-gated OFF by
   * default (ACCOUNTING_SECURITY_HARDENING_ENABLED) and these are the values it uses once enabled.
   * Falls back to the seed defaults when the row is absent. Reads throw on a real DB error.
   */
  async getRateLimits(): Promise<SecurityRateLimits> {
    const { data, error } = await acct()
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'security_rate_limits')
      .maybeSingle();
    if (error) throw error;
    return mapSecurityRateLimits((data as Row | null)?.setting_value ?? null);
  },

  /**
   * The documented backup/restore policy surfaced on the Backup/Restore STUB screen (E4,
   * accounting.settings 'backup_policy', migration 033). READ-ONLY documentation of the operator-run
   * pg_dump + AES procedure — the screen performs NO destructive action. Falls back to the documented
   * defaults when the row is absent. Reads throw on a real DB error.
   */
  async getBackupPolicy(): Promise<BackupPolicy> {
    const { data, error } = await acct()
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'backup_policy')
      .maybeSingle();
    if (error) throw error;
    return mapBackupPolicy((data as Row | null)?.setting_value ?? null);
  },
};
