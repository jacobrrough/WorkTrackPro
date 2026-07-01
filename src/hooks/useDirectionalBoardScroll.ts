import { useEffect, type RefObject } from 'react';

const AXIS_LOCK_THRESHOLD = 8; // px of movement before we commit to an axis

/**
 * Lets a horizontally-scrolling board respond to touch swipes anywhere on the
 * board — not just over the non-scrolling column header strip.
 *
 * The problem: each column body is its own vertical scroller. Once a finger
 * starts dragging over a column, browsers axis-lock to that column and
 * cross-axis scroll-chaining to the horizontal board is unreliable (especially
 * iPadOS Safari). The practical symptom is "I can only scroll left/right by
 * grabbing the headers" — the one band that isn't a vertical scroller.
 *
 * The fix: watch single-finger gestures on the board, lock to the dominant axis
 * on the first significant move, and route by intent:
 *   - horizontal swipe → drive board.scrollLeft and preventDefault so the column
 *     underneath doesn't also scroll
 *   - vertical swipe   → do nothing; native column scrolling handles it
 *
 * Only acts on immediate finger drags, so it coexists with long-press card drag
 * (dnd-kit TouchSensor uses a press delay) and HTML5 drag-and-drop (fine pointer
 * only). Pass `enabled = false` on phone-width layouts where one-column snap
 * swiping is the intended behavior.
 */
export function useDirectionalBoardScroll(
  boardRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;
    const board = boardRef.current;
    if (!board) return;

    let activeId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let axis: 'x' | 'y' | null = null;

    const reset = () => {
      activeId = null;
      axis = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      // Single-finger drags only; leave pinch-zoom and other multitouch alone.
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      const t = e.touches[0];
      activeId = t.identifier;
      startX = t.clientX;
      startY = t.clientY;
      startScrollLeft = board.scrollLeft;
      axis = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (activeId === null) return;
      const t = Array.from(e.touches).find((touch) => touch.identifier === activeId);
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (axis === null) {
        if (Math.abs(dx) < AXIS_LOCK_THRESHOLD && Math.abs(dy) < AXIS_LOCK_THRESHOLD) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }

      if (axis === 'x') {
        board.scrollLeft = startScrollLeft - dx;
        // Suppress the column's own vertical scroll (and the tap that would open a card).
        if (e.cancelable) e.preventDefault();
      }
    };

    board.addEventListener('touchstart', onTouchStart, { passive: true });
    // Non-passive: we preventDefault once a horizontal swipe is locked in.
    board.addEventListener('touchmove', onTouchMove, { passive: false });
    board.addEventListener('touchend', reset, { passive: true });
    board.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      board.removeEventListener('touchstart', onTouchStart);
      board.removeEventListener('touchmove', onTouchMove);
      board.removeEventListener('touchend', reset);
      board.removeEventListener('touchcancel', reset);
    };
  }, [boardRef, enabled]);
}
