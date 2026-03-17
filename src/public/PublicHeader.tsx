import React from 'react';
import { Link } from 'react-router-dom';

const LOGO_CANDIDATES = ['/logo.png', '/logo.svg', '/logo'];

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
  const [logoIndex, setLogoIndex] = React.useState(0);

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

  const navLink =
    'min-h-[44px] rounded-sm border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold transition-colors hover:bg-white/10 touch-manipulation';
  const navActive = 'border-primary/50 bg-primary/15 text-primary';

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08090f]/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-white/95"
          >
            {logoIndex < LOGO_CANDIDATES.length ? (
              <img
                src={LOGO_CANDIDATES[logoIndex]}
                alt="Rough Cut Manufacturing logo"
                className="h-12 w-12 object-contain"
                onError={() => setLogoIndex((prev) => prev + 1)}
              />
            ) : (
              <span className="material-symbols-outlined text-primary">
                precision_manufacturing
              </span>
            )}
          </Link>
          <div>
            <Link to="/" className="text-lg font-bold tracking-wide text-white hover:underline">
              Rough Cut Manufacturing
            </Link>
            <p className="text-xs uppercase tracking-wider text-slate-300">
              Fabrication | Foam | Plastics | CNC | 3D Printing | FOD Protection
            </p>
          </div>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            to="/"
            className={`hidden ${navLink} ${currentPath === 'home' ? navActive : 'text-slate-100'} sm:inline-flex`}
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
            className={`hidden ${navLink} text-slate-100 sm:inline-flex`}
          >
            Submit Proposal
          </a>
          <button
            type="button"
            onClick={onEmployeeLogin}
            className="min-h-[44px] touch-manipulation rounded-sm border border-primary/50 bg-primary/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/30"
          >
            Employee Login
          </button>
        </nav>
      </div>
    </header>
  );
};

export default PublicHeader;
