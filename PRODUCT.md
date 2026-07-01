# Product

## Register

product

## Users

A fabrication shop (Rough Cut Manufacturing): admins running jobs, quotes, purchasing, and accounting from desk or tablet; shop-floor employees on phones — clocking in, scanning bins/parts, moving kanban cards, checking stock — often in bright light, sometimes with gloves. The public marketing surface (`.rcm-site`) is a separate register and out of scope here.

## Product Purpose

WorkTrackPro runs the shop: jobs and boards (kanban), inventory and parts, time clock and reports, quotes, deliveries, chat, and a full accounting module (QuickBooks-synced). Success = an employee finds and finishes the next task without thinking about the tool; an admin trusts the numbers.

## Brand Personality

Direction E: industrial, decisive, legible — with one hard caveat: **past login/MFA the app is user-themeable** (6 palettes × light/dark/system). Every design decision must hold in all palette × mode combinations, not just signal-red dark. Accent color carries meaning (current/primary/destructive), never decoration. Login/MFA chrome stays fixed Direction-E (`.rcm-site`).

## Anti-references

- Generic SaaS dashboard: cream/purple gradients, hero-metric cards, identical card grids, interchangeable admin-template chrome.
- Anything that breaks in a non-default palette or in light mode — hard-coded "dark-only" styling is the local anti-pattern.

## Design Principles

1. **Theme-agnostic by construction** — read `--c-*` tokens; `bg-overlay/N` not `bg-white/N`; verify in light + dark + a non-default palette.
2. **Color is semantics** — green success, amber caution, blue info, red overdue/rush/destructive; accent = "you are here / do this"; nothing rainbow.
3. **Shape lock** — surfaces 12–14px, controls 8px, pills/toggles full; consistency over novelty.
4. **Built for the floor** — ≥44px touch targets, high contrast in bright light, one-hand phone reach, fast over fancy (150–250ms, reduced-motion honored).
5. **Functional parity is sacred** — restyling never adds/removes behavior without asking.

## Accessibility & Inclusion

WCAG AA enforced: ≥4.5:1 body text (danger text uses `--c-danger-fg`, not the fill), visible focus (`:focus-visible` ring), `prefers-reduced-motion` collapse, semantic status colors paired with text (never color alone).
