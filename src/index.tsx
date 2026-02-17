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
  renderFallback('Setup error: ' + msg + '. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify, then redeploy.');
}
