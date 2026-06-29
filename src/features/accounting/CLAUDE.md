# Accounting module — invariants (read before editing here)

Double-entry bookkeeping. Get these wrong and you corrupt the ledger silently. Verify against
the code (anchors below); this file is a guardrail, not the authority.

## Non-negotiable invariants
- **Debits == credits** on every journal entry. The posting builders in `posting.ts`
  (`buildInvoiceRevenueJournalLines`, `buildProgressInvoiceJournalLines`,
  `buildRetainageReleaseJournalLines`) must return balanced lines — never emit a one-sided entry.
- **Posted entries are immutable.** Journal lifecycle is `draft → posted → void`
  (`JournalStatus` in `types.ts`). To change a posted entry you **void** it (`useVoidJournalEntry`),
  you do not edit or delete it. Same for invoices/bills: drafts are editable/deletable
  (`useUpdateInvoiceDraft`, `useDeleteInvoiceDraft`); once sent/posted use
  `useVoidInvoice` / `useVoidAndReissueInvoice` / the controlled `useEditPostedInvoice` path.
- **Closed periods are frozen.** Respect the closed-through date (`useSetClosedThroughDate`) —
  never post into a closed period.
- **Account normal balance** comes from `DEFAULT_NORMAL_BALANCE[accountType]` (`types.ts`).
  Don't hardcode debit/credit signs; derive from the account's type.

## Inventory costing / COGS
- Inventory is costed in **layers**: `useReceiveInventoryLayer` adds cost layers;
  `useConsumeJobCogs` recognizes COGS when a job consumes inventory. Don't recognize COGS twice
  or bypass the layer consumption.

## Where things live (see docs/CODE_MAP.md)
- Types, grouped by domain — `types.ts` (grep `interface Invoice`, `interface Payment`, …).
- ~130 mutation hooks — `hooks/useAccountingMutations.ts` (grep `use<Verb><Noun>`).
- Read hooks — `hooks/useAccountingQueries.ts`. Posting math — `posting.ts`.
- Row↔domain mapping — `src/services/api/accounting/mappers.ts`.

## Conventions
- Money: keep amounts in the module's canonical representation — don't introduce float rounding
  in new math; route totals through `computeInvoiceTotals`.
- New mutations follow the existing `useXxx()` + query-invalidation pattern; don't rename or change
  signatures of existing hooks.
