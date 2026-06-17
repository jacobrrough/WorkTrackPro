import { supabase } from './supabaseClient';

/**
 * MFA (TOTP) service — a thin, correctness-first wrapper over supabase-js v2's
 * `supabase.auth.mfa.*` API. The login gate (AuthContext) and the enrollment /
 * challenge UI (App.tsx stage) are the only callers.
 *
 * Result convention mirrors authService: methods that can fail in an
 * actionable, user-facing way return `{ ok, error }` (plus any payload), so the
 * UI never has to wrap these in try/catch. A wrong 6-digit code is an EXPECTED
 * outcome here, not an exception — it comes back as `{ ok: false, error }`.
 *
 * Assurance levels: a fresh password login is `aal1`. After a successful
 * `challengeAndVerify` against a verified TOTP factor, Supabase upgrades the
 * session JWT to `aal2`. The gate keys off this transition.
 */

export type AssuranceLevel = 'aal1' | 'aal2' | null;

export interface MfaState {
  /** True when the user has at least one VERIFIED TOTP factor. */
  hasVerifiedFactor: boolean;
  /** Assurance level of the current session JWT. */
  currentLevel: AssuranceLevel;
  /**
   * Assurance level the session COULD reach. When a verified factor exists this
   * is 'aal2' even while currentLevel is still 'aal1' (i.e. challenge pending).
   */
  nextLevel: AssuranceLevel;
  /** The id of a verified TOTP factor to challenge against, or null if none. */
  factorId: string | null;
}

export interface StartEnrollResult {
  ok: boolean;
  error?: string;
  factorId?: string;
  /** SVG image as a `data:` URI — render directly in an <img src>. */
  qrCode?: string;
  /** Raw base32 secret, for manual key entry when a QR can't be scanned. */
  secret?: string;
  /** otpauth:// URI backing the QR code. */
  uri?: string;
}

export interface MfaResult {
  ok: boolean;
  error?: string;
}

function errMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export const mfaService = {
  /**
   * Snapshot of the user's MFA posture: whether they have a usable (verified)
   * TOTP factor and what assurance level the current session sits at. Drives the
   * AuthContext gate decision (ok / challenge / enroll).
   *
   * Throws on a hard API error so AuthContext can fail safe (treat as "cannot
   * confirm" rather than silently deciding the user is exempt).
   */
  async getState(): Promise<MfaState> {
    const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
    if (factorError) throw factorError;

    // data.totp is the list of VERIFIED totp factors specifically.
    const verifiedTotp = factorData?.totp ?? [];
    const hasVerifiedFactor = verifiedTotp.length > 0;
    const factorId = hasVerifiedFactor ? verifiedTotp[0].id : null;

    const { data: aalData, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) throw aalError;

    return {
      hasVerifiedFactor,
      currentLevel: (aalData?.currentLevel as AssuranceLevel) ?? null,
      nextLevel: (aalData?.nextLevel as AssuranceLevel) ?? null,
      factorId,
    };
  },

  /**
   * Begin TOTP enrollment and return the QR/secret to display.
   *
   * supabase-js rejects a fresh enroll() when an UNVERIFIED factor already
   * exists (e.g. the user started enrolling, navigated away, and came back). To
   * keep enrollment from getting permanently wedged we first sweep any
   * unverified leftover factors, then enroll clean. Verified factors are never
   * touched here.
   */
  async startEnroll(friendlyName = 'Authenticator app'): Promise<StartEnrollResult> {
    try {
      // Clean up any half-finished (unverified) factors so enroll() can't 422.
      const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError)
        return { ok: false, error: errMessage(listError, 'Could not read MFA factors') };

      const all = existing?.all ?? [];
      const unverified = all.filter((f) => f.status !== 'verified');
      for (const factor of unverified) {
        // Best-effort: a failure to remove one stale factor shouldn't abort
        // enrollment outright, but we surface it if enroll then fails.
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName,
      });
      if (error) return { ok: false, error: errMessage(error, 'Could not start MFA enrollment') };
      if (!data) return { ok: false, error: 'MFA enrollment returned no data' };

      return {
        ok: true,
        factorId: data.id,
        qrCode: data.totp?.qr_code,
        secret: data.totp?.secret,
        uri: data.totp?.uri,
      };
    } catch (error) {
      return { ok: false, error: errMessage(error, 'Could not start MFA enrollment') };
    }
  },

  /**
   * Confirm enrollment by verifying the first 6-digit code from the user's
   * authenticator against the just-created factor. On success the factor becomes
   * 'verified' AND the session upgrades to aal2. A wrong code returns
   * `{ ok: false }` — the caller should let the user retry, not unenroll.
   */
  async confirmEnroll(factorId: string, code: string): Promise<MfaResult> {
    return this.verifyCode(factorId, code);
  },

  /**
   * The login-time step: challenge a VERIFIED factor and verify the user's code,
   * upgrading the session from aal1 to aal2. Identical mechanics to
   * confirmEnroll (both use challengeAndVerify); kept as a separate named method
   * so call sites read clearly.
   */
  async verifyLogin(factorId: string, code: string): Promise<MfaResult> {
    return this.verifyCode(factorId, code);
  },

  /** Shared challenge+verify primitive. `code` is the 6-digit TOTP. */
  async verifyCode(factorId: string, code: string): Promise<MfaResult> {
    const trimmed = (code ?? '').trim();
    if (!factorId) return { ok: false, error: 'Missing MFA factor' };
    if (!/^\d{6}$/.test(trimmed)) return { ok: false, error: 'Enter the 6-digit code' };
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: trimmed,
      });
      if (error) return { ok: false, error: errMessage(error, 'Invalid code') };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errMessage(error, 'Invalid code') };
    }
  },

  /**
   * Remove a TOTP factor. Used to cancel a pending enrollment, or (later, from
   * settings) to turn MFA off for an account. NOTE: removing the only verified
   * factor drops the user back to aal1 — when MFA is required this lands them at
   * the forced-enroll gate on next load, never locked out.
   */
  async unenroll(factorId: string): Promise<MfaResult> {
    if (!factorId) return { ok: false, error: 'Missing MFA factor' };
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) return { ok: false, error: errMessage(error, 'Could not remove MFA factor') };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errMessage(error, 'Could not remove MFA factor') };
    }
  },
};
