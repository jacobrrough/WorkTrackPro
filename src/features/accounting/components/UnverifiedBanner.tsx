/**
 * ⚠️  HELD / UNVERIFIED — NOT FOR FILING.
 *
 * The single, prominent, unmissable banner required on EVERY screen, report, and export of
 * a HELD / flag-dark accounting module (import/migration, notification delivery, document
 * management, payroll, security hardening). It declares that the module is FLAG-DARK and
 * UNVERIFIED and that a CPA and/or security sign-off is required before it is enabled.
 *
 * The body is MODULE-AGNOSTIC by default — just the sign-off line. Each caller supplies its
 * own module-specific context via the `detail` prop (e.g. import: "…opening balances
 * reconcile to the source trial balance"; documents: "stored unencrypted"; payroll: the
 * tax-table caveat). A caller may also override the default sign-off line via the `body`
 * prop. It is intentionally louder than the advisory `TaxDisclaimer` (G9) — red, full-width,
 * with a warning glyph.
 *
 * Variants:
 *   • 'banner' (default) — the full screen banner. Use at the top of every held-module screen.
 *   • 'compact'          — a slim inline strip for dense surfaces (dialogs, preview/export
 *                          headers). Renders the headline + `detail` only (no body).
 *   • 'print'            — a high-contrast, print-safe block for PDF/HTML exports so the
 *                          warning survives onto paper.
 */
type UnverifiedBannerVariant = 'banner' | 'compact' | 'print';

interface UnverifiedBannerProps {
  variant?: UnverifiedBannerVariant;
  className?: string;
  /**
   * The module-agnostic sign-off line shown in the 'banner' and 'print' variants.
   * Defaults to the generic sign-off; override only when a module needs different wording.
   */
  body?: string;
  /** Optional module-specific context appended under the headline/body (e.g. the current step or caveat). */
  detail?: string;
}

const HEADLINE = 'UNVERIFIED — NOT FOR FILING';
const DEFAULT_BODY = 'Requires CPA and/or security sign-off before this module is enabled.';

export function UnverifiedBanner({
  variant = 'banner',
  className = '',
  body = DEFAULT_BODY,
  detail,
}: UnverifiedBannerProps) {
  if (variant === 'print') {
    // High-contrast block intended to render in an export (light background / dark ink).
    return (
      <div
        className={`border-2 border-red-700 bg-red-100 p-3 text-red-900 ${className}`}
        role="alert"
        data-testid="unverified-banner"
      >
        <p className="text-sm font-extrabold uppercase tracking-wide">{HEADLINE}</p>
        <p className="mt-1 text-xs font-semibold">{body}</p>
        {detail && <p className="mt-1 text-xs">{detail}</p>}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-2 rounded-sm border border-red-500/50 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300 ${className}`}
        role="alert"
        data-testid="unverified-banner"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          warning
        </span>
        <span className="uppercase tracking-wide">{HEADLINE}</span>
        {detail && <span className="font-semibold normal-case text-red-200">· {detail}</span>}
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-sm border-2 border-red-500/60 bg-red-500/15 p-4 text-red-200 ${className}`}
      role="alert"
      data-testid="unverified-banner"
    >
      <span className="material-symbols-outlined mt-0.5 text-2xl text-red-400" aria-hidden="true">
        gpp_maybe
      </span>
      <div className="min-w-0">
        <p className="text-sm font-extrabold uppercase tracking-wide text-red-300">{HEADLINE}</p>
        <p className="mt-1 text-xs leading-relaxed text-red-200/90">{body}</p>
        {detail && <p className="mt-1 text-xs font-semibold text-red-100">{detail}</p>}
      </div>
    </div>
  );
}
