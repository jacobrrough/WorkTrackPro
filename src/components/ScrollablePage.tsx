import { forwardRef, type HTMLAttributes } from 'react';

type ScrollablePageProps = HTMLAttributes<HTMLDivElement>;

/**
 * A vertically-scrollable page region that always clears the fixed bottom navigation.
 *
 * Bakes in `content-above-nav` (safe-area-aware bottom padding so content never sits under the nav)
 * plus `flex-1 overflow-y-auto`. Compose this for any full-height scrolling screen that renders
 * alongside <BottomNavigation> instead of re-deriving — and occasionally forgetting — the
 * nav-clearance class. Forwards a ref and passes through div props (onScroll, etc.) for measurement
 * and scroll-position control; `className` is appended for padding/layout extras (callers should NOT
 * repeat `content-above-nav flex-1 overflow-y-auto`).
 *
 * Screens that aren't simple scroll containers (a centered flex layout, or a board with its own
 * internal scrolling) can keep applying the raw `content-above-nav` class directly.
 */
export const ScrollablePage = forwardRef<HTMLDivElement, ScrollablePageProps>(
  ({ children, className = '', ...rest }, ref) => (
    <div
      ref={ref}
      className={`content-above-nav flex-1 overflow-y-auto ${className}`.trimEnd()}
      {...rest}
    >
      {children}
    </div>
  )
);
ScrollablePage.displayName = 'ScrollablePage';
