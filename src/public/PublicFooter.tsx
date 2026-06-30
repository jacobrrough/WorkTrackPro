import React from 'react';
import { Link } from 'react-router-dom';
import './public.css';

/**
 * Shared public footer ("Direction E"). Multi-column on ≥tablet. Carries
 * `.rcm-site` for its own red auto-light/dark theme; surfaces the public legal
 * pages (Privacy, Terms) so they stay reachable across the public site.
 */
const PublicFooter: React.FC = () => {
  const year = new Date().getFullYear();

  // When already on the homepage, scroll the page container to the top instead
  // of letting a same-route <Link to="/"> no-op while scrolled at the footer.
  const goHome = (e: React.MouseEvent) => {
    if (window.location.pathname === '/') {
      e.preventDefault();
      if (window.location.hash) window.history.pushState(null, '', '/');
      (document.querySelector('.rcm-page') as HTMLElement | null)?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  };

  return (
    <footer className="rcm-site ft">
      <div className="ft-in">
        <div className="brandcol">
          <div className="wm">Rough Cut Manufacturing</div>
          <p>
            Protective products and precision parts, made to spec and tested on real production
            floors.
          </p>
        </div>
        <div className="col">
          <h4>Products</h4>
          <Link to="/shop">Shop</Link>
          <Link to="/shop">Protection</Link>
          <Link to="/shop">Foam inlays</Link>
          <Link to="/shop">CNC machining</Link>
        </div>
        <div className="col">
          <h4>Company</h4>
          <Link to="/quote">Request a Quote</Link>
          <Link to="/#contact">Contact</Link>
          <Link to="/" onClick={goHome}>
            Home
          </Link>
        </div>
        <div className="col">
          <h4>Legal</h4>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </div>
        <div className="legal">
          © {year} Rough Cut Manufacturing. Fabrication, foam, plastics, CNC, 3D printing, FOD
          protection.
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
