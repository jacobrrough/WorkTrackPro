import React from 'react';
import { Link } from 'react-router-dom';

const LOGO_SRC = '/logo-purple.png';

interface PublicHeaderProps {
  onEmployeeLogin: () => void;
  /** Highlight which nav item (for styling) */
  currentPath?: 'home' | 'shop';
  /** When on shop, show Cart link with this count (e.g. "Cart (3)") */
  cartCount?: number;
}

const PublicHeader: React.FC<PublicHeaderProps> = ({
  onEmployeeLogin,
  currentPath = 'home',
  cartCount,
}) => {
  const [logoOk, setLogoOk] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = React.useRef<HTMLAnchorElement>(null);

  // Preload the brand mark so we can fall back to the generic icon if it 404s.
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoOk(true);
    img.onerror = () => setLogoOk(false);
    img.src = LOGO_SRC;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, []);

  // Menu a11y: focus the first item on open, close on Escape and restore focus.
  React.useEffect(() => {
    if (!menuOpen) return;
    firstMenuItemRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Logo / brand name: when already on the home page, the public site scrolls
  // inside an inner container (not the window), so a bare <Link to="/"> clears
  // the hash but never scrolls back up. Intercept and scroll the real scroll
  // parent to the top (and clear any #section hash). From other routes, fall
  // through and let the Link navigate home normally.
  const handleBrandClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (window.location.pathname !== '/') return;
    e.preventDefault();
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    const findScroller = (node: HTMLElement | null): HTMLElement | null => {
      let el = node?.parentElement ?? null;
      while (el) {
        const overflowY = getComputedStyle(el).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    };
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    const scroller = findScroller(e.currentTarget);
    if (scroller) scroller.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
  };

  const handleSectionLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute('href') ?? '';
    if (!href.startsWith('#')) return;
    e.preventDefault();
    if (window.location.pathname !== '/') {
      window.location.href = `/${href}`;
      return;
    }
    if (window.location.hash !== href) {
      window.history.pushState(null, '', href);
    }
    const sectionId = href.replace('#', '').trim();
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Mobile "Contact us": close the menu and jump to the proposal form (the
  // public contact point). Reuses the section-link scroll/navigate behavior.
  const handleContact = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setMenuOpen(false);
    handleSectionLinkClick(e);
  };

  const navLink =
    'min-h-[44px] rounded-sm border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold transition-colors hover:bg-white/10 touch-manipulation';
  const navActive = 'border-primary/50 bg-primary/15 text-primary';

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-app/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            to="/"
            onClick={handleBrandClick}
            aria-label="Rough Cut Manufacturing — back to top"
            className="flex h-10 w-10 shrink-0 items-center justify-center sm:h-12 sm:w-12"
          >
            {logoOk ? (
              <span
                role="img"
                aria-label="Rough Cut Manufacturing logo"
                className="rcm-logo-mark h-full w-full"
              />
            ) : (
              <span className="material-symbols-outlined text-4xl text-primary">
                precision_manufacturing
              </span>
            )}
          </Link>
          <div className="min-w-0">
            <Link
              to="/"
              onClick={handleBrandClick}
              className="block truncate text-base font-bold tracking-wide text-white hover:underline sm:text-lg"
            >
              <span className="sm:hidden">RCM</span>
              <span className="hidden sm:inline">Rough Cut Manufacturing</span>
            </Link>
            <p className="hidden truncate text-xs uppercase tracking-wider text-muted sm:block">
              Fabrication | Foam | Plastics | CNC | 3D Printing | FOD Protection
            </p>
          </div>
        </div>
        <nav className="flex shrink-0 items-center gap-2">
          <Link
            to="/"
            className={`hidden ${navLink} ${currentPath === 'home' ? navActive : 'text-slate-100'} lg:inline-flex`}
          >
            Home
          </Link>
          <Link
            to="/shop"
            className={`${navLink} ${currentPath === 'shop' ? navActive : 'text-slate-100'} inline-flex`}
          >
            Shop
          </Link>
          {currentPath === 'shop' && (
            <Link to="/shop/cart" className={`${navLink} inline-flex items-center text-slate-100`}>
              {cartCount != null && cartCount > 0
                ? `Cart (${cartCount > 99 ? '99+' : cartCount})`
                : 'Cart'}
            </Link>
          )}
          <a
            href="#submit-proposal"
            onClick={handleSectionLinkClick}
            className={`hidden ${navLink} text-slate-100 lg:inline-flex`}
          >
            Submit Proposal
          </a>
          <button
            type="button"
            onClick={onEmployeeLogin}
            className="hidden min-h-[44px] shrink-0 touch-manipulation rounded-sm border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/25 lg:inline-flex"
          >
            Employee Login
          </button>
          {/* Mobile menu trigger — Contact us + Employee login live in here */}
          <button
            type="button"
            ref={menuTriggerRef}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-sm border border-white/20 bg-white/5 text-white transition-colors hover:bg-white/10 lg:hidden"
          >
            <span className="material-symbols-outlined">{menuOpen ? 'close' : 'menu'}</span>
          </button>
        </nav>
      </div>

      {menuOpen && (
        <>
          {/* Click-away backdrop */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-transparent lg:hidden"
          />
          <div
            role="menu"
            className="absolute right-4 top-full z-50 mt-1 w-52 overflow-hidden rounded-sm border border-line-strong bg-app/95 shadow-xl shadow-black/50 backdrop-blur lg:hidden"
          >
            <a
              href="#submit-proposal"
              ref={firstMenuItemRef}
              onClick={handleContact}
              role="menuitem"
              className="block px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus:bg-white/10 focus:outline-none"
            >
              Contact us
            </a>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEmployeeLogin();
              }}
              className="block w-full border-t border-line px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:bg-white/5 focus:bg-white/10 focus:outline-none"
            >
              Employee login
            </button>
          </div>
        </>
      )}
    </header>
  );
};

export default PublicHeader;
