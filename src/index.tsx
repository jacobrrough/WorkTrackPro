// index.tsx — Single ErrorBoundary, React Router
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './AppContext';
import { ToastProvider } from './Toast';
import ErrorBoundary from './ErrorBoundary';
import SetupRequired from './SetupRequired';
import { isSupabaseConfigured } from './lib/supabaseEnv';
import './index.css';

const PRELOAD_RELOAD_GUARD_KEY = 'worktrack-preload-reload-at';
const PRELOAD_RELOAD_GUARD_MS = 15_000;

if (typeof window !== 'undefined') {
  // Recover once when a stale deploy leaves lazy chunks unavailable.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    const now = Date.now();
    const lastReloadAt = Number(sessionStorage.getItem(PRELOAD_RELOAD_GUARD_KEY) ?? '0');
    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < PRELOAD_RELOAD_GUARD_MS) {
      return;
    }
    sessionStorage.setItem(PRELOAD_RELOAD_GUARD_KEY, String(now));
    window.location.reload();
  });
}

function renderFallback(message: string) {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  rootEl.innerHTML = `<div style="max-width:28rem;margin:2rem auto;padding:1.5rem;background:#1e293b;border:1px solid #475569;border-radius:0.5rem;color:#e2e8f0;font-family:system-ui,sans-serif;"><p style="margin:0 0 0.5rem;font-weight:600;">WorkTrack Pro</p><p style="margin:0;color:#94a3b8;">${message}</p></div>`;
}

try {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('No #root');
  const root = ReactDOM.createRoot(rootEl);

  if (!isSupabaseConfigured()) {
    root.render(<SetupRequired />);
  } else {
    root.render(
      <ErrorBoundary>
        <BrowserRouter>
          <AppProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AppProvider>
        </BrowserRouter>
      </ErrorBoundary>
    );
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  renderFallback(
    'Setup error: ' +
      msg +
      '. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify, then redeploy.'
  );
}

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
const isNetlifyDeployPreview =
  hostname.startsWith('deploy-preview-') && hostname.endsWith('.netlify.app');
const isNetlifyBranchDeploy = hostname.endsWith('.netlify.app') && hostname.includes('--');
const isVercelPreview = hostname.endsWith('.vercel.app') && hostname.includes('-git-');
const shouldDisableServiceWorker =
  isLocalhost || isNetlifyDeployPreview || isNetlifyBranchDeploy || isVercelPreview;

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (shouldDisableServiceWorker) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            if (key.startsWith('worktrack-pro-')) {
              void caches.delete(key);
            }
          });
        });
      }
      return;
    }

    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore registration errors (e.g. not HTTPS in dev)
      });
    }
  });
}
