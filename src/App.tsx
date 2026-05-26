// @ts-nocheck -- Transitional file during routing refactor (old view-state + new AppRouter coexist). Remove once old switch is fully deleted.
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './AppContext';
import { AppShell } from './components/AppShell';
import { AppRouter } from './AppRouter';
import { useAppNavigate } from './hooks/useAppNavigate';
import type { ViewState } from './core/types';
import Login from './Login';
import PublicHome from './public/PublicHome';
import Storefront from './public/Storefront';
import { CommandPalette } from './components/CommandPalette';

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

  // Router hooks declared early so they can be used by handleNavigate and effects
  const location = useLocation();
  const navigate = useNavigate();

  const [view, setView] = useState<ViewState>('dashboard');
  const [id, setId] = useState<string | undefined>(undefined);
  const [, setBackStack] = useState<Array<{ view: ViewState; id?: string }>>([]);
  const [showLoadingHelp, setShowLoadingHelp] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Read the session-expiry flag set by hardLogout before navigating to /app.
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

  const _handleNavigate = useCallback(
    (nextView: ViewState, nextId?: string | { jobId?: string; partId?: string }) => {
      const isDetailView =
        nextView === 'job-detail' ||
        nextView === 'inventory-detail' ||
        nextView === 'part-detail' ||
        nextView === 'board-card-detail';

      if (isDetailView) {
        setBackStack((prev) => {
          const entry = id !== undefined ? { view, id } : { view };
          return [...prev, entry];
        });
      } else {
        setBackStack([]);
      }

      setView(nextView);
      if (nextId === undefined) {
        setId(undefined);
      } else if (typeof nextId === 'string') {
        setId(nextId);
      } else if (nextId && 'jobId' in nextId && nextId.jobId) {
        setId(nextId.jobId);
      } else if (nextId && 'partId' in nextId && nextId.partId) {
        setId(nextId.partId);
      } else {
        setId(undefined);
      }

      // Incremental deep linking (P1): push real URLs for the most important detail views
      // so users can copy/share links and browser back/forward works for them.
      if (nextView === 'job-detail' && id) {
        navigate(`/app/jobs/${id}`, { replace: true });
      }
      // Future: add similar for inventory-detail, part-detail, board-card-detail etc.
    },
    [view, id, navigate]
  );

  const navigateBackFrom = useCallback(
    (
      _detailView: 'job-detail' | 'inventory-detail' | 'part-detail' | 'board-card-detail',
      fallback: ViewState
    ) => {
      setBackStack((prev) => {
        const entry = prev[prev.length - 1];
        const nextStack = prev.slice(0, -1);
        if (entry != null) {
          setView(entry.view);
          setId(entry.id ?? undefined);
        } else {
          setView(fallback);
          setId(undefined);
        }
        return nextStack;
      });
    },
    []
  );

  const pathname = location.pathname;
  const isEmployeeAppPath = pathname === '/app' || pathname.startsWith('/app/');

  // Incremental deep linking (start of P1 routing work).
  // When URL matches a known detail pattern (e.g. /app/jobs/:id), drive the internal view state.
  // This gives shareable links, bookmarks, and better browser history for the most important views
  // while we gradually migrate away from pure view-state navigation.
  useEffect(() => {
    if (!isEmployeeAppPath) return;

    const jobMatch = pathname.match(/^\/app\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = jobMatch[1];
      if (view !== 'job-detail' || id !== jobId) {
        setView('job-detail');
        setId(jobId);
        setBackStack([]); // reset backstack when arriving via direct link
      }
      return;
    }
    // Future increments: add similar matchers for
    // /app/inventory/:id, /app/parts/:id, /app/boards/:boardId/cards/:cardId, etc.
  }, [pathname, isEmployeeAppPath, view, id]);

  if (!isEmployeeAppPath) {
    // Replace (not push) so the public page doesn't sit in browser back-history
    // under the employee app — otherwise pressing back from /app exits the app
    // back to localhost:3000 (public home).
    const onEmployeeLogin = () => navigate('/app', { replace: true });
    if (pathname === '/shop' || pathname.startsWith('/shop/')) {
      return <Storefront onEmployeeLogin={onEmployeeLogin} />;
    }
    return <PublicHome onEmployeeLogin={onEmployeeLogin} />;
  }

  if (!currentUser && sessionExpiredNotice) {
    return (
      <Login
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onResetPassword={resetPasswordForEmail}
        error={sessionExpiredNotice}
        isLoading={false}
      />
    );
  }

  if (!currentUser && !isLoading) {
    return (
      <Login
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onResetPassword={resetPasswordForEmail}
        error={authError ?? sessionExpiredNotice}
        isLoading={isLoading}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark">
        <div className="px-4 text-center">
          <p className="text-slate-400">Loading...</p>
          {showLoadingHelp && (
            <div className="mt-3 rounded-sm border border-primary/30 bg-primary/10 p-3 text-left">
              <p className="text-sm text-slate-200">Startup is taking longer than expected.</p>
              <p className="mt-1 text-xs text-slate-400">
                If this persists, refresh to recover from a stale cached bundle or a temporary
                network issue.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 rounded-sm bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90"
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
        <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/5 p-6 text-center">
          <span className="material-symbols-outlined text-4xl text-primary">shield_lock</span>
          <h2 className="mt-4 text-lg font-bold text-white">Pending approval</h2>
          <p className="mt-2 text-sm text-slate-300">
            Your account has been created, but an admin still needs to approve access.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-6 min-h-[44px] w-full touch-manipulation rounded-sm bg-primary px-4 py-3 font-bold text-white hover:bg-primary/90"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {currentUser && (
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          jobs={jobs}
          inventory={inventory}
          users={users}
          onNavigate={appNavigate}
        />
      )}
      <AppShell>
        <AppRouter />
      </AppShell>
    </>
  );
}
