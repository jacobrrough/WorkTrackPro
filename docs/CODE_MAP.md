# CODE_MAP.md — where things live (read this before exploring)

**Purpose:** cut the "find the right file" phase. This is a routing map, not documentation —
it tells you *which file + which anchor* holds a feature so you read ~400 relevant lines
instead of grepping blind or reading a 4,000-line file whole.

## Cardinal rule for the big files

Several files are 2k–4k lines. **Never read them whole.** Find the listed anchor (a symbol
name) and do a ranged read around it:

```
grep -n "handleAutoAssignMaterials" src/JobDetail.tsx   # get the current line
# then read ~150 lines around it
```

Anchors are **symbol names, never line numbers** — line numbers drift, `grep` stays accurate.

---

## Data layer — `src/services/api/`

| Concern | File | Anchor |
|---|---|---|
| Jobs CRUD, status, BOM/labor, part linking | `services/api/jobs.ts` | `jobService` object (grep method name, e.g. `update`, `create`, `linkPart`) |
| Parts / variants / materials / quote calc | `services/api/parts.ts` | `partsService` object |
| Accounting row↔domain mapping | `services/api/accounting/mappers.ts` | grep the entity name (`mapInvoice`, `mapPayment`, …) |
| PostgREST schema-cache staleness handling | `services/api/schemaCompat.ts` | column stripping / client healing |

## State / contexts — `src/`

| Concern | Anchor |
|---|---|
| Auth, login, session expiry, idle timeout, E2E key unlock | `AuthContext` / `useAuth()` |
| 4 core TanStack queries (jobs, shifts, users, inventory) | `useAppQueries(enabled)` |
| Active shift / inventory allocation (derived) | `useActiveShift`, `useInventoryAllocation` |
| Mutations facade | `useApp()` → composes domain hooks (`useJobMutations`, `useClockMutations`, `useInventoryMutations`, `useBoardMutations`, `useChatMutations`, …) |
| Persisted nav state (search, filters, scroll, quick-action order) | `NavigationContext` |
| **Offline write queue** (writes survive network loss, replay on reconnect) | clock punches `src/lib/offlineQueue.ts` + `syncOfflineClockQueue.ts`; general actions `src/lib/offlineActionQueue.ts` + `syncOfflineActionQueue.ts`; detection `networkStatus.ts` (`isOffline`); UI `OfflineIndicator` / `OfflinePunchBanner`. Rules in `docs/DOMAIN_RULES.md`. |

---

## Big screens — grep the anchor, do NOT read whole

### `src/JobDetail.tsx` (~3,950 lines) — one mega-component `JobDetail`
| Feature | Anchor |
|---|---|
| Clock in/out from job | `handleClockIn`, `handleClockOut` |
| Checklist complete | `handleChecklistComplete` |
| Inventory adjust (CNC / unit / add) | `handleCncAdjust`, `handleUnitAdjust`, `handleAddInventory` |
| Comments (add/edit/delete) | `handleSubmitComment`, `handleUpdateComment`, `handleConfirmDeleteComment` |
| Edit save / cancel | `handleSaveEdit`, `handleCancelEdit` |
| Auto-assign materials / apply from part | `handleAutoAssignMaterials`, `handleApplyFromPart` |
| Add part to existing job | `handleAddPartToExistingJob` |
| Delete job | `handleConfirmDeleteJob` |
| Set/variant quantity inputs | `handleDashQuantityChange`, `handleFillFullSet`, `handleSetsQuantityChange` |
| Attachments upload/view | `handleFileUpload`, `handleViewAttachment` |
| Accounting-gated header pills | `JobBillingPanel`, `JobReferencePills`, `JobCustomerSelect` (behind `ACCOUNTING_BUILD_ENABLED`); plain fallback `PlainEstInvPills` |
| JSX layout sections | grep the comment text: `EDIT MODE`, `Variants and quantities`, `Labor & Materials`, `Action Buttons`, `Billing`, `Time / Shifts` |

### `src/features/admin/PartDetail.tsx` (~3,920 lines) — `PartDetail` + sub-components
| Feature | Anchor |
|---|---|
| Main component | `PartDetail` |
| A variant row (large) | `VariantCard` |
| Per-variant quote calculator | `VariantQuoteMini` |
| Add variant inline | `AddVariantInline` |
| Add material form | `AddMaterialForm` |
| Set composition editor | `SetCompositionEditor` |
| Product image row / upload validation | `ProductImageRow`, `validateProductImageFile`, `MAX_PRODUCT_IMAGE_BYTES` |
| Create part form | `CreatePartForm` |
| Synthetic (no-variant) set handling | `syntheticVariantFromPart`, `NoVariantSetQtyEditor` |

### `src/KanbanBoard.tsx` (~1,900 lines)
| Feature | Anchor |
|---|---|
| Board container (shop + admin) | `KanbanBoard` |
| Single job card | `KanbanJobCard` (React.memo) |
| Checklist editor modal | `ChecklistEditorModal` |
| Column definitions | `SHOP_FLOOR_COLUMNS`, `ADMIN_COLUMNS`, `COMPLETE_STATUSES` |
| Overdue / set-count / part meta helpers | `isJobOverdue`, `getExactSetCount`, `getPartMetaForJob` |

### `src/TrelloImport.tsx` (~2,470 lines) — monolithic `TrelloImport`
Grep within for the step you need (auth `DEFAULT_TRELLO_API_KEY`, board/list fetch, mapping, import run).

### `src/TimeReports.tsx` (~1,320 lines) — `TimeReports`
Date windowing: `startOfLocalDay`, `startOfLocalWeek`, `buildDateRangeWindow`.

---

## Accounting module — `src/features/accounting/`

### `types.ts` (~3,190 lines) — all domain types, grouped in this order
Accounts → Journal entries/lines → Customers → Items → **Invoices** → Payments →
Vendors → Bills → VendorPayments → DefaultAccounts → Reports (`TrialBalanceReport`,
`ProfitAndLossReport`, `BalanceSheetReport`, `AccountLedgerReport`, CashFlow) → Attachments.
**Grep the interface name** (e.g. `interface Invoice`, `interface Payment`) — don't read top-to-bottom.

### `hooks/useAccountingMutations.ts` (~1,700 lines) — ~130 mutation hooks
One exported `useXxx()` per operation, grouped: accounts, journal, customers, **invoices**
(`useCreateInvoiceDraft`, `useSendInvoice`, `useVoidInvoice`, …), payments, vendors, bills,
bank/reconciliation/Plaid, dimensions, items, recurring, inventory layers/COGS, budgets,
fixed assets, custom fields, attachments, estimates, projects/SOV/change-orders, purchase
orders, tax. **Grep the operation name** — it's almost always `use<Verb><Noun>`.

---

## Other hot files (next tier)

| Concern | File | Anchor |
|---|---|---|
| **Which file is view X?** central lazy router | `src/AppRouter.tsx` | the `lazyWithRetry(() => import('...'))` list maps every view → module |
| Canonical domain types (JobStatus, ViewState, User, Shift, Comment, InventoryCategory) | `src/core/types.ts` | grep the type name; status labels in `STATUS_LABELS`, categories in `CATEGORY_LABELS` |
| Dashboard + quick-action drag system | `src/Dashboard.tsx` | `Dashboard`; drag = `SortableQuickActionCard` / `QuickActionHideZone` / `QUICK_ACTION_DRAG_ACTIVATION`; also `SecuritySettingsModal`, `ShiftTimerDisplay` |
| Admin create-job form | `src/AdminCreateJob.tsx` | `AdminCreateJob`, `ADMIN_INITIAL_STATUS_OPTIONS` |
| Org settings, labor rates, on-site rules | `src/features/admin/AdminSettings.tsx` | `AdminSettings` |
| Calendar / job timelines | `src/features/admin/Calendar.tsx` | `Calendar`, `JobTimeline`, `CALENDAR_STATUSES`, `toDateKey` |
| Quotes list/editor | `src/Quotes.tsx` | `Quotes` |
| Job mutations (status, paid finalize, notify, revert) | `src/hooks/useJobMutations.ts` | `useJobMutations`; `finalizePaidJob`, `recordStatusChange`, `buildRevertPatch`, `notifyIfEnabled` |
| Capacity / work-hour scheduling | `src/lib/workHours.ts` | `DEFAULT_WORK_WEEK_SCHEDULE`, `CapacityScheduleResult`, forward-plan types |

### Accounting (read & posting side)
| Concern | File | Anchor |
|---|---|---|
| Invoice/journal math (totals → journal lines) | `src/features/accounting/posting.ts` | `computeInvoiceTotals`, `buildInvoiceRevenueJournalLines`, `buildProgressInvoiceJournalLines`, `buildRetainageReleaseJournalLines` |
| Accounting read hooks (counterpart to mutations) | `src/features/accounting/hooks/useAccountingQueries.ts` | grep `use<Noun>` query name |
| Invoice detail screen | `src/features/accounting/invoices/InvoiceDetailView.tsx` | `InvoiceDetailView` |
| Bank feeds / reconciliation screen | `src/features/accounting/banking/BankFeedsView.tsx` | `BankFeedsView` |

> Note: `src/pocketbase.ts` is a **legacy-named facade** that just re-exports the Supabase
> services from `services/api` — there is no PocketBase backend. Import from it or from
> `services/api` directly.

---

## Deep reference (authority lives in docs/, not here)
- `docs/DOMAIN_RULES.md` — durable rates, security/inventory safeguards, job invariants (verified).
- `docs/SYSTEM_MASTERY.md` — verified DB schema, relations, RLS, encryption, job workflow.
- `docs/JOB_AND_PART_DATA_FLOW.md`, `docs/PART_DETAIL_AUTO_CALCULATIONS.md` — data-flow specifics.
- `AGENTS.md` — env, routes/views, architecture summary, run/test commands.

---

## Token-lean prompt recipes (for the human writing the prompt)

The cheapest accuracy win is naming the target up front so no discovery phase runs.

- **Name the file + anchor:** "In `JobDetail.tsx`, the `handleAutoAssignMaterials` flow — …"
  instead of "fix the materials auto-assign bug."
- **Cite the rule's source:** "per the inventory-gating rule in memory" / "see
  `docs/SYSTEM_MASTERY.md`" instead of re-explaining it.
- **Delegate discovery, don't pay for it inline:** for "find every place X happens," ask for
  the **Explore agent** — its file-reading cost stays in the sub-agent, not the main thread.
- **One task per session.** Unrelated task → new session, so old context isn't recarried.
- **Point here first:** "check `docs/CODE_MAP.md` for where this lives" turns a blind search
  into a direct read.
