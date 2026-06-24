import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared footer for the public website (home + shop). Surfaces the public legal
 * pages (Privacy Policy, Terms of Service) so they're reachable from the main site,
 * plus company identity. Dark theme to match the public pages.
 */
const PublicFooter: React.FC = () => {
  const year = new Date().getFullYear();
  const linkClass = 'text-muted transition-colors hover:text-primary';
  return (
    <footer className="border-t border-white/10 bg-app">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm sm:flex-row">
        <p className="text-muted">© {year} Rough Cut Manufacturing. All rights reserved.</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link to="/" className={linkClass}>
            Home
          </Link>
          <Link to="/shop" className={linkClass}>
            Shop
          </Link>
          <Link to="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          <Link to="/terms" className={linkClass}>
            Terms of Service
          </Link>
        </nav>
      </div>
    </footer>
  );
};

export default PublicFooter;
