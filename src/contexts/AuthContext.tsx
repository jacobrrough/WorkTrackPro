import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@/core/types';
import { authService } from '@/services/api/auth';
import { mfaService } from '@/services/api/mfa';
import { adminSettingsService } from '@/services/api/adminSettings';
import { withTimeout } from '@/lib/withTimeout';
import { supabase } from '@/services/api/supabaseClient';
import { generateAndWrapKeyPair, unlockPrivateKey, importPublicKey } from '@/lib/crypto';
import { cryptoKeyCache } from '@/lib/crypto/keyCache';
import { encryptionKeyService } from '@/services/api/encryptionKeys';
import { isInternalAppPath } from '@/lib/authPaths';

/**
 * MFA gate state for a logged-in session. App.tsx (next stage) renders the gate;
 * AuthContext only computes and exposes it — it never blocks the render itself,
 * and signOut/logout always stay reachable so a user can never be wedged here.
 *
 *  - 'ok'        — session may enter the app (aal2, or MFA not required & no factor).
 *  - 'challenge' — a verified factor exists; user must enter a 6-digit code.
 *  - 'enroll'    — MFA is required but the user has no factor yet (forced setup).
 */
export type MfaGate = 'ok' | 'challenge' | 'enroll';

// localStorage key SettingsContext persists org settings under — read here as a
// synchronous fast-path so the gate doesn't flash 'ok' before the async confirm.
const SETTINGS_STORAGE_KEY = 'worktrack-admin-settings';

/**
 * Whether THIS user must satisfy MFA.
 *
 * Scope note: WorkTrackPro projects no accounting role to the client — the
 * `accounting_admin` Postgres role is server-side only (RLS / SECURITY DEFINER
 * RPCs) and never lands on the `User` shape. So "required" is scoped to admins.
 * If/when an accounting-role flag graduates onto `User`, OR it into the second
 * clause here (e.g. `user.isAdmin || user.isAccounting`).
 *
 * `requireMfa` is the org kill-switch; undefined is treated as true (fail safe
 * toward enforcing), so only an explicit `false` disables it.
 */
function mfaRequired(user: User | null, requireMfa: boolean | undefined): boolean {
  if (!user) return false;
  return requireMfa !== false && user.isAdmin === true;
}

/**
 * Best-effort read of the org `requireMfa` flag from WITHIN AuthContext.
 *
 * AuthProvider sits ABOVE SettingsProvider in the tree, so it cannot call
 * useSettings(). We read the localStorage cache synchronously and let callers
 * pass an authoritative override (App.tsx, which IS inside SettingsProvider,
 * forwards the live value via refreshMfaGate). Default is true (enforce) on any
 * parse failure or absent value.
 */
function readCachedRequireMfa(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { requireMfa?: unknown };
    return parsed.requireMfa === false ? false : true;
  } catch {
    return true;
  }
}

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
  /**
   * MFA gate for the current session. 'ok' until a session exists and the gate
   * has been computed. App.tsx renders the challenge/enroll UI off this; the app
   * render is NOT blocked here.
   */
  mfaGate: MfaGate;
  /** Verified TOTP factor id to challenge against (the 'challenge' gate), else null. */
  mfaFactorId: string | null;
  /** True while the gate is being (re)computed — lets the gate UI avoid a flash. */
  mfaChecking: boolean;
  /**
   * Recompute the gate. Call after login, after enroll/verify succeeds, or when
   * org settings load/change. Pass the authoritative `requireMfa` when known
   * (App.tsx forwards it from SettingsContext); omit to use the cached value.
   */
  refreshMfaGate: (requireMfaOverride?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mfaGate, setMfaGate] = useState<MfaGate>('ok');
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChecking, setMfaChecking] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Holds the most recent authoritative requireMfa value App.tsx forwards from
  // SettingsContext, so internally-triggered refreshes (TOKEN_REFRESHED, etc.)
  // reuse it instead of falling back to the localStorage cache.
  const requireMfaRef = React.useRef<boolean | undefined>(undefined);
  // Guards against an out-of-order refresh stomping a newer result.
  const mfaRefreshSeq = React.useRef(0);

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
  // Monotonic auth generation. Bumped on every logout/hardLogout so a checkAuth()
  // resolution from an in-flight TOKEN_REFRESHED that lands AFTER the logout is
  // recognized as stale and ignored — otherwise it would re-populate currentUser
  // and silently bounce a just-logged-out user back into the app.
  const authEpoch = React.useRef(0);

  // Evict every in-memory trace of the session: the decrypted E2E private key
  // (module-memory cryptoKeyCache) and the previous user's React Query cache.
  // Shared by both logout paths so a future "also clear X on logout" change can't
  // land in one and miss the other.
  const clearInMemorySession = useCallback(() => {
    cryptoKeyCache.clear();
    queryClient.clear();
  }, [queryClient]);

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
      // Sole cleanup point for the session-expiry flag. initApp bails without
      // calling checkAuth when the flag is present; clearing it here unblocks
      // normal auth flow on any subsequent page load after re-authentication.
      sessionStorage.removeItem('wtp_session_expired');
      setAuthError(null);
      setIsLoading(true);
      try {
        const user = await authService.login(email, password);
        setCurrentUser(user);
        await tryUnlockKeys(password);
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

  /**
   * Compute the MFA gate for the current session and publish it.
   *
   * Decision tree (exactly the order the spec mandates):
   *   1. No live session            -> 'ok'  (nothing to gate; login screen shows)
   *   2. Session is aal2            -> 'ok'  (already stepped up)
   *   3. Has a verified factor      -> 'challenge'
   *      (verified TOTP exists OR nextLevel can reach 'aal2')
   *   4. MFA required for this user -> 'enroll' (forced first-time setup)
   *   5. Otherwise                  -> 'ok'  (not required, no factor)
   *
   * Fail-safe posture: if the org requires MFA and the factor lookup ERRORS, we
   * do NOT fall through to 'ok'. We send the user to 'challenge' when we know a
   * factor exists, else 'enroll' — i.e. we never silently grant entry to a
   * required user just because a network call failed. Conversely, when MFA is
   * not required, an error degrades to 'ok' so a transient failure can't lock a
   * non-required user out of the app.
   */
  const refreshMfaGate = useCallback(
    async (requireMfaOverride?: boolean): Promise<void> => {
      if (requireMfaOverride !== undefined) requireMfaRef.current = requireMfaOverride;
      const seq = ++mfaRefreshSeq.current;
      const apply = (gate: MfaGate, factorId: string | null) => {
        // Ignore a stale resolution superseded by a newer refresh.
        if (seq !== mfaRefreshSeq.current) return;
        setMfaGate(gate);
        setMfaFactorId(factorId);
      };

      setMfaChecking(true);
      try {
        // No live session => nothing to gate (e.g. logged out). The login screen
        // is what renders in this state, not the gate.
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession(), 5000);
        if (!session?.user) {
          apply('ok', null);
          return;
        }

        // Resolve the user we're gating. currentUser may not be set yet on the
        // very first pass (state update is async), so fall back to a fresh read.
        let user = currentUser;
        if (!user) {
          try {
            user = await authService.checkAuth();
          } catch {
            user = null;
          }
        }

        // Authoritative requireMfa, in priority order:
        //   1) explicit override (App.tsx, live from SettingsContext)
        //   2) the last override we cached on the ref
        //   3) localStorage cache SettingsContext persists
        //   4) a direct org-settings read (AuthContext is above SettingsProvider,
        //      so this is our only in-context way to consult the source of truth)
        //   5) default true (enforce)
        // Only steps 1-3 short-circuit; if none are known we await the service.
        let requireMfa = requireMfaOverride ?? requireMfaRef.current;
        if (requireMfa === undefined) {
          const cached = localStorage.getItem(SETTINGS_STORAGE_KEY);
          if (cached !== null) {
            requireMfa = readCachedRequireMfa();
          } else {
            try {
              const org = await adminSettingsService.getOrganizationSettings();
              requireMfa = org?.requireMfa ?? true;
            } catch {
              requireMfa = true;
            }
          }
          requireMfaRef.current = requireMfa;
        }
        const required = mfaRequired(user, requireMfa);

        let state: Awaited<ReturnType<typeof mfaService.getState>> | null = null;
        try {
          state = await mfaService.getState();
        } catch (e) {
          console.warn('MFA state lookup failed:', e);
          // Fail safe: a required user with an unknown factor state must still be
          // challenged/enrolled, never waved through. A non-required user degrades
          // to 'ok' so a transient error can't lock them out.
          apply(required ? 'enroll' : 'ok', null);
          return;
        }

        // 2) Already stepped up.
        if (state.currentLevel === 'aal2') {
          apply('ok', state.factorId);
          return;
        }

        // 3) A verified factor exists -> challenge for the code.
        const hasVerifiedFactor = state.hasVerifiedFactor || state.nextLevel === 'aal2';
        if (hasVerifiedFactor) {
          apply('challenge', state.factorId);
          return;
        }

        // 4) Required but no factor -> forced enrollment.
        if (required) {
          apply('enroll', null);
          return;
        }

        // 5) Not required, no factor -> allowed in.
        apply('ok', null);
      } catch (e) {
        // getSession itself failed (timeout/network). Treat as not-yet-known and
        // fall back to the cached requirement so we still fail safe for admins.
        console.warn('refreshMfaGate failed:', e);
        const requireMfa = requireMfaOverride ?? requireMfaRef.current ?? readCachedRequireMfa();
        apply(mfaRequired(currentUser, requireMfa) ? 'enroll' : 'ok', null);
      } finally {
        if (seq === mfaRefreshSeq.current) setMfaChecking(false);
      }
    },
    [currentUser]
  );

  // Hard logout: used when the system forces a sign-out (idle timeout, token
  // refresh failure, or Supabase killing the session unexpectedly).
  // Wipes login tokens from browser storage, then navigates to /login so there
  // is zero stale state left in memory. A flag in sessionStorage tells the
  // login screen to show "Your session expired."
  const hardLogout = useCallback(async () => {
    if (reloadPending.current) return;
    reloadPending.current = true;
    userInitiatedLogout.current = true; // prevents onAuthStateChange from scheduling a second reload
    authEpoch.current++; // invalidate any in-flight TOKEN_REFRESHED checkAuth resolution
    sessionStorage.setItem('wtp_session_expired', '1');
    // Evict in-memory secrets NOW rather than trusting the page reload below to do
    // it. The decrypted E2E private key and the previous user's query cache must be
    // gone the instant we decide to force a logout, not merely whenever the browser
    // gets around to unloading.
    clearInMemorySession();
    // Capture where they were so re-authentication returns them there. Uses the
    // SAME isInternalAppPath predicate as App.tsx's safeReturnTo so the two never
    // disagree — and because window.location.replace (unlike <Navigate>) honors
    // absolute URLs, this sink must never receive anything but a vetted /app path.
    const here = window.location.pathname + window.location.search;
    const loginTarget = isInternalAppPath(here)
      ? `/login?returnTo=${encodeURIComponent(here)}`
      : '/login';
    try {
      await withTimeout(supabase.auth.signOut({ scope: 'local' }), 3000); // clears tokens from localStorage, no server call needed
    } catch (e) {
      console.warn('hardLogout: signOut failed, reloading anyway', e);
      // signOut timed out — manually wipe Supabase auth keys so checkAuth
      // cannot re-hydrate a stale session on the next page load.
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        // ignore — storage may be unavailable in some environments
      }
    } finally {
      // Navigate to /login rather than reloading in place. reload() would
      // re-enter whatever authenticated view the worker was on, hit a lazy
      // Suspense boundary, and show a stuck "Loading view..." screen.
      // replace() (not assign) keeps the dead /app/* URL out of back-history.
      try {
        window.location.replace(loginTarget);
      } catch {
        reloadPending.current = false; // unblock retries if navigation fails
        window.location.reload();
      }
    }
  }, [clearInMemorySession]);

  const logout = useCallback(() => {
    userInitiatedLogout.current = true;
    authEpoch.current++; // invalidate any in-flight TOKEN_REFRESHED checkAuth resolution
    // Clear currentUser so per-user query consumers re-render disabled
    // (e.g. useDashboardPreferencesSync, gated on !!currentUser) and the app
    // swaps to the login screen.
    setCurrentUser(null);
    // Button logout is an in-memory transition with no page reload to clear caches
    // for us, so wipe the decrypted key + query/mutation cache explicitly. Several
    // per-user queries use intentionally user-agnostic keys (e.g.
    // dashboard-preferences), so a full clear() — not targeted removeQueries — is
    // what guarantees nothing from this user survives for the next on a shared
    // browser. (Any save that still rejects post-logout is an auth error its own
    // onError now swallows, so it can't re-populate the cache we just cleared.)
    clearInMemorySession();
    authService.logout();
    // Land on the real /login URL (replace, so the protected /app/* page they were
    // on leaves the back-history). No returnTo: an explicit logout is a fresh start,
    // so the next login goes to /app rather than bouncing back to where they left.
    navigate('/login', { replace: true });
  }, [clearInMemorySession, navigate]);

  // Initial auth check
  useEffect(() => {
    const initApp = async () => {
      // If hardLogout set the expiry flag before navigating here, bail out
      // immediately — do not call checkAuth. checkAuth could return a user
      // from stale localStorage tokens (signOut may have timed out), which
      // would flip !currentUser to true, bypass the render guard in App.tsx,
      // and land on a lazy Suspense boundary → stuck "Loading view..." screen.
      // login() is the sole point that clears the flag after re-authentication.
      if (sessionStorage.getItem('wtp_session_expired')) {
        setIsLoading(false);
        return;
      }
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

  // Recompute the MFA gate whenever the logged-in user changes.
  //  - User present (login / hydrate / token refresh / user switch): compute the
  //    gate from the live session + factor state.
  //  - No user (logged out): reset to 'ok' and drop the factor id so the gate UI
  //    never lingers over the login screen.
  // Keyed on the user id (not the object identity) so an unrelated profile-object
  // refresh doesn't thrash the gate. The gate itself only ever GATES; it never
  // blocks render here, and logout/signOut stay reachable regardless.
  useEffect(() => {
    if (!currentUser) {
      mfaRefreshSeq.current++; // cancel any in-flight refresh from a prior user
      setMfaGate('ok');
      setMfaFactorId(null);
      setMfaChecking(false);
      return;
    }
    void refreshMfaGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id is the stable identity; refreshMfaGate is stable per-user
  }, [currentUser?.id]);

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
        const epoch = authEpoch.current;
        authService
          .checkAuth()
          .then((user) => {
            // Ignore a resolution superseded by a logout that happened while this
            // checkAuth was in flight — otherwise it would re-populate currentUser
            // and bounce the just-logged-out user back into the app.
            if (epoch !== authEpoch.current) return;
            if (user) setCurrentUser(user);
          })
          .catch((e) => console.warn('checkAuth after TOKEN_REFRESHED failed:', e));
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
  }, [currentUser, hardLogout]);

  // Visibility check: fires when the worker brings the tab into focus.
  // Reads the session from the browser's local cache (no network call unless
  // the token needs refreshing). If the session is dead, hard-reloads the page.
  // Guards prevent it from firing before the worker has ever logged in.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!hasBeenAuthenticated.current) return; // not logged in this session
      if (reloadPending.current) return; // reload already on its way
      try {
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession(), 5000);
        if (!session) await hardLogout();
      } catch {
        // Timeout or network error on visibility check — treat as session lost.
        await hardLogout();
      }
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
    mfaGate,
    mfaFactorId,
    mfaChecking,
    refreshMfaGate,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
