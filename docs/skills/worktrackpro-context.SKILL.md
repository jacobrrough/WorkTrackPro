---
name: worktrackpro-context
description: "Inject full WorkTrackPro project context and development rules into the session. ALWAYS use this skill immediately when the user types /wtpcontext or mentions loading WorkTrackPro context. Do not wait — read this file and apply all context and rules before responding to any follow-up task."
---

<!-- SOURCE OF TRUTH: docs/skills/worktrackpro-context.SKILL.md in the repo.
     Install / update your copy:  node scripts/sync-wtp-skill.mjs
       (renders live statuses/rates from your checkout, installs to ~/.claude/skills/)
     The AUTO:* regions below are filled from live code — do not hand-edit them. -->

# WorkTrackPro Project Context

## Project Overview

**WorkTrackPro** is a React 19 + TypeScript + Supabase PWA for a manufacturing shop floor.
- Workers clock in/out of jobs via PIN pad
- Admins manage jobs, inventory, parts, quotes, deliveries, Kanban boards, E2E encrypted chat, and a full double-entry **accounting** module (AR/AP)
- Deployed on Netlify at **roughcutmfg.com**
- Repo: **jacobrrough/WorkTrackPro**

## Where Code Lives (read before exploring)

This skill covers **domain concepts**. For **where code lives**, read `docs/CODE_MAP.md` —
a feature → file + symbol-anchor map. The big screens are 2k–4k lines (`JobDetail.tsx`,
`PartDetail.tsx`, `KanbanBoard.tsx`, accounting `types.ts`): **grep the listed anchor and
ranged-read ~150 lines — never read those files whole.** `AGENTS.md` has env, routes, and the
architecture summary; `docs/SYSTEM_MASTERY.md` is the DB/schema/RLS authority;
`docs/DOMAIN_RULES.md` has verified rates, security & inventory safeguards, and job invariants.

---

## ⚠️ Hard Rules — Never Violate These

- **Never merge PRs automatically** — PRs are merged manually by a human maintainer only
- **Never push to main directly**
- **Never create PRs** unless explicitly asked
- **Always run lint + Prettier after making changes**
- **Commit messages**: one line only — `fix(scope): short description` — no body, no co-author trailer
- **Branch**: Work in a dedicated worktree. **Never** name a branch with a `claude/` prefix — use a short, descriptive kebab-case name (e.g. `inventory-adjust-confirm`). Always pull latest main before starting.
- **Pre-existing TypeScript/ESLint warnings**: do not fix unless directly related to the current task
- **Service-role key**: only in `netlify/functions/`, never in `src/` / frontend
- **Schema changes**: write a migration in `supabase/migrations/` first (migrations auto-apply on merge)
- **UI changes**: follow the hybrid design system (§ Design System below) — kit for appearance, Tailwind for layout; verify in light + dark + one non-default palette

## Rates (defaults — admin-overridable in Settings)

<!-- AUTO:RATES -->
Labor $175/hr · CNC $150/hr · 3D-print $100/hr · material upcharge 1.25× · overtime 1.5× (defaults; admin-overridable in Settings)
<!-- /AUTO:RATES -->

## CI Pipeline

Runs on PRs targeting main: lint + Prettier (strict) + build + tests. CI must pass before merging.

---

## Users & Roles

| Role | Access |
|------|--------|
| Admin | Full access to all views |
| Worker | Job cards, clock-in, scanner only |

All users must be approved before accessing the app.

## Core Data Flow — **Parts → Jobs → Shifts**

- **Parts**: product catalogue (part number, revision, labor/CNC/3D estimates, BOM, optional variants)
- **Jobs**: work orders built from parts (status, qty, board type, assigned workers, bin, reference numbers, attachments, consumed inventory)
- **Shifts**: clock-in/out records logging actual labor against a job (optional lunch deduction)

## Jobs

- Link a part via `partId`/`partNumber`; multiple parts via `job_parts`.
- `dashQuantities` — how many of each variant suffix to build.
- `laborBreakdownByVariant`, `machineBreakdownByVariant` — planned hours keyed by dash suffix.
- `progressEstimatePercent` — admin override for the progress bar.
- **ECD is contract-reference only — automation never writes to ECD.**
- **Overdue** = `ecd`/`due_date` in the past AND status not complete (frontend calc, `isJobOverdue`).

### Job Statuses

<!-- AUTO:JOB_STATUSES -->
`pending` · `rush` · `inProgress` · `qualityControl` · `finished` · `delivered` · `onHold` · `toBeQuoted` · `quoted` · `rfqReceived` · `rfqSent` · `pod` · `waitingForPayment` · `projectCompleted` · `paid`
<!-- /AUTO:JOB_STATUSES -->

Terminal statuses (`finished`, `delivered`, `projectCompleted`, `paid`) auto-complete progress to 100%.

## Kanban Boards

| Board | Statuses shown |
|-------|----------------|
| Shop Floor | pending, inProgress, qualityControl, finished, delivered, onHold |
| Admin | Full lifecycle including quoting and payment statuses |

## Machine Hours (CNC & 3D Print)

- `machineBreakdownByVariant` is the **source of truth**; consumers read via `getMachineTotalsFromJob()`.
- Setting a bin location auto-marks CNC and 3D done if required and not yet marked.

## Progress Tracking

- 80% from production (labor + CNC + 3D hours), 20% reserved for QC.
- `qualityControl` = 80%; terminal statuses = 100%; `progressEstimatePercent` overrides when set.

## Inventory

Categories:

<!-- AUTO:INVENTORY_CATEGORIES -->
`material` · `foam` · `trimCord` · `printing3d` · `chemicals` · `hardware` · `miscSupplies` · `tool`
<!-- /AUTO:INVENTORY_CATEGORIES -->

Items track `inStock`, `available`, `disposed`, `onOrder` + reorder point + transaction history.
**Over-allocation guard:** a job cannot allocate more than `in_stock` (client `isAllocationActiveStatus`
+ Supabase trigger `job_inventory_allocate_guard`). **Needs reordering** = `available < minStock`.

## Quotes

Finds similar past jobs by name/description, aggregates actual labor + CNC hours + marked-up materials.
Markup percentage applied to subtotal.

## Accounting (AR/AP) — build-flagged, admin/accounting-role only

A full double-entry accounting module, gated behind `ACCOUNTING_BUILD_ENABLED`
(`src/features/accounting/`, entry `AccountingRouter` / `AccountingHome`). When the flag is off,
job billing pills and customer selects fall back to plain UI.

**Areas** (examples — not exhaustive; ~130 mutation hooks in `hooks/useAccountingMutations.ts`):
- **Ledger:** chart of accounts, journal entries (`draft → posted → void`), period lock
- **AR:** customers, estimates, invoices, payments, progress invoices, retainage
- **AP:** vendors, bills, vendor payments, purchase orders
- **Banking:** bank feeds, reconciliation, Plaid integration, bank rules
- **Costing:** FIFO inventory layers → job COGS (`inventoryFifo.ts`, `jobCosting.ts`)
- **Assets/planning:** fixed assets + depreciation, budgets, recurring templates, dimensions, custom fields, tax tables
- **Reports:** Trial Balance, P&L, Balance Sheet, Account Ledger, Cash Flow

**Invariants (do not break):** debits == credits; posted entries are immutable (void, never edit/delete);
no posting into a locked period; COGS recognized once via layer consumption. Full rules in
`src/features/accounting/CLAUDE.md`; types grouped in `types.ts`; posting math in `posting.ts`.

## Design System — HYBRID (Direction E)

The employee app (`/app/*`) uses a **hybrid** styling model — the owner-chosen endpoint,
NOT a transition state:

- **Appearance** (anything visual that repeats) lives in the semantic `.app-*` kit in
  `src/app/app.css`, scoped under `.app` on AppShell. **Layout** (flex/grid/gap/p-*/
  text-size/responsive) stays Tailwind utilities. Never add a new repeated appearance
  combo inline — extend the kit. Full Tailwind removal is explicitly not a goal.
- **Theming**: everything reads `--c-*` tokens (`src/index.css`). Appearance =
  palette (`data-theme`) × mode (`data-mode`): 6 palettes, each light + dark, mode
  defaults to System. Any UI change must hold in light AND dark AND a non-default palette.
- **Status colors are semantics**: green success / amber caution / blue info /
  red overdue-rush. Write them as the usual dark-tuned literals (`text-red-400` etc.) —
  a `[data-mode='light']` block in `index.css` auto-remaps them to legible 700/800 shades.
- **Hard styling rules**: `bg-overlay/N` never `bg-white/N`; `--c-danger` is fill-only
  (pair `text-on-danger`), danger text = `text-danger-fg`; shape lock — surfaces 12–14px,
  controls 8px, pills `rounded-full`; z-index only via the semantic scale
  (`z-nav/fab/header/overlay/dropdown/dialog/sheet/modal/picker/confirm/alert/toast`),
  never arbitrary `z-[N]`; **always-black surfaces** (camera scanner, lightbox) use
  `text-pure-white` — token `text-white`/`text-muted` flips dark in light mode.
- The public marketing surface (`.rcm-site`, `src/public/`) and login/MFA chrome are a
  separate fixed system — do not apply `.app-*` there or vice versa.
- Full map + extraction methodology: `docs/CODE_MAP.md` § "Design system".
  `tailwind.config.js` changes require a dev-server restart (no HMR).

---

## Other Views

- **Calendar**: job timelines with schedule risk + CNC/3D status tags
- **Project Hours**: admin **dev** time-tracking — logging development hours spent on the project (`src/features/time/ProjectHours`)
- **Time Reports**: labor by worker/job
- **Scanner**: barcode-based job lookup (always offer a manual SKU input too)
- **Trello Import**: ingests jobs from Trello exports (`src/TrelloImport.tsx`)
- **Deliveries**: tracks job delivery with packing slips

---

## How to Respond After Loading This Skill

1. Briefly acknowledge the WorkTrackPro context is loaded.
2. Re-read the hard rules before any coding work.
3. For locating code, consult `docs/CODE_MAP.md` first.
