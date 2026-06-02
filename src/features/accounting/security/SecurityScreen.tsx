/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E SECURITY HARDENING.
 *     Shared chrome for every security screen so the UnverifiedBanner + the security sub-nav are
 *     IMPOSSIBLE to forget: each screen renders <SecurityScreen tab=…> and the banner is emitted
 *     here unconditionally. The whole module is FLAG-DARK (VITE_ACCOUNTING_ENABLED off) and requires
 *     a SECURITY review (key management/rotation, encryption coverage, hash-chain integrity,
 *     backup/restore) before it is enabled. NOTHING in this area moves money or posts a journal
 *     entry. With the flag OFF none of this is reachable and it is stripped from the production build.
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountingShell } from '../components/AccountingShell';
import { UnverifiedBanner } from '../components/UnverifiedBanner';
import {
  securityBackupPath,
  securityOverviewPath,
  securityRolesPath,
} from '../constants';

/** The security sub-tabs (the audit-chain detail is reached FROM overview, not a top tab). */
export type SecurityTab = 'overview' | 'roles' | 'backup';

interface SecurityTabDef {
  key: SecurityTab;
  label: string;
  icon: string;
  path: string;
}

const TABS: SecurityTabDef[] = [
  { key: 'overview', label: 'Overview', icon: 'security', path: securityOverviewPath() },
  { key: 'roles', label: 'Roles', icon: 'admin_panel_settings', path: securityRolesPath() },
  { key: 'backup', label: 'Backup & restore', icon: 'database', path: securityBackupPath() },
];

/**
 * Shared layout for a security screen: the module shell (Settings nav active), the
 * mandatory UnverifiedBanner, the security sub-nav, and an optional page title/intro.
 */
export function SecurityScreen({
  tab,
  title,
  intro,
  children,
}: {
  tab: SecurityTab;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <AccountingShell active="settings" title="Security (Unverified)">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <UnverifiedBanner detail="Security hardening — requires a security review (key management/rotation, encryption coverage, hash-chain integrity, backup/restore) before this module is enabled." />

        {/* Security sub-nav */}
        <nav className="flex gap-1 overflow-x-auto" aria-label="Security sections">
          {TABS.map((t) => {
            const isActive = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => navigate(t.path)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </nav>

        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          {intro && <div className="mt-1 text-sm text-slate-400">{intro}</div>}
        </div>

        {children}
      </div>
    </AccountingShell>
  );
}

/** A small, reusable inline error block with a Retry control (shared loading/error chrome). */
export function SecurityError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
      <p className="text-sm text-red-300">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-sm bg-white/10 px-2.5 py-1 text-sm font-bold text-white hover:bg-white/20"
      >
        <span className="material-symbols-outlined text-lg">refresh</span>
        Retry
      </button>
    </div>
  );
}
