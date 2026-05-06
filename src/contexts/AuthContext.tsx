import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '@/core/types';
import { authService } from '@/services/api/auth';
import { supabase } from '@/services/api/supabaseClient';
import { generateAndWrapKeyPair, unlockPrivateKey, importPublicKey } from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import { encryptionKeyService } from '@/services/api/encryptionKeys';

export interface AuthContextType {
  currentUser: User | null;
  isLoading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  signUp: (
    email: string,
    password: string,
    options?: { name?: string }
  ) => Promise<boolean | 'needs_email_confirmation'>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- Session expiry guards ---
  // True once Supabase confirms a valid session this page load.
  // Prevents a false hard-reload on the login screen when the app first loads
  // with an already-expired token and Supabase fires SIGNED_OUT immediately.
  const hasBeenAuthenticated = React.useRef(false);
  // True when the worker clicked the Logout button themselves.
  // Keeps the onAuthStateChange handler from treating a user-initiated signOut
  // as an unexpected session death and triggering a page reload.
  const userInitiatedLogout = React.useRef(false);
  // True once a reload has been scheduled — prevents a race condition where
  // both the idle timeout and onAuthStateChange try to reload simultaneously.
  const reloadPending = React.useRef(false);

  const tryUnlockKeys = useCallback(async (password: string) => {
    try {
      const keys = await encryptionKeyService.getMyKeys();
      if (!keys) return;
      const privateKey = await unlockPrivateKey(
        keys.encryptedPrivateKey,
        keys.keySalt,
        keys.keyIv,
        password
      );
      const publicKey = await importPublicKey(keys.publicKey);
      cryptoKeyCache.setIdentityKeys(privateKey, publicKey);
    } catch (e) {
      console.warn('E2E key unlock deferred — will prompt in chat:', e);
    }
  }, []);

  const tryGenerateKeys = useCallback(async (password: string) => {
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
    } catch (e) {
      console.warn('E2E key generation deferred — will prompt in chat:', e);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setAuthError(null);
      setIsLoading(true);
      try {
        const user = await authService.login(email, password);
        setCurrentUser(user);
        void tryUnlockKeys(password);
        return true;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Login failed';
        setAuthError(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [tryUnlockKeys]
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      options?: { name?: string }
    ): Promise<boolean | 'needs_email_confirmation'> => {
      setAuthError(null);
      setIsLoading(true);
      try {
        const { user, needsEmailConfirmation } = await authService.signUp(email, password, options);
        if (user) {
          setCurrentUser(user);
          void tryGenerateKeys(password);
          return true;
        }
        return needsEmailConfirmation ? 'needs_email_confirmation' : false;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Sign up failed';
        setAuthError(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [tryGenerateKeys]
  );

  const resetPasswordForEmail = useCallback(async (email: string): Promise<void> => {
    setAuthError(null);
    await authService.resetPasswordForEmail(email);
  }, []);

  // Hard logout: used when the system forces a sign-out (idle timeout, token
  // refresh failure, or Supabase killing the session unexpectedly).
  // Wipes login tokens from browser storage, then reloads the page so there
  // is zero stale state left in memory. A flag in sessionStorage tells the
  // login screen to show "Your session expired."
  const hardLogout = useCallback(async () => {
    if (reloadPending.current) return;
    reloadPending.current = true;
    userInitiatedLogout.current = true; // prevents onAuthStateChange from scheduling a second reload
    sessionStorage.setItem('wtp_session_expired', '1');
    await supabase.auth.signOut({ scope: 'local' }); // clears tokens from localStorage, no server call needed
    window.location.reload();
  }, []);

  const logout = useCallback(() => {
    userInitiatedLogout.current = true;
    cryptoKeyCache.clear();
    authService.logout();
    setCurrentUser(null);
  }, []);

  // Initial auth check
  useEffect(() => {
    const initApp = async () => {
      setIsLoading(true);
      try {
        const user = await authService.checkAuth();
        if (user) setCurrentUser(user);
      } catch (error) {
        console.error('App initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    initApp();
  }, []);

  // Auth state listener: session expiry and token refresh
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Mark that a valid session exists so we know the worker was logged in.
      // This guards against hard-reloading on the login screen when the app
      // first loads and Supabase immediately fires SIGNED_OUT for a dead token.
      if (session) hasBeenAuthenticated.current = true;

      if (event === 'SIGNED_OUT' || !session) {
        if (!userInitiatedLogout.current && hasBeenAuthenticated.current) {
          // Session died on its own (expired, revoked, network cleared it).
          // Hard reload so there is zero stale state left in the app.
          void hardLogout();
          return;
        }
        // Worker clicked Logout, or app loaded with no session — clean transition only.
        userInitiatedLogout.current = false;
        hasBeenAuthenticated.current = false;
        setCurrentUser(null);
      }

      if (event === 'TOKEN_REFRESHED' && session?.user) {
        authService.checkAuth().then((user) => {
          if (user) setCurrentUser(user);
        });
      }
    });
    return () => subscription.unsubscribe();
  }, [hardLogout]);

  // Auth refresh + idle timeout
  useEffect(() => {
    if (!currentUser) return;

    let lastActivity = Date.now();

    const refreshAuthWithRetry = async (retries = 2): Promise<boolean> => {
      for (let i = 0; i <= retries; i++) {
        try {
          const user = await authService.checkAuth();
          if (user) return true;
        } catch (error) {
          if (i === retries) {
            console.error('Auth refresh failed after retries:', error);
            return false;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      return false;
    };

    const authRefreshInterval = setInterval(
      async () => {
        const ok = await refreshAuthWithRetry();
        if (!ok) void hardLogout();
      },
      20 * 60 * 1000
    );

    const updateActivity = () => {
      lastActivity = Date.now();
    };

    window.addEventListener('mousedown', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('touchstart', updateActivity);
    window.addEventListener('scroll', updateActivity);

    const idleCheckInterval = setInterval(() => {
      const idleTime = Date.now() - lastActivity;
      const idleLimit = 60 * 60 * 1000; // 1 hour
      if (idleTime >= idleLimit) void hardLogout();
    }, 60 * 1000);

    return () => {
      clearInterval(authRefreshInterval);
      clearInterval(idleCheckInterval);
      window.removeEventListener('mousedown', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('scroll', updateActivity);
    };
  }, [currentUser, logout, hardLogout]);

  // Visibility check: fires when the worker brings the tab into focus.
  // Reads the session from the browser's local cache (no network call unless
  // the token needs refreshing). If the session is dead, hard-reloads the page.
  // Guards prevent it from firing before the worker has ever logged in.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!hasBeenAuthenticated.current) return; // not logged in this session
      if (reloadPending.current) return; // reload already on its way
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) await hardLogout();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [hardLogout]);

  const value: AuthContextType = {
    currentUser,
    isLoading,
    authError,
    login,
    signUp,
    resetPasswordForEmail,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
