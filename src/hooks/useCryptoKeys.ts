import { useCallback, useEffect, useState } from 'react';
import { generateAndWrapKeyPair, unlockPrivateKey, importPublicKey } from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import { encryptionKeyService } from '@/services/api/encryptionKeys';

export type KeyState =
  | { status: 'loading' }
  | { status: 'not_setup' }
  | { status: 'locked' }
  | { status: 'unlocked' }
  | { status: 'error'; message: string };

export function useCryptoKeys(userId: string | undefined) {
  const [keyState, setKeyState] = useState<KeyState>({ status: 'loading' });

  useEffect(() => {
    if (!userId) {
      setKeyState({ status: 'not_setup' });
      return;
    }
    if (cryptoKeyCache.hasIdentityKeys()) {
      setKeyState({ status: 'unlocked' });
      return;
    }
    encryptionKeyService
      .hasKeys()
      .then((has) => setKeyState(has ? { status: 'locked' } : { status: 'not_setup' }))
      .catch(() => setKeyState({ status: 'not_setup' }));
  }, [userId]);

  const generateKeys = useCallback(async (password: string) => {
    try {
      const keyData = await generateAndWrapKeyPair(password);
      await encryptionKeyService.upsertKeyPair(keyData);
      const privateKey = await unlockPrivateKey(
        keyData.encryptedPrivateKey,
        keyData.keySalt,
        keyData.keyIv,
        password
      );
      const publicKey = await importPublicKey(keyData.publicKey);
      cryptoKeyCache.setIdentityKeys(privateKey, publicKey);
      setKeyState({ status: 'unlocked' });
    } catch (e) {
      setKeyState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Key generation failed',
      });
    }
  }, []);

  const unlock = useCallback(async (password: string) => {
    try {
      const keys = await encryptionKeyService.getMyKeys();
      if (!keys) {
        setKeyState({ status: 'not_setup' });
        return false;
      }
      const privateKey = await unlockPrivateKey(
        keys.encryptedPrivateKey,
        keys.keySalt,
        keys.keyIv,
        password
      );
      const publicKey = await importPublicKey(keys.publicKey);
      cryptoKeyCache.setIdentityKeys(privateKey, publicKey);
      setKeyState({ status: 'unlocked' });
      return true;
    } catch {
      setKeyState({ status: 'error', message: 'Incorrect password or corrupted keys' });
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    cryptoKeyCache.clear();
    setKeyState({ status: 'locked' });
  }, []);

  return { keyState, generateKeys, unlock, lock };
}
