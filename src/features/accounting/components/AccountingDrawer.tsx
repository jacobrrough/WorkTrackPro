import { useEffect, useRef, type ReactNode } from 'react';

interface AccountingDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional sticky footer (e.g. Cancel / Save buttons). */
  footer?: ReactNode;
  /** Desktop panel width; mobile is always full-width. */
  width?: 'md' | 'lg';
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A right-side slide-over (drawer) in the accounting dark theme — the QuickBooks-style
 * replacement for center-screen modals. Full-width on mobile, a max-width panel on >= sm.
 * Handles ESC-to-close, click-outside (mousedown on the backdrop only, so a drag that ends
 * outside the panel doesn't close it), body scroll-lock, a focus trap, and focus restore to the
 * trigger on close. Renders nothing when closed.
 */
export function AccountingDrawer({
  open,
  onClose,
  title,
  footer,
  width = 'md',
  children,
}: AccountingDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel container itself, so a screen reader announces the dialog and the first
    // Tab lands on the first field (rather than starting on the close button). The trap keeps
    // focus inside.
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Re-query each Tab so the trap follows DOM changes (e.g. a form swapping to a
      // success state) rather than a stale snapshot.
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      trigger?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in justify-end bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex h-full w-full animate-slide-in-right flex-col border-l border-white/10 bg-card-dark shadow-xl focus:outline-none ${
          width === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-white/10 p-4">{footer}</div>}
      </div>
    </div>
  );
}
