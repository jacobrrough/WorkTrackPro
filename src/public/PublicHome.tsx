import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/services/api/supabaseClient';
import { fetchStoreParts, type StorePart } from '@/services/api/storefront';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';
import './PublicHome.css';

declare global {
  interface Window {
    turnstile?: {
      render: (selector: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

type UploadedProposalFile = {
  filename: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  publicUrl?: string;
};

interface PublicHomeProps {
  onEmployeeLogin: () => void;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB per file (common portal default)
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim();

const CAPABILITIES: { code: string; title: string; body: string }[] = [
  {
    code: 'F-01',
    title: 'Custom fabricated protection',
    body: 'Fabric, foam, and plastic products cut and assembled to spec — knee pads, part guards, paint protection, custom inlays.',
  },
  {
    code: 'F-02',
    title: 'Foam inlays & packaging',
    body: 'Precision-routed foam inlays and package protection that keep parts seated and damage-free through handling and transit.',
  },
  {
    code: 'M-03',
    title: 'Precision CNC machining',
    body: 'Tight-tolerance machined parts and fixtures, cut on the same floor that builds your protection.',
  },
  {
    code: 'P-04',
    title: '3D printing services',
    body: 'Rapid prototypes and low-volume production prints for jigs, fixtures, and custom geometry.',
  },
  {
    code: 'S-05',
    title: 'Shop-floor safety & ergonomics',
    body: 'Ergonomic pads and floor protection built to survive daily production abuse — not catalog fluff.',
  },
  {
    code: 'FOD-06',
    title: 'FOD prevention systems',
    body: 'Foreign-object-debris controls engineered to keep your line clean, audited, and compliant.',
  },
];

const PROCESS: { step: string; title: string; body: string }[] = [
  {
    step: '01',
    title: 'Submit your spec',
    body: 'Drawings, materials, quantities, and FOD requirements — straight from the form below or the shop.',
  },
  {
    step: '02',
    title: 'We quote it',
    body: 'Your request lands on our quoting board as Needs Quote for immediate review. No black-hole inboxes.',
  },
  {
    step: '03',
    title: 'We build & ship',
    body: 'Cut, machined, printed, and protected — ready for your production floor.',
  },
];

function featuredPriceLabel(part: StorePart): string {
  const prices = part.variants
    .map((v) => v.pricePerVariant)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const min = prices.length > 0 ? Math.min(...prices) : part.pricePerSet;
  if (min == null || !Number.isFinite(min)) return 'Price on request';
  const multiple = prices.length > 1 || (part.variants.length > 1 && prices.length >= 1);
  return `${multiple ? 'From ' : ''}$${min.toFixed(2)}`;
}

const PublicHome: React.FC<PublicHomeProps> = ({ onEmployeeLogin }) => {
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [featured, setFeatured] = useState<StorePart[]>([]);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Respect reduced motion from first paint so SMIL/decorative motion never mounts,
  // and keep it in sync if the user toggles the OS setting while the page is open.
  const [motionOK, setMotionOK] = useState(
    () =>
      typeof window === 'undefined' ||
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setMotionOK(!mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Prefill proposal description from store "Request quote" link (?product= & ?variant=)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const product = params.get('product')?.trim();
    if (!product) return;
    const variant = params.get('variant')?.trim();
    const prefill = variant
      ? `Requesting quote for product: ${product}-${variant}`
      : `Requesting quote for product: ${product}`;
    setDescription((prev) => (prev.trim() ? prev : prefill));
  }, []);

  // Surface live store parts on the landing page (wiring mirrors /shop).
  useEffect(() => {
    let active = true;
    fetchStoreParts()
      .then((parts) => {
        if (active) setFeatured(parts.slice(0, 6));
      })
      .catch(() => {
        /* non-fatal: landing still works without featured parts */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    const ensureWidget = () => {
      if (!window.turnstile || !turnstileContainerRef.current) return;
      if (turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
        theme: 'dark',
      });
    };

    if (window.turnstile) {
      ensureWidget();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = ensureWidget;
    document.head.appendChild(script);

    return () => {
      script.remove();
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
      }
    };
  }, []);

  const sanitizeFileName = (input: string) => input.replace(/[^a-zA-Z0-9._-]/g, '_');

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const merged = [...files, ...selected].slice(0, MAX_FILES);
    setFiles(merged);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const uploadFiles = async (submissionId: string): Promise<UploadedProposalFile[]> => {
    const uploaded: UploadedProposalFile[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`"${file.name}" is larger than 25 MB.`);
      }

      const filePath = `${submissionId}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error } = await supabase.storage.from('customer-proposals').upload(filePath, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (error) throw new Error(`Failed to upload "${file.name}": ${error.message}`);

      const { data } = supabase.storage.from('customer-proposals').getPublicUrl(filePath);
      uploaded.push({
        filename: file.name,
        storagePath: filePath,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        publicUrl: data.publicUrl,
      });
    }

    return uploaded;
  };

  const navigateToSection = useCallback((hashValue: string) => {
    if (typeof window === 'undefined') return;
    const sectionId = hashValue.replace(/^#/, '').trim();
    if (!sectionId) return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Anchor CTAs scroll within the page's own scroll container (keeps hash in sync).
  const handleAnchorClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      const href = event.currentTarget.getAttribute('href') ?? '';
      if (!href.startsWith('#')) return;
      event.preventDefault();
      if (window.location.hash !== href) {
        window.history.pushState(null, '', href);
      }
      navigateToSection(href);
    },
    [navigateToSection]
  );

  // From a featured product: prefill the proposal form and jump to it (mirrors ?product=).
  const requestQuoteForPart = useCallback(
    (part: StorePart) => {
      const label = part.name ? `${part.partNumber} — ${part.name}` : part.partNumber;
      setDescription((prev) => (prev.trim() ? prev : `Requesting quote for product: ${label}`));
      navigateToSection('#submit-proposal');
    },
    [navigateToSection]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash) {
      window.requestAnimationFrame(() => navigateToSection(window.location.hash));
    }
    const onHashChange = () => navigateToSection(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigateToSection]);

  // Arm scroll reveals + toolpath draws. Base state ships fully visible; arming
  // (which hides reveal targets) happens pre-paint via useLayoutEffect so no-JS /
  // headless renders stay visible, and a failsafe reveals everything if the
  // observer never fires (hidden tab, etc).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return;
    if (!motionOK || !('IntersectionObserver' in window)) return;

    root.classList.add('rcm-armed');
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.rcm-reveal, .rcm-toolpath'));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { root, rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    targets.forEach((el) => observer.observe(el));

    const failsafe = window.setTimeout(() => {
      targets.forEach((el) => el.classList.add('is-visible'));
    }, 1500);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [motionOK, featured.length]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!contactName.trim() || !email.trim() || !phone.trim() || !description.trim()) {
      setErrorMessage('Please complete all required fields.');
      return;
    }
    if (files.length > MAX_FILES) {
      setErrorMessage(`Please upload no more than ${MAX_FILES} files.`);
      return;
    }
    if (!TURNSTILE_SITE_KEY) {
      setErrorMessage('Turnstile is not configured. Add VITE_TURNSTILE_SITE_KEY to continue.');
      return;
    }
    if (!turnstileToken) {
      setErrorMessage('Please complete the anti-spam check.');
      return;
    }

    setIsSubmitting(true);
    try {
      const submissionId = crypto.randomUUID();
      const uploadedFiles = await uploadFiles(submissionId);

      const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string) || '';
      const response = await fetch(`${apiOrigin}/api/submit-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          description: description.trim(),
          turnstileToken,
          files: uploadedFiles,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        warnings?: string[];
        warningDetails?: string[];
        emailQueue?: {
          admin?: { id: string; status: number; lastEvent?: string | null } | null;
          customer?: { id: string; status: number; lastEvent?: string | null } | null;
        };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Failed to submit proposal.');
      }

      const emailWarnings = payload?.warnings ?? [];
      const warningDetails = payload?.warningDetails ?? [];
      const customerLastEvent = payload?.emailQueue?.customer?.lastEvent ?? null;
      const customerFailed =
        customerLastEvent != null &&
        ['bounced', 'failed', 'suppressed', 'complained', 'canceled'].includes(
          customerLastEvent.toLowerCase()
        );
      if (customerFailed && !emailWarnings.includes('customer_email_failed')) {
        emailWarnings.push('customer_email_failed');
      }
      const queuedAdmin = payload?.emailQueue?.admin?.id ? 'admin' : null;
      const queuedCustomer = payload?.emailQueue?.customer?.id ? 'customer' : null;
      const queuedTargets = [queuedAdmin, queuedCustomer].filter(Boolean);
      if (emailWarnings.length > 0) {
        const detailsText = warningDetails.length > 0 ? ` ${warningDetails.join(' ')}` : '';
        setSuccessMessage(
          `Proposal submitted and routed to quoting, but one or more email notifications failed.${detailsText}`
        );
      } else {
        setSuccessMessage(
          queuedTargets.length > 0
            ? `Proposal submitted and email notification queued (${queuedTargets.join(' + ')}).`
            : 'Proposal submitted and routed to quoting.'
        );
      }
      setContactName('');
      setEmail('');
      setPhone('');
      setDescription('');
      setFiles([]);
      setTurnstileToken('');
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit proposal.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-sm border border-line bg-app/60 px-3 py-2.5 text-white placeholder:text-subtle transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/60';

  return (
    <div
      ref={rootRef}
      className="rcm-landing max-h-[100dvh] min-h-[100dvh] overflow-y-auto overscroll-y-contain bg-app text-white"
    >
      <a href="#main-content" className="rcm-skip-link">
        Skip to content
      </a>

      <PublicHeader onEmployeeLogin={onEmployeeLogin} currentPath="home" />

      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        {/* ===== HERO ===== */}
        <section
          id="services"
          className="relative scroll-mt-24 overflow-hidden border-b border-white/10"
        >
          <div className="rcm-grid-bg" aria-hidden="true" />
          <div className="rcm-glow" aria-hidden="true" />
          <div className="rcm-hazard h-1.5 w-full opacity-80" aria-hidden="true" />

          <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 px-4 py-[clamp(3rem,1rem+6vw,7rem)] sm:gap-10 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7">
              {/* Full brand name — prominent on first load (mobile; desktop shows it in the header) */}
              <p className="rcm-reveal mb-5 text-[clamp(1.5rem,5vw,1.875rem)] font-black leading-none tracking-tight text-white sm:hidden">
                Rough Cut <span className="text-primary">Manufacturing</span>
              </p>
              <p className="rcm-reveal hidden font-mono text-[11px] uppercase tracking-[0.28em] text-primary sm:block">
                Fabrication · Foam · Plastics · CNC · 3D · FOD
              </p>
              <h1 className="rcm-reveal text-balance text-[clamp(1.875rem,1rem+4vw,3.75rem)] font-black leading-[1.05] tracking-tight text-white sm:mt-5">
                Tough protection products, <span className="text-primary">machined and built</span>{' '}
                for real production floors.
              </h1>
              <p className="rcm-reveal mt-4 max-w-[65ch] text-pretty text-[clamp(1rem,0.95rem+0.3vw,1.125rem)] leading-relaxed text-muted sm:mt-6">
                Durable fabric, foam, and plastic protection built to survive demanding work —
                engineered with a hard focus on FOD prevention.
              </p>

              <div className="rcm-reveal mt-7 flex flex-wrap gap-3 sm:mt-8">
                <a
                  href="#submit-proposal"
                  onClick={handleAnchorClick}
                  className="inline-flex min-h-[48px] flex-1 touch-manipulation items-center justify-center gap-2 rounded-sm bg-primary px-6 py-3 text-sm font-bold text-on-accent shadow-lg shadow-primary/25 transition-colors hover:bg-primary-hover sm:flex-none sm:justify-start"
                >
                  Get a quote
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">
                    arrow_forward
                  </span>
                </a>
                <Link
                  to="/shop"
                  className="hidden min-h-[48px] touch-manipulation items-center gap-2 rounded-sm border border-line-strong bg-white/5 px-6 py-3 text-sm font-bold text-white transition-colors hover:border-primary/60 hover:bg-primary/10 sm:inline-flex"
                >
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">
                    storefront
                  </span>
                  Browse the shop
                </Link>
              </div>

              <ul className="rcm-reveal rcm-chip-strip mt-7 hidden gap-2 overflow-x-auto sm:mt-8 sm:flex sm:flex-wrap">
                {[
                  'Knee pads',
                  'Custom inlays',
                  'Part protection',
                  'Paint protection',
                  'FOD controls',
                  'Precision CNC',
                  '3D printing',
                ].map((item) => (
                  <li
                    key={item}
                    className="shrink-0 whitespace-nowrap rounded-sm border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs text-white"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Blueprint panel — the right column of the two-column hero, so it only
                appears at lg where that layout exists (hidden on mobile + tablet). */}
            <div className="rcm-reveal hidden lg:col-span-5 lg:block">
              <div className="rcm-regmark rcm-frame relative overflow-hidden rounded-sm border border-line-strong bg-black/40 p-3 sm:p-4">
                <div className="rcm-scanline" aria-hidden="true" />
                <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-subtle sm:mb-3">
                  <span>RCM · DWG-0042</span>
                  <span className="text-primary">FOD ✓</span>
                </div>
                <svg
                  className="rcm-toolpath relative w-full"
                  viewBox="0 0 420 224"
                  fill="none"
                  role="img"
                  aria-label="CNC blueprint of a protective part: rounded outline, mounting holes, and a serpentine machining toolpath."
                >
                  {/* Part outline */}
                  <path
                    data-draw
                    pathLength={1}
                    d="M 60 26 H 360 Q 382 26 382 48 V 148 Q 382 170 360 170 H 60 Q 38 170 38 148 V 48 Q 38 26 60 26 Z"
                    stroke="rgb(var(--c-accent))"
                    strokeWidth={2}
                  />
                  {/* Mounting holes */}
                  <circle
                    data-draw
                    pathLength={1}
                    cx={88}
                    cy={62}
                    r={13}
                    stroke="rgb(var(--c-accent) / 0.85)"
                    strokeWidth={1.5}
                  />
                  <circle
                    data-draw
                    pathLength={1}
                    cx={332}
                    cy={134}
                    r={13}
                    stroke="rgb(var(--c-accent) / 0.85)"
                    strokeWidth={1.5}
                  />
                  {/* Serpentine CNC toolpath (the cutter follows this) */}
                  <path
                    id="rcm-cutpath"
                    data-draw-2
                    pathLength={1}
                    d="M 70 92 H 350 V 110 H 70 V 128 H 350"
                    stroke="rgb(var(--c-accent) / 0.55)"
                    strokeWidth={1.25}
                    strokeDasharray="1 6"
                  />
                  {/* Dimension lines + annotations */}
                  <g className="rcm-anno" stroke="rgb(var(--c-text-subtle) / 0.7)" strokeWidth={1}>
                    <path d="M 38 196 H 382" />
                    <path d="M 38 190 V 202" />
                    <path d="M 382 190 V 202" />
                  </g>
                  <g
                    className="rcm-anno"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill="rgb(var(--c-text-muted))"
                    fontSize={11}
                  >
                    <text x={210} y={214} textAnchor="middle">
                      312.00 mm
                    </text>
                    <text x={88} y={154} textAnchor="middle">
                      Ø30
                    </text>
                    <text x={332} y={162} textAnchor="middle">
                      Ø30
                    </text>
                    <text x={344} y={46} textAnchor="end" fill="rgb(var(--c-accent))">
                      MAT: EVA-45
                    </text>
                  </g>
                  {/* Cutter spark traveling the toolpath (skipped under reduced motion) */}
                  {motionOK && (
                    <circle r={3.5} fill="rgb(var(--c-accent))" className="rcm-spark">
                      <animateMotion dur="4.5s" repeatCount="indefinite" rotate="auto">
                        <mpath href="#rcm-cutpath" />
                      </animateMotion>
                    </circle>
                  )}
                </svg>
                <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                  <span>TOL ±0.1</span>
                  <span>REV C</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== CAPABILITIES — spec sheet ===== */}
        <section className="relative border-b border-white/10 bg-app">
          <div className="mx-auto w-full max-w-6xl px-4 py-[clamp(3rem,7vw,5rem)]">
            <div className="rcm-reveal max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
                Capability sheet
              </p>
              <h2 className="mt-3 text-balance text-[clamp(1.5rem,1rem+2.2vw,2.25rem)] font-bold tracking-tight text-white">
                What we make on the floor
              </h2>
              <p className="mt-4 text-pretty text-muted">
                One shop, end to end — fabricated protection, machined parts, and printed fixtures,
                all built to take a beating.
              </p>
            </div>

            <div className="rcm-spec-grid mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-px overflow-hidden rounded-sm border border-line-strong">
              {CAPABILITIES.map((cap) => (
                <div
                  key={cap.code}
                  className="rcm-cell rcm-reveal flex items-baseline gap-4 bg-app p-5 sm:p-6"
                >
                  <span className="rcm-cell-code w-12 shrink-0 font-mono text-xs font-semibold tracking-wider text-primary transition-colors">
                    {cap.code}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-white">{cap.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{cap.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== FOD FOCUS ===== */}
        <section className="relative overflow-hidden border-b border-white/10 bg-surface">
          <div
            className="rcm-hazard absolute inset-y-0 left-0 w-1.5 opacity-70"
            aria-hidden="true"
          />
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-[clamp(3rem,7vw,5rem)] lg:grid-cols-2 lg:items-center lg:gap-12">
            <div className="rcm-reveal">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
                FOD-first by default
              </p>
              <h2 className="mt-3 text-balance text-[clamp(1.5rem,1rem+2.2vw,2.25rem)] font-bold tracking-tight text-white">
                Foreign object debris is a defect. We engineer it out.
              </h2>
              <p className="mt-5 text-pretty leading-relaxed text-muted">
                On a real production floor, a stray fastener or a loose chip isn't a nuisance — it's
                a scrapped part or a failed audit. Every product we build is designed to keep your
                line clean, contained, and inspection-ready, from foam inlays that seat parts to
                guards that keep debris off critical surfaces.
              </p>
            </div>

            <dl className="rcm-reveal divide-y divide-line border border-line-strong bg-app/50">
              {[
                {
                  k: 'Built on the floor, not in a catalog',
                  v: 'Designs come from people who run the machines — fit, durability, and ergonomics proven in production, not on a spec sheet.',
                },
                {
                  k: 'Contained by design',
                  v: 'Inlays, guards, and protection sized to your parts so debris has nowhere to go and nothing walks off the line.',
                },
                {
                  k: 'Quotes at production speed',
                  v: 'Proposals route straight to our quoting board as Needs Quote — no black-hole inbox, no week-long wait.',
                },
              ].map((row) => (
                <div key={row.k} className="grid gap-1 p-5 sm:grid-cols-[1.1fr_1.4fr] sm:gap-6">
                  <dt className="font-semibold text-white">{row.k}</dt>
                  <dd className="text-sm leading-relaxed text-muted">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ===== FEATURED PRODUCTS (live) ===== */}
        {featured.length > 0 && (
          <section className="relative border-b border-white/10 bg-app">
            <div className="mx-auto w-full max-w-6xl px-4 py-[clamp(3rem,7vw,5rem)]">
              <div className="rcm-reveal flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
                    From the shop
                  </p>
                  <h2 className="mt-3 text-balance text-[clamp(1.5rem,1rem+2.2vw,2.25rem)] font-bold tracking-tight text-white">
                    In stock and ready to quote
                  </h2>
                </div>
                <Link
                  to="/shop"
                  className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 rounded-sm border border-line-strong bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-primary/60 hover:bg-primary/10"
                >
                  View all
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">
                    arrow_forward
                  </span>
                </Link>
              </div>

              <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-4">
                {featured.map((part) => {
                  const image = part.productImages[0];
                  return (
                    <article
                      key={part.id}
                      className="rcm-reveal flex flex-col overflow-hidden rounded-sm border border-line bg-white/5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/20"
                    >
                      <Link
                        to={`/shop/${part.id}`}
                        className="aspect-square w-full bg-black/30 focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {image ? (
                          <img
                            src={image.url}
                            alt={part.name}
                            loading="lazy"
                            className="h-full w-full object-contain p-3"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-subtle">
                            <span className="material-symbols-outlined text-5xl" aria-hidden="true">
                              precision_manufacturing
                            </span>
                          </div>
                        )}
                      </Link>
                      <div className="flex flex-1 flex-col p-4">
                        <Link
                          to={`/shop/${part.id}`}
                          className="font-mono text-xs font-semibold text-primary hover:underline"
                        >
                          {part.partNumber}
                        </Link>
                        <Link
                          to={`/shop/${part.id}`}
                          className="mt-1 text-base font-semibold text-white hover:underline"
                        >
                          {part.name}
                        </Link>
                        {part.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted">{part.description}</p>
                        )}
                        <p className="mt-2 text-sm text-muted">{featuredPriceLabel(part)}</p>
                        <div className="mt-4 flex gap-2">
                          <Link
                            to={`/shop/${part.id}`}
                            className="flex min-h-[44px] flex-1 touch-manipulation items-center justify-center rounded-sm border border-line-strong bg-white/5 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => requestQuoteForPart(part)}
                            className="flex min-h-[44px] flex-1 touch-manipulation items-center justify-center rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-hover"
                          >
                            Request quote
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ===== PROCESS (a real sequence) ===== */}
        <section className="relative border-b border-white/10 bg-app">
          <div className="mx-auto w-full max-w-6xl px-4 py-[clamp(3rem,7vw,5rem)]">
            <div className="rcm-reveal max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
                From spec to shipped
              </p>
              <h2 className="mt-3 text-balance text-[clamp(1.5rem,1rem+2.2vw,2.25rem)] font-bold tracking-tight text-white">
                Three steps, no runaround
              </h2>
            </div>

            <ol className="mt-10 grid gap-px overflow-hidden rounded-sm border border-line-strong bg-line/60 md:grid-cols-3">
              {PROCESS.map((proc) => (
                <li
                  key={proc.step}
                  className="rcm-cell rcm-reveal flex items-start gap-4 bg-app p-5 sm:p-6 md:block"
                >
                  <span className="shrink-0 font-mono text-3xl font-black leading-none text-primary/80 md:mb-3 md:block">
                    {proc.step}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-white">{proc.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{proc.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ===== SUBMIT PROPOSAL (wiring preserved) ===== */}
        <section id="submit-proposal" className="relative scroll-mt-24 overflow-hidden bg-app">
          <div className="rcm-grid-bg opacity-60" aria-hidden="true" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-[clamp(3rem,7vw,5rem)] lg:grid-cols-12 lg:gap-12">
            <div className="rcm-reveal lg:col-span-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-primary">
                Work order
              </p>
              <h2 className="mt-3 text-balance text-[clamp(1.5rem,1rem+2.2vw,2.25rem)] font-bold tracking-tight text-white">
                Submit a proposal
              </h2>
              <p className="mt-4 text-pretty leading-relaxed text-muted">
                Send your spec and paperwork. It goes straight to our admin quoting board as{' '}
                <span className="font-semibold text-white">Needs Quote</span> for immediate review —
                attach drawings, quantities, materials, and any FOD requirements.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-muted">
                {[
                  'Drawings & CAD',
                  'Quantities & timing',
                  'Material specs',
                  'FOD requirements',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span
                      className="material-symbols-outlined text-base text-primary"
                      aria-hidden="true"
                    >
                      check
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rcm-reveal lg:col-span-8">
              <div className="rcm-regmark rcm-frame relative rounded-sm border border-line-strong bg-surface p-6 sm:p-8">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1.5 block font-medium text-white">Contact name *</span>
                      <input
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        className={inputClass}
                        required
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1.5 block font-medium text-white">Email *</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        required
                      />
                    </label>
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1.5 block font-medium text-white">Phone *</span>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={inputClass}
                        required
                      />
                    </label>
                  </div>

                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-white">
                      Proposal description *
                    </span>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={6}
                      className={inputClass}
                      placeholder="Tell us what you need, materials, quantities, FOD requirements, and any timing details."
                      required
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-white">
                      Upload paperwork (up to {MAX_FILES} files,{' '}
                      {Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)}
                      MB each)
                    </span>
                    <input
                      type="file"
                      multiple
                      accept="*/*"
                      onChange={handleFileSelection}
                      className="block w-full rounded-sm border border-line bg-app/60 px-3 py-2.5 text-white file:mr-3 file:rounded-sm file:border-0 file:bg-primary/20 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-primary/30"
                    />
                  </label>

                  {files.length > 0 && (
                    <ul className="space-y-2 rounded-sm border border-line bg-app/40 p-3 text-sm">
                      {files.map((file, idx) => (
                        <li
                          key={`${file.name}-${idx}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate text-white">
                            {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(idx)}
                            className="rounded-sm border border-red-500/40 px-2 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/20"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div ref={turnstileContainerRef} className="min-h-[64px]" />

                  {errorMessage && (
                    <p className="rounded-sm border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-200">
                      {errorMessage}
                    </p>
                  )}
                  {successMessage && (
                    <p className="rounded-sm border border-green-500/40 bg-green-500/15 px-3 py-2 text-sm text-green-200">
                      {successMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-sm bg-primary px-5 py-3 text-sm font-bold text-on-accent shadow-lg shadow-primary/25 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {isSubmitting ? 'Submitting…' : 'Submit Proposal'}
                    {!isSubmitting && (
                      <span className="material-symbols-outlined text-lg" aria-hidden="true">
                        arrow_forward
                      </span>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
};

export default PublicHome;
