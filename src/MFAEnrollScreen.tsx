import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { mfaService } from '@/services/api/mfa';

/**
 * MFAEnrollScreen — TOTP enrollment UI.
 *
 * Two roles, same component:
 *   - 'gate'     (default): the FORCED full-screen enrollment a required user
 *                hits when they have no factor yet. Offers only "Sign out" as an
 *                escape — never a "Cancel" that would leave them in a wedged
 *                gate. On success it refreshes the auth gate so the app opens.
 *   - 'settings': self-service setup launched from the Dashboard. Renders the
 *                same flow inside the caller's container and exposes onCancel /
 *                onDone so the user can back out or close after finishing.
 *
 * The screen calls mfaService.startEnroll() on mount (gate) or when the user
 * begins (settings) to fetch the QR + secret, then confirms the first 6-digit
 * code via mfaService.confirmEnroll(). A wrong code is an expected, retryable
 * outcome — it never unenrolls or strands the user.
 *
 * AUTH SAFETY: signing out always stays reachable, and an unverified factor left
 * behind by an abandoned enroll is swept by startEnroll() on the next attempt, so
 * this screen can never permanently lock anyone out.
 */

interface MFAEnrollScreenProps {
  /** 'gate' = forced full-screen setup; 'settings' = embedded self-service. */
  mode?: 'gate' | 'settings';
  /** settings only: back out without enrolling (sweeps the pending factor). */
  onCancel?: () => void;
  /** settings only: called after a successful enrollment (e.g. to close). */
  onDone?: () => void;
}

const CODE_LENGTH = 6;

const MFAEnrollScreen: React.FC<MFAEnrollScreenProps> = ({ mode = 'gate', onCancel, onDone }) => {
  const { logout, refreshMfaGate } = useAuth();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [starting, setStarting] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  // Guards an enroll() race in StrictMode / fast remounts so we don't fire two
  // enrollments (which would orphan a factor).
  const startedRef = useRef(false);

  const begin = useCallback(async () => {
    setStarting(true);
    setError(null);
    const result = await mfaService.startEnroll();
    if (!result.ok || !result.factorId) {
      setError(result.error ?? 'Could not start two-factor setup. Please try again.');
      setStarting(false);
      return;
    }
    setFactorId(result.factorId);
    setQrCode(result.qrCode ?? null);
    setSecret(result.secret ?? null);
    setStarting(false);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void begin();
  }, [begin]);

  const handleVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!factorId) {
        setError('Setup is not ready yet. Please wait a moment and try again.');
        return;
      }
      const trimmed = code.trim();
      if (!/^\d{6}$/.test(trimmed)) {
        setError('Enter the 6-digit code from your authenticator app.');
        return;
      }
      setVerifying(true);
      setError(null);
      const result = await mfaService.confirmEnroll(factorId, trimmed);
      if (!result.ok) {
        setError(result.error ?? 'That code was not accepted. Please try again.');
        setCode('');
        setVerifying(false);
        return;
      }
      // Verified: session is now aal2. Recompute the gate so the app opens
      // (gate mode) and notify the caller (settings mode).
      await refreshMfaGate();
      setVerifying(false);
      onDone?.();
    },
    [factorId, code, refreshMfaGate, onDone]
  );

  const handleCancel = useCallback(async () => {
    // Best-effort: remove the just-created unverified factor so it doesn't linger.
    // startEnroll() also sweeps unverified leftovers, so a failure here is harmless.
    if (factorId) await mfaService.unenroll(factorId);
    onCancel?.();
  }, [factorId, onCancel]);

  const handleCopySecret = useCallback(async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the secret is shown as text either way.
    }
  }, [secret]);

  const body = (
    <>
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-md bg-amber-500/20 text-amber-400 shadow-xl">
          <span className="material-symbols-outlined text-4xl" aria-hidden>
            encrypted
          </span>
        </div>
        <h1 className="text-center text-2xl font-bold leading-tight tracking-tight text-white">
          Set up two-factor authentication
        </h1>
        <p className="mt-2 text-center text-sm font-normal leading-normal text-[#ad93c8]">
          Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password), then
          enter the 6-digit code it shows.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/20 p-3">
          <p className="text-center text-sm text-red-400">{error}</p>
        </div>
      )}

      {starting ? (
        <div className="flex flex-col items-center py-10">
          <div className="h-8 w-8 animate-spin rounded-sm border-2 border-primary border-t-transparent" />
          <p className="mt-3 text-sm text-[#ad93c8]">Preparing your setup…</p>
        </div>
      ) : (
        <>
          {qrCode ? (
            <div className="mb-4 flex flex-col items-center">
              <div className="rounded-md bg-white p-3 shadow-lg">
                {/* data.totp.qr_code is an SVG data: URI — render directly. */}
                <img src={qrCode} alt="Two-factor QR code" width={180} height={180} />
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-sm border border-[#4d3465] bg-[#261a32] p-3">
              <p className="text-center text-sm text-[#ad93c8]">
                Couldn&apos;t render the QR image. Use the setup key below instead.
              </p>
            </div>
          )}

          {secret && (
            <div className="mb-6 flex flex-col">
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                className="inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-1 self-center rounded-sm px-2 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden>
                  {showSecret ? 'visibility_off' : 'key'}
                </span>
                {showSecret ? 'Hide setup key' : "Can't scan? Enter a key manually"}
              </button>
              {showSecret && (
                <div className="mt-2 flex items-center gap-2 rounded-sm border border-[#4d3465] bg-[#261a32] p-3">
                  <code className="flex-1 break-all font-mono text-sm tracking-wider text-white">
                    {secret}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    className="flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Copy setup key"
                  >
                    <span className="material-symbols-outlined text-lg" aria-hidden>
                      {secretCopied ? 'check' : 'content_copy'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleVerify} autoComplete="off">
            <div className="mb-4 flex w-full flex-col">
              <label
                className="ml-1 pb-2 text-sm font-medium leading-normal text-white"
                htmlFor="mfa-enroll-code"
              >
                6-digit code
              </label>
              <input
                id="mfa-enroll-code"
                name="one-time-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d*"
                maxLength={CODE_LENGTH}
                className="h-14 w-full rounded-sm border border-[#4d3465] bg-[#261a32] px-4 text-center font-mono text-2xl tracking-[0.5em] text-white placeholder:tracking-normal placeholder:text-[#ad93c8] focus:border-primary focus:outline-0 focus:ring-2 focus:ring-primary/50"
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
              className="flex h-14 w-full items-center justify-center gap-2 rounded-sm bg-primary text-lg font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={verifying || code.length !== CODE_LENGTH}
            >
              {verifying ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-sm border-2 border-white border-t-transparent" />
                  <span>Verifying…</span>
                </>
              ) : (
                <>
                  <span>Verify &amp; enable</span>
                  <span className="material-symbols-outlined text-xl" aria-hidden>
                    check_circle
                  </span>
                </>
              )}
            </button>
          </form>
        </>
      )}
    </>
  );

  // Embedded (Dashboard) variant: render inside the caller's container.
  if (mode === 'settings') {
    return (
      <div>
        {body}
        <div className="mt-6 flex flex-col items-center gap-1">
          {error && !starting && (
            <button
              type="button"
              onClick={() => void begin()}
              className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm font-medium text-primary hover:underline"
            >
              Try again
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={() => void handleCancel()}
              className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm text-[#ad93c8] hover:text-white"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // Forced full-screen gate variant.
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-gradient-to-b from-background-dark to-[#2b1a3d] px-6 py-10">
      <div className="w-full max-w-[400px] rounded-md border border-[#4d3465] bg-background-dark/50 p-6 shadow-xl backdrop-blur-sm">
        {body}
      </div>

      <div className="mt-8 flex flex-col items-center gap-2">
        {error && !starting && (
          <button
            type="button"
            onClick={() => void begin()}
            className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm font-bold text-primary hover:underline"
          >
            Try again
          </button>
        )}
        <p className="text-xs text-[#ad93c8]">
          Two-factor authentication is required for your account.
        </p>
        <button
          type="button"
          onClick={logout}
          className="inline-flex min-h-[44px] touch-manipulation items-center rounded-sm px-2 text-sm font-medium text-[#ad93c8] transition-colors hover:text-white"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};

export default MFAEnrollScreen;
