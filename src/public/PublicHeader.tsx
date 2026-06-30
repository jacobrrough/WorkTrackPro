import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './public.css';

interface PublicHeaderProps {
  onEmployeeLogin: () => void;
  /** Highlight which nav item (for styling) */
  currentPath?: 'home' | 'shop';
  /** When on shop, show Cart link with this count (e.g. "Cart (3)") */
  cartCount?: number;
}

/**
 * Shared public header ("Direction E"). Carries `.rcm-site` so its red
 * auto-light/dark theme applies even when it sits above the (still-Tailwind)
 * storefront/legal bodies — those never carry `.rcm-site`, so nothing bleeds.
 *
 * Nav IA: Products → /shop · Contact → /#contact. "Request a Quote" lives
 * only in the CTA (red button on desktop, .mm-quote in the mobile menu) so it
 * isn't duplicated in the primary nav.
 * Props (`onEmployeeLogin`, `currentPath`, `cartCount`) are preserved so the
 * storefront keeps working unchanged.
 */
const PublicHeader: React.FC<PublicHeaderProps> = ({
  onEmployeeLogin,
  currentPath = 'home',
  cartCount,
}) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const headerRef = React.useRef<HTMLElement>(null);

  // Close the mobile menu on Escape or a pointer-down outside the header.
  React.useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  // Logo / Home: when already on the homepage, scroll the page container to the
  // top. A same-route <Link to="/"> is otherwise a no-op when scrolled down.
  const goHome = (e: React.MouseEvent) => {
    setMenuOpen(false);
    if (window.location.pathname === '/') {
      e.preventDefault();
      if (window.location.hash) window.history.pushState(null, '', '/');
      (document.querySelector('.rcm-page') as HTMLElement | null)?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  };

  // Contact lives in a homepage section. From the homepage, smooth-scroll to it;
  // from any other public page, navigate home with the hash so PublicHome scrolls.
  const goToContact = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    if (window.location.pathname === '/') {
      if (window.location.hash !== '#contact') {
        window.history.pushState(null, '', '#contact');
      }
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate('/#contact');
    }
  };

  const cartLabel =
    cartCount != null && cartCount > 0 ? `Cart (${cartCount > 99 ? '99+' : cartCount})` : 'Cart';

  return (
    <header ref={headerRef} className="rcm-site hdr">
      <div className="hdr-in">
        <Link to="/" className="brand" onClick={goHome}>
          <span className="rcm-badger" aria-hidden="true" />
          <span className="wm">
            Rough Cut <span>Manufacturing</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Primary">
          <Link to="/shop" className={currentPath === 'shop' ? 'is-active' : undefined}>
            Products
          </Link>
          <a href="/#contact" onClick={goToContact}>
            Contact
          </a>
          {currentPath === 'shop' && (
            <Link to="/shop/cart" aria-label={`Cart, ${cartCount ?? 0} items`}>
              {cartLabel}
            </Link>
          )}
        </nav>

        <div className="hdr-cta">
          <button type="button" className="login" onClick={onEmployeeLogin}>
            Employee Login
          </button>
          <Link to="/quote" className="quote-btn">
            Request a Quote
          </Link>
          <button
            type="button"
            className="burger"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="rcm-mobile-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="mobile-menu" id="rcm-mobile-menu">
          <Link to="/shop" onClick={() => setMenuOpen(false)}>
            Products
          </Link>
          <a href="/#contact" onClick={goToContact}>
            Contact
          </a>
          {currentPath === 'shop' && (
            <Link to="/shop/cart" onClick={() => setMenuOpen(false)}>
              {cartLabel}
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onEmployeeLogin();
            }}
          >
            Employee Login
          </button>
          <Link to="/quote" className="mm-quote" onClick={() => setMenuOpen(false)}>
            Request a Quote
          </Link>
        </div>
      )}
    </header>
  );
};

export default PublicHeader;
