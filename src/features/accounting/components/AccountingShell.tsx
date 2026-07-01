import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInAppBack } from '@/hooks/useInAppBack';
import {
  ACCOUNTING_NAV_OVERVIEW,
  accountingNavByGroup,
  type AccountingNavItem,
} from '../constants';

interface AccountingShellProps {
  active: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const RAIL_COLLAPSE_KEY = 'acct.rail.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** One rail/drawer row. Shared by the desktop rail and the mobile drawer so they never diverge. */
function NavRow({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: AccountingNavItem;
  active: string;
  collapsed: boolean;
  onClick: () => void;
}) {
  const isActive = item.key === active;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
        collapsed ? 'justify-center' : ''
      } ${isActive ? 'bg-primary text-on-accent' : 'text-muted hover:bg-white/10 hover:text-on-accent'}`}
    >
      <span className="material-symbols-outlined text-lg">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
}

/** The grouped nav list — a pinned Overview row, then the QuickBooks-style sections. */
function NavList({
  active,
  collapsed,
  onNavigate,
}: {
  active: string;
  collapsed: boolean;
  onNavigate: (item: AccountingNavItem) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Accounting sections">
      <NavRow
        item={ACCOUNTING_NAV_OVERVIEW}
        active={active}
        collapsed={collapsed}
        onClick={() => onNavigate(ACCOUNTING_NAV_OVERVIEW)}
      />
      {accountingNavByGroup().map((section) => (
        <div key={section.group} className="flex flex-col gap-0.5">
          {collapsed ? (
            <div className="mx-2 my-1.5 border-t border-line" aria-hidden />
          ) : (
            <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-subtle">
              {section.label}
            </p>
          )}
          {section.items.map((item) => (
            <NavRow
              key={item.key}
              item={item}
              active={active}
              collapsed={collapsed}
              onClick={() => onNavigate(item)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Shared layout for every accounting screen: a QuickBooks-style LEFT RAIL on desktop
 * (collapsible, grouped into Sales / Expenses / Accounting / Reports / Setup) and a hamburger
 * DRAWER on mobile, plus a sticky top header (back-to-app + module title + optional actions).
 * Internal navigation uses react-router directly so the module stays self-contained.
 *
 * The `{active, title, actions, children}` prop contract is consumed by ~50 screens — keep it
 * stable. Only the internal rendering changed when the old horizontal sub-nav became a rail.
 */
export function AccountingShell({ active, title, actions, children }: AccountingShellProps) {
  const navigate = useNavigate();
  const back = useInAppBack('/app');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Persist the desktop collapse choice across screens/sessions.
  useEffect(() => {
    try {
      localStorage.setItem(RAIL_COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, [collapsed]);

  // Belt-and-suspenders: close the mobile drawer if the active screen changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [active]);

  const go = (item: AccountingNavItem) => {
    navigate(item.path);
    setMobileOpen(false);
  };

  return (
    // Bounded to the viewport (NOT min-h): the app root is `overflow:hidden`, so the shell
    // must fit and scroll its own <main> internally rather than overflowing the clipped root.
    <div className="flex h-[100dvh] bg-background-dark">
      {/* Desktop left rail (sticky; the page body scrolls beside it). */}
      <aside
        className={`sticky top-0 hidden h-[100dvh] shrink-0 flex-col self-start border-r border-line bg-background-dark md:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div
          className={`flex items-center gap-2 border-b border-line px-3 py-3 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <span className="material-symbols-outlined text-primary">account_balance</span>
          {!collapsed && <span className="text-base font-bold text-white">Accounting</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList active={active} collapsed={collapsed} onNavigate={go} />
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center gap-2 border-t border-line px-3 py-2 text-muted hover:bg-white/10 hover:text-white"
        >
          <span className="material-symbols-outlined text-lg">
            {collapsed ? 'chevron_right' : 'chevron_left'}
          </span>
          {!collapsed && <span className="text-xs font-semibold">Collapse</span>}
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-background-dark/95 px-4 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open accounting menu"
            className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white md:hidden"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          {/* One-tap escape to the app dashboard. `back` only steps a single history entry,
              so after deep accounting navigation it can take many taps to leave — this jumps
              straight out regardless of how deep the history stack is. */}
          <button
            type="button"
            onClick={() => navigate('/app')}
            aria-label="Go to app home"
            className="flex size-10 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">home</span>
          </button>
          <h1 className="flex-1 truncate text-lg font-bold text-white">{title ?? 'Accounting'}</h1>
          {actions}
        </header>
        {/* min-h-0 lets this flex child shrink below content height so overflow-y-auto can
            actually scroll; without it the content would push past the clipped root. */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4">{children}</main>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Accounting menu"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="flex h-full w-72 max-w-[80vw] flex-col bg-background-dark shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-3 py-3">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">account_balance</span>
                <span className="text-base font-bold text-white">Accounting</span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavList active={active} collapsed={false} onNavigate={go} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
