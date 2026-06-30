import React, { useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';
import './public.css';

interface PublicHomeProps {
  onEmployeeLogin: () => void;
}

/** Capability tiles + a closing quote CTA (fills the 3-col grid evenly on desktop).
 *  Icons are inline SVG (no Material Symbols on public). */
const TILES: {
  label: string;
  href?: string;
  fill?: boolean;
  cta?: boolean;
  img?: { src: string; srcSet: string; alt: string };
  icon: React.ReactNode;
}[] = [
  {
    label: 'Custom fabricated protection',
    img: {
      src: '/tile-protection.webp',
      srcSet: '/tile-protection-440.webp 440w, /tile-protection.webp 880w',
      alt: 'Stacked custom red protective mats in the Rough Cut shop',
    },
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
      </svg>
    ),
  },
  {
    label: 'Foam inlays & packaging',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
      </svg>
    ),
  },
  {
    label: 'Shop-floor safety pads',
    fill: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M12 2v6m0 0l3-3m-3 3L9 5" />
        <rect x="4" y="12" width="16" height="9" rx="2" />
      </svg>
    ),
  },
  {
    label: 'Precision CNC machining',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
      </svg>
    ),
  },
  {
    label: '3D printing services',
    img: {
      src: '/tile-3dprint.webp',
      srcSet: '/tile-3dprint-440.webp 440w, /tile-3dprint.webp 880w',
      alt: 'Red 3D-printed brackets fresh off the printer bed',
    },
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
        <path d="M12 12l9-5M12 12v10M12 12L3 7" />
      </svg>
    ),
  },
  {
    label: 'Something else? Send us a quote',
    href: '/quote',
    cta: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
];

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const PublicHome: React.FC<PublicHomeProps> = ({ onEmployeeLogin }) => {
  const navigate = useNavigate();

  const navigateToSection = useCallback((hashValue: string) => {
    const sectionId = hashValue.replace(/^#/, '').trim();
    if (!sectionId) return;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Smooth-scroll anchors + back-compat for the old IDs the previous design used:
  //   #submit-proposal → the form now lives on /quote
  //   #services        → maps to the products section
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHash = () => {
      const hash = window.location.hash;
      if (!hash) return;
      if (hash === '#submit-proposal') {
        navigate('/quote', { replace: true });
        return;
      }
      navigateToSection(hash === '#services' ? '#products' : hash);
    };
    window.requestAnimationFrame(handleHash);
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [navigate, navigateToSection]);

  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
    navigateToSection(`#${id}`);
  };

  return (
    <div className="rcm-site rcm-page">
      <PublicHeader onEmployeeLogin={onEmployeeLogin} currentPath="home" />

      {/* HERO */}
      <section className="hero">
        <div className="h-in wrap">
          <span className="h-kick">Built for real production floors</span>
          <h1>Protective products and precision parts, made to spec.</h1>
          <p>
            Durable fabric, foam, and plastic protection, precision CNC, and 3D printing, all under
            one roof, with a heavy emphasis on FOD prevention.
          </p>
          <div className="h-cta">
            <Link to="/quote" className="btn btn-primary">
              Request a Quote
            </Link>
            <a href="#products" onClick={scrollTo('products')} className="btn btn-line">
              Explore Products
            </a>
          </div>
        </div>
      </section>

      {/* PRODUCTS */}
      <section className="sec" id="products">
        <div className="sec-head">
          <div className="ey">What we make</div>
          <h2>Five capabilities, built in-house.</h2>
          <p>
            From cut-to-fit foam to tight-tolerance machining, the whole job stays under one roof,
            so quality and timing stay in our hands.
          </p>
        </div>
        <div className="tiles">
          {TILES.map((tile) => (
            <Link
              key={tile.label}
              to={tile.href ?? '/shop'}
              className={`tile${tile.fill ? 'fill' : ''}${tile.cta ? 'cta' : ''}`}
            >
              <div className="pic">
                {tile.img ? (
                  <img
                    src={tile.img.src}
                    srcSet={tile.img.srcSet}
                    sizes="(min-width: 1024px) 360px, (min-width: 768px) 50vw, 100vw"
                    width={880}
                    height={550}
                    alt={tile.img.alt}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  tile.icon
                )}
              </div>
              <div className="lab">
                <b>{tile.label}</b>
                <span className="ar" aria-hidden="true">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* TRUST BAND */}
      <section className="trust">
        <div className="trust-in">
          <div className="trust-panel">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" strokeWidth="2.2" />
            </svg>
            <b>Checked before it ships</b>
            <span>FOD-first inspection on every job, materials to finishing.</span>
          </div>
          <div>
            <div className="ey">Why Rough Cut</div>
            <h2
              style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.15 }}
            >
              Built in-house, checked before it ships.
            </h2>
            <ul>
              <li>
                <Check /> Heavy emphasis on FOD prevention
              </li>
              <li>
                <Check /> One shop for fabric, foam, plastic, and metal
              </li>
              <li>
                <Check /> Quotes routed straight to our production board
              </li>
            </ul>
            <div className="stats">
              <div className="stat">
                <div className="n">1 roof</div>
                <div className="t">Materials to finishing</div>
              </div>
              <div className="stat">
                <div className="n">5</div>
                <div className="t">Core capabilities</div>
              </div>
              <div className="stat">
                <div className="n">FOD-first</div>
                <div className="t">On every job</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* QUOTE CTA */}
      <section className="qband">
        <div className="qband-in">
          <h2>Have a part to protect? Get a quote.</h2>
          <p>
            Send your drawings and requirements. It routes straight to our quoting board for review.
          </p>
          <Link to="/quote" className="btn btn-onaccent">
            Request a Quote
          </Link>
        </div>
      </section>

      {/* CONTACT */}
      <section className="sec contact" id="contact">
        <div className="sec-head">
          <div className="ey">Get in touch</div>
          <h2>Talk to the shop.</h2>
        </div>
        <div className="contact-in">
          <div className="row">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <div>
              <b>Phone</b>
              <a href="tel:+13128471928" style={{ color: 'inherit', textDecoration: 'none' }}>
                (312) 847-1928
              </a>
            </div>
          </div>
          <div className="row">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-10 6L2 7" />
            </svg>
            <div>
              <b>Email</b>
              <a
                href="mailto:quotes@roughcutmfg.com"
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                quotes@roughcutmfg.com
              </a>
            </div>
          </div>
          <div className="row">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div>
              <b>Shop</b>
              Open weekdays, by appointment
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};

export default PublicHome;
