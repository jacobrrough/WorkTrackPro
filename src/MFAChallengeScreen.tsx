import React, { useCallback, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { mfaService } from '@/services/api/mfa';

/**
 * MFAChallengeScreen — the login step-up for a user who already has a verified
 * TOTP factor. They enter the 6-digit code, which upgrades the session from
 * aal1 to aal2 (mfaService.verifyLogin), then the auth gate refreshes and the
 * app opens.
 *
 * AUTH SAFETY:
 *   - "Sign out" is always reachable, so a user who can't produce a code is
 *     never trapped on this screen.
 *   - A lost-device note points to an administrator for reset (handled
 *     server-side via the admin MFA API) — this is the recovery path, so the
 *     gate can never permanently lock anyone out.
 *   - The factorId comes from the auth gate (mfaFactorId); if it's somehow
 *     missing we surface a clear message and still offer sign-out rather than
 *     silently failing.
 */

const CODE_LENGTH = 6;

const MFAChallengeScreen: React.FC = () => {
  const { logout, refreshMfaGate, mfaFactorId } = useAuth();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!mfaFactorId) {
        setError('We couldn’t find your two-factor method. Please sign out and back in.');
        return;
      }
      const trimmed = code.trim();
      if (!/^\d{6}$/.test(trimmed)) {
        setError('Enter the 6-digit code from your authenticator app.');
        return;
      }
      setVerifying(true);
      setError(null);
      const result = await mfaService.verifyLogin(mfaFactorId, trimmed);
      if (!result.ok) {
        setError(result.error ?? 'That code was not accepted. Please try again.');
        setCode('');
        setVerifying(false);
        return;
      }
      // Session upgraded to aal2 — recompute the gate so the app opens.
      await refreshMfaGate();
      setVerifying(false);
    },
    [mfaFactorId, code, refreshMfaGate]
  );

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-gradient-to-b from-background-dark to-app-2 px-6 py-10">
      <div className="mb-8 flex w-full max-w-[400px] flex-col items-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-md bg-amber-500/20 text-amber-400 shadow-xl">
          <span className="material-symbols-outlined text-5xl" aria-hidden>
            verified_user
          </span>
        </div>
        <h1 className="text-center text-2xl font-bold leading-tight tracking-tight text-white">
          Two-factor verification
        </h1>
        <p className="mt-2 text-center text-sm font-normal leading-normal text-muted">
          Enter the 6-digit code from your authenticator app to continue.
        </p>
      </div>

      <form
        onSubmit={handleVerify}
        className="w-full max-w-[400px] rounded-md border border-line bg-background-dark/50 p-4 shadow-xl backdrop-blur-sm"
        autoComplete="off"
        aria-label="Two-factor verification form"
      >
        {error && (
          <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/20 p-3">
            <p className="text-center text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="mb-4 flex w-full flex-col">
          <label
            className="ml-1 pb-2 text-sm font-medium leading-normal text-white"
            htmlFor="mfa-challenge-code"
          >
            6-digit code
          </label>
          <input
            id="mfa-challenge-code"
            name="one-time-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d*"
            maxLength={CODE_LENGTH}
            className="h-14 w-full rounded-sm border border-line bg-surface-2 px-4 text-center font-mono text-2xl tracking-[0.5em] text-white placeholder:tracking-normal placeholder:text-muted focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            disabled={verifying}
            autoFocus
            aria-label="6-digit verification code"
          />
        </div>

        <button
          type="submit"
          className="flex h-14 w-full items-center justify-center gap-2 rounded-sm bg-primary text-lg font-bold text-on-accent shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={verifying || code.length !== CODE_LENGTH}
        >
          {verifying ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-sm border-2 border-white border-t-transparent" />
              <span>Verifying…</span>
            </>
          ) : (
            <>
              <span>Verify</span>
              <span className="material-symbols-outlined text-xl" aria-hidden>
                arrow_forward
              </span>
            </>
          )}
        </button>

        <div className="mt-6 rounded-sm border border-line bg-surface-2/60 p-3">
          <p className="text-center text-xs leading-relaxed text-muted">
            Lost your device? Contact an administrator to reset your two-factor authentication.
          </p>
        </div>
      </form>

      <div className="mt-8 flex flex-col items-center">
        <button
          type="button"
          onClick={logout}
          className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm font-medium text-muted transition-colors hover:text-white"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};

export default MFAChallengeScreen;
