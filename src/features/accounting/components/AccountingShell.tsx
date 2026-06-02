import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInAppBack } from '@/hooks/useInAppBack';
import { ACCOUNTING_NAV } from '../constants';

interface AccountingShellProps {
  active: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Shared layout for every accounting screen: sticky header (back to app + module
 * title + optional actions) and a horizontal sub-nav. Internal navigation uses
 * react-router directly so the module stays self-contained (no ViewState/
 * useAppNavigate changes in the core app during Phase 1).
 */
export function AccountingShell({ active, title, actions, children }: AccountingShellProps) {
  const navigate = useNavigate();
  const back = useInAppBack('/app');

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background-dark">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-background-dark/95 backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={back}
            aria-label="Back to app"
            className="flex size-10 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <span className="material-symbols-outlined text-primary">account_balance</span>
          <h1 className="flex-1 text-lg font-bold text-white">{title ?? 'Accounting'}</h1>
          {actions}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Accounting sections">
          {ACCOUNTING_NAV.map((item) => {
            const isActive = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.path)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
    </div>
  );
}
