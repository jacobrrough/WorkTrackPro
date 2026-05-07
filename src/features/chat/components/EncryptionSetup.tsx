import React, { useState } from 'react';
import type { KeyState } from '@/hooks/useCryptoKeys';

interface EncryptionSetupProps {
  keyState: KeyState;
  onGenerate: (password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<boolean>;
}

export function EncryptionSetup({ keyState, onGenerate, onUnlock }: EncryptionSetupProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSetup = keyState.status === 'not_setup';
  const isLocked = keyState.status === 'locked';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      if (isSetup) {
        await onGenerate(password);
      } else if (isLocked) {
        const ok = await onUnlock(password);
        if (!ok) setError('Incorrect password. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-primary">lock</span>
          <div>
            <h2 className="text-lg font-bold text-white">
              {isSetup ? 'Set Up Encryption' : 'Unlock Chat'}
            </h2>
            <p className="text-sm text-slate-400">
              {isSetup
                ? 'Enter your account password to enable end-to-end encrypted messaging.'
                : 'Enter your password to decrypt your chat keys.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="encryption-password" className="mb-1 block text-sm text-slate-300">
              Password
            </label>
            <input
              id="encryption-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-slate-500 focus:border-primary focus:outline-none"
              placeholder="Your account password"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {keyState.status === 'error' && (
            <p className="text-sm text-red-400">{keyState.message}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full rounded-sm bg-primary px-4 py-2 font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Processing...' : isSetup ? 'Enable Encryption' : 'Unlock'}
          </button>
        </form>

        <div className="mt-4 flex items-start gap-2 rounded-sm border border-primary/20 bg-primary/5 p-3">
          <span className="material-symbols-outlined text-sm text-primary">shield</span>
          <p className="text-xs text-slate-400">
            Messages are encrypted end-to-end. Only you and the recipients can read them.
          </p>
        </div>
      </div>
    </div>
  );
}
