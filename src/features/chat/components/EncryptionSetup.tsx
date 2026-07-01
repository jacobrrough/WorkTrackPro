import React, { useState } from 'react';
import type { KeyState } from '@/hooks/useCryptoKeys';

interface EncryptionSetupProps {
  keyState: KeyState;
  onGenerate: (password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<boolean>;
  onRecover: (oldPassword: string, currentPassword: string) => Promise<boolean>;
  onRegenerate: (password: string) => Promise<void>;
}

export function EncryptionSetup({
  keyState,
  onGenerate,
  onUnlock,
  onRecover,
  onRegenerate,
}: EncryptionSetupProps) {
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'normal' | 'recover' | 'regenerate'>('normal');
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const isSetup = keyState.status === 'not_setup';
  const isLocked = keyState.status === 'locked';
  const isError = keyState.status === 'error';

  const switchMode = (newMode: 'normal' | 'recover' | 'regenerate') => {
    setMode(newMode);
    setError(null);
    setPassword('');
    setOldPassword('');
    setConfirmRegenerate(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'recover') {
        if (!oldPassword.trim()) return;
        const ok = await onRecover(oldPassword, password);
        if (!ok) setError('Could not decrypt with that password. Please check and try again.');
      } else if (mode === 'regenerate') {
        if (!confirmRegenerate) return;
        await onRegenerate(password);
      } else if (isSetup) {
        await onGenerate(password);
      } else if (isLocked || isError) {
        const ok = await onUnlock(password);
        if (!ok) setError('Incorrect password. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === 'recover'
      ? 'Recover Chat Keys'
      : mode === 'regenerate'
        ? 'Regenerate Chat Keys'
        : isSetup
          ? 'Set Up Encryption'
          : 'Unlock Chat';

  const subtitle =
    mode === 'recover'
      ? 'Enter your previous password to recover your encryption keys, then re-encrypt them with your current password.'
      : mode === 'regenerate'
        ? 'Generate new encryption keys using your current password. You will lose access to previous messages.'
        : isSetup
          ? 'Enter your account password to enable end-to-end encrypted messaging.'
          : 'Enter your password to decrypt your chat keys.';

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-overlay/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-primary">
            {mode === 'regenerate' ? 'restart_alt' : 'lock'}
          </span>
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
        </div>

        {mode !== 'normal' && (
          <button
            type="button"
            onClick={() => switchMode('normal')}
            className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-white"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Back
          </button>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'recover' && (
            <div>
              <label htmlFor="old-password" className="mb-1 block text-sm text-muted">
                Previous Password
              </label>
              <input
                id="old-password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="app-input"
                placeholder="Password before the reset"
                autoFocus
              />
            </div>
          )}

          <div>
            <label htmlFor="encryption-password" className="mb-1 block text-sm text-muted">
              {mode === 'recover' ? 'Current Password' : 'Password'}
            </label>
            <input
              id="encryption-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="app-input"
              placeholder={
                mode === 'recover' ? 'Your new account password' : 'Your account password'
              }
              autoFocus={mode !== 'recover'}
            />
          </div>

          {mode === 'regenerate' && (
            <label className="flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={confirmRegenerate}
                onChange={(e) => setConfirmRegenerate(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              I understand I will lose access to old messages
            </label>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          {isError && mode === 'normal' && (
            <p className="text-sm text-red-400">{keyState.message}</p>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              !password.trim() ||
              (mode === 'recover' && !oldPassword.trim()) ||
              (mode === 'regenerate' && !confirmRegenerate)
            }
            className="w-full rounded-lg bg-primary px-4 py-2 font-bold text-on-accent transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading
              ? 'Processing...'
              : mode === 'recover'
                ? 'Recover Keys'
                : mode === 'regenerate'
                  ? 'Regenerate Keys'
                  : isSetup
                    ? 'Enable Encryption'
                    : 'Unlock'}
          </button>
        </form>

        {isError && mode === 'normal' && (
          <div className="mt-4 space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-sm text-amber-300">
              This usually happens after a password reset. Your chat keys were encrypted with your
              previous password.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => switchMode('recover')}
                className="w-full rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary hover:bg-primary/20"
              >
                I know my previous password
              </button>
              <button
                type="button"
                onClick={() => switchMode('regenerate')}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20"
              >
                Start fresh (lose old message access)
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <span className="material-symbols-outlined text-sm text-primary">shield</span>
          <p className="text-xs text-muted">
            Messages are encrypted end-to-end. Only you and the recipients can read them.
          </p>
        </div>
      </div>
    </div>
  );
}
