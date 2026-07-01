import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from './AppContext';
import { AppShell } from './components/AppShell';
import { AppRouter } from './AppRouter';
import { useAppNavigate } from './hooks/useAppNavigate';
import ErrorBoundary from './ErrorBoundary';
import Login from './Login';
import MFAEnrollScreen from './MFAEnrollScreen';
import MFAChallengeScreen from './MFAChallengeScreen';
import PublicHome from './public/PublicHome';
import Storefront from './public/Storefront';
import { CommandPalette } from './components/CommandPalette';
import { useAuth } from './contexts/AuthContext';
import { isInternalAppPath } from './lib/authPaths';

// #7 — public customer portal (/portal/<token>). Lazy so the invoice PDF builder and the
// portal view stay out of the main app bundle and only load for portal visitors.
const CustomerPortal = lazy(() => import('./public/portal/CustomerPortal'));

// Public (no-auth) legal pages — stable URLs to share with Plaid (/privacy, /terms).
// Lazy-loaded so the long static legal copy stays out of the main bundle.
const PrivacyPolicyPage = lazy(() => import('./public/PrivacyPolicyPage'));
const TermsOfServicePage = lazy(() => import('./public/TermsOfServicePage'));

// Public "Request a Quote" route. Lazy so the proposal form's upload + Turnstile
// code (and the @supabase/supabase-js it pulls) stays off the homepage path.
const RequestQuote = lazy(() => import('./public/RequestQuote'));

// Validates a returnTo value before we redirect to it. Only internal employee-app
// paths are allowed (via the shared isInternalAppPath predicate) — this is what
// stops a crafted /login?returnTo=//evil.com (or a javascript: URL) from becoming
// an open redirect.
function safeReturnTo(raw: string | null): string {
  // `raw` already comes URL-decoded from URLSearchParams.get, so validate it as-is.
  // Decoding again would corrupt encoded chars (e.g. %20 → space) or throw on a
  // literal %, silently degrading a legitimate deep link down to /app.
  if (!raw) return '/app';
  return isInternalAppPath(raw) ? raw : '/app';
}

// Shared full-screen spinner for the brief auth-resolution holds (session
// hydration, MFA gate confirmation). The richer initial-load screen below has its
// own "taking too long" affordance and stays separate.
function CenteredLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark">
      <p className="text-muted">Loading...</p>
    </div>
  );
}

export default function App() {
  const {
    currentUser,
    isLoading,
    authError,
    login,
    signUp,
    resetPasswordForEmail,
    logout,
    jobs,
    inventory,
    users,
  } = useApp();

  // MFA gate state lives on AuthContext (AppContext doesn't re-export it). Safe to
  // read here: AuthProvider wraps AppProviderInner, both above <App/>. The gate is
  // applied below — only AFTER a session and approval are confirmed.
  const { mfaGate, mfaChecking } = useAuth();

  const location = useLocation();

  // Anti-flash guard for the MFA gate. `mfaGate` defaults to 'ok', and the
  // AuthContext effect that recomputes it for a freshly-set user runs AFTER this
  // render — so there is a frame where an MFA-required user is authenticated but
  // the gate still reads 'ok'. Rendering the app in that frame would briefly
  // expose it. We hold the app behind a loading screen until the gate has been
  // affirmatively computed once for the current session.
  //   - reset to false whenever the logged-in user changes (new session to vet)
  //   - set true after the first mfaChecking true->false edge (a computation
  //     finished), or immediately once the gate is non-'ok' (we already know we
  //     must gate, so no flash is possible).
  const [mfaGateConfirmed, setMfaGateConfirmed] = useState(false);
  const prevMfaCheckingRef = useRef(false);
  useEffect(() => {
    setMfaGateConfirmed(false);
    prevMfaCheckingRef.current = false;
  }, [currentUser?.id]);
  useEffect(() => {
    if (mfaGate !== 'ok') {
      setMfaGateConfirmed(true);
    } else if (prevMfaCheckingRef.current && !mfaChecking) {
      // checking just finished and the verdict is 'ok' — safe to enter.
      setMfaGateConfirmed(true);
    }
    prevMfaCheckingRef.current = mfaChecking;
  }, [mfaGate, mfaChecking]);
  // Fail-open safety net: never strand a legitimate user on the loading screen.
  // If the gate is settled at 'ok' and not checking, confirm shortly even if we
  // never observed a checking edge (e.g. a gate that resolves synchronously).
  // This can only ever release an ALREADY-'ok' gate, so it cannot leak the app
  // to a user the gate would block.
  useEffect(() => {
    if (mfaGateConfirmed) return;
    if (mfaGate === 'ok' && !mfaChecking) {
      const t = window.setTimeout(() => setMfaGateConfirmed(true), 1500);
      return () => window.clearTimeout(t);
    }
  }, [mfaGateConfirmed, mfaGate, mfaChecking]);

  const [showLoadingHelp, setShowLoadingHelp] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // True once the initial auth check has resolved at least once. Lets /login hold
  // a full-screen loader ONLY during first hydration (so an already-authenticated
  // visitor never flashes the form) while keeping the form mounted across login
  // submits afterward — so its own disabled/spinner state shows instead of the app
  // blanking to a loader mid-submit.
  const [authSettled, setAuthSettled] = useState(false);
  useEffect(() => {
    if (!isLoading) setAuthSettled(true);
  }, [isLoading]);

  // Read the session-expiry flag set by hardLogout before navigating to /login.
  // sessionStorage persists across navigations within the tab but is cleared
  // on tab close. The flag (and this notice) persist across refreshes until
  // login() removes it after successful re-authentication.
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(() => {
    const flag = sessionStorage.getItem('wtp_session_expired');
    return flag ? 'Your session expired. Please log in again.' : null;
  });

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      setSessionExpiredNotice(null);
      await login(email, password);
    },
    [login]
  );

  const handleSignUp = useCallback(
    async (email: string, password: string, options?: { name?: string }) => {
      return signUp(email, password, options);
    },
    [signUp]
  );

  const appNavigate = useAppNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setShowLoadingHelp(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setShowLoadingHelp(true);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [isLoading]);

  const pathname = location.pathname;
  const isEmployeeAppPath = pathname === '/app' || pathname.startsWith('/app/');
  const isLoginPath = pathname === '/login';
  const returnToParam = new URLSearchParams(location.search).get('returnTo');

  // ─── /login — the dedicated, real auth URL ─────────────────────────────────
  // Logged-out users land here (never on a protected /app/* URL). Once a session
  // exists we leave immediately for the originally-requested path (returnTo), or
  // /app, so /login never lingers in the address bar or back-history.
  if (isLoginPath) {
    if (currentUser) {
      return <Navigate to={safeReturnTo(returnToParam)} replace />;
    }
    // Hold ONLY during the first session hydration so an already-authenticated
    // visitor doesn't flash the form before we redirect. The session-expiry notice
    // skips the hold (initApp bails without hydrating, so it should show at once),
    // and once auth has settled the form stays mounted across submits — isLoading
    // then drives the form's own disabled/spinner state.
    if (isLoading && !authSettled && !sessionExpiredNotice) {
      return <CenteredLoading />;
    }
    return (
      <Login
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onResetPassword={resetPasswordForEmail}
        error={sessionExpiredNotice ?? authError}
        isLoading={isLoading}
      />
    );
  }

  if (!isEmployeeAppPath) {
    // Replace (not push) so the public page doesn't sit in browser back-history
    // under the employee app — otherwise pressing back from /app exits the app
    // back to localhost:3000 (public home).
    const onEmployeeLogin = () => window.location.assign('/login');
    // #7 — public customer portal. Token-gated, read-only invoice view; talks only to the
    // /api/portal-invoice function (never the accounting client). Sits beside /shop.
    if (pathname.startsWith('/portal/')) {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-100 text-subtle">
              Loading…
            </div>
          }
        >
          <CustomerPortal />
        </Suspense>
      );
    }
    if (pathname === '/shop' || pathname.startsWith('/shop/')) {
      return <Storefront onEmployeeLogin={onEmployeeLogin} />;
    }
    // Public "Request a Quote" route — the proposal form on its own roomy page.
    if (pathname === '/quote') {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-100 text-subtle">
              Loading…
            </div>
          }
        >
          <RequestQuote onEmployeeLogin={onEmployeeLogin} />
        </Suspense>
      );
    }
    // Public (no-auth) legal pages. Reachable by logged-out visitors and Plaid
    // reviewers since this branch runs before any auth gate. Light-themed.
    if (pathname === '/privacy' || pathname === '/terms') {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-slate-50 text-subtle">
              Loading…
            </div>
          }
        >
          {pathname === '/privacy' ? <PrivacyPolicyPage /> : <TermsOfServicePage />}
        </Suspense>
      );
    }
    return <PublicHome onEmployeeLogin={onEmployeeLogin} />;
  }

  // Logged out on a protected /app/* URL → bounce to the real /login route,
  // remembering where they were headed. The protected path never shows in the
  // address bar for an unauthenticated visitor, and AppRouter — along with every
  // query and realtime subscription, all gated on currentUser — stays unmounted.
  if (!currentUser && !isLoading) {
    const returnTo = encodeURIComponent(pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark">
        <div className="px-4 text-center">
          <p className="text-muted">Loading...</p>
          {showLoadingHelp && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-left">
              <p className="text-sm text-white">Startup is taking longer than expected.</p>
              <p className="mt-1 text-xs text-muted">
                If this persists, refresh to recover from a stale cached bundle or a temporary
                network issue.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-accent hover:bg-primary/90"
              >
                Retry Loading
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentUser && currentUser.isApproved === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark px-4">
        <div className="w-full max-w-sm rounded-lg border border-line bg-overlay/5 p-6 text-center">
          <span className="material-symbols-outlined text-4xl text-primary">shield_lock</span>
          <h2 className="mt-4 text-lg font-bold text-white">Pending approval</h2>
          <p className="mt-2 text-sm text-muted">
            Your account has been created, but an admin still needs to approve access.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-6 min-h-[44px] w-full touch-manipulation rounded-lg bg-primary px-4 py-3 font-bold text-on-accent hover:bg-primary/90"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  // MFA gate — only reached once a session exists (currentUser set) and the user
  // is approved. Order per spec: no session -> Login (handled above); session +
  // gate != 'ok' -> MFA screen; else -> app. Both screens keep "Sign out"
  // reachable, so a user can never be wedged here.
  if (currentUser && mfaGate === 'enroll') {
    return <MFAEnrollScreen />;
  }
  if (currentUser && mfaGate === 'challenge') {
    return <MFAChallengeScreen />;
  }

  // Gate reads 'ok' but hasn't been affirmatively computed for this session yet
  // (fresh-login frame before AuthContext's recompute effect runs). Hold the app
  // behind a loading screen so an MFA-required user is never flashed the app.
  if (currentUser && !mfaGateConfirmed) {
    return <CenteredLoading />;
  }

  return (
    <>
      {currentUser && (
        <ErrorBoundary
          fallback={
            <div className="fixed bottom-4 right-4 rounded-lg border border-red-500/30 bg-background-dark/95 px-3 py-2 text-sm text-red-400">
              Command palette unavailable
            </div>
          }
        >
          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            jobs={jobs}
            inventory={inventory}
            users={users}
            onNavigate={appNavigate}
          />
        </ErrorBoundary>
      )}
      <ErrorBoundary
        fallback={
          <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark p-4 text-center">
            <p className="text-lg font-semibold text-white">Something went wrong</p>
            <p className="mt-2 max-w-md text-sm text-muted">
              An unexpected error occurred. Please refresh the page. If the problem persists,
              contact your administrator.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-accent hover:bg-primary/90"
            >
              Refresh Page
            </button>
          </div>
        }
      >
        <AppShell>
          <AppRouter />
        </AppShell>
      </ErrorBoundary>
    </>
  );
}
