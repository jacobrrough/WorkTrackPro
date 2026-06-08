# QuickBooks → WorkTrackAccounting: Full 1:1 Import Plan (Intuit API)

## Goal

Connect directly to the Intuit **QuickBooks Online API** and import the company's data so the
WorkTrackAccounting module becomes a **1:1 replica** of the QuickBooks company file. Per the chosen
direction:

- **Source:** Intuit QBO API (OAuth 2.0), not CSV.
- **Scope:** customers, vendors, items, **invoices (+ customer payments)**, **estimates**,
  **bills (+ vendor payments)** — plus every *other* transaction type needed for a true replica
  (see "Completeness" below).
- **Ledger model:** **documents drive the ledger** — invoices/bills/payments post their own journal
  entries through the existing posting engine; we do **not** keep a separately-imported raw GL.
- **Starting state:** the GL was **already imported** once (as `source_type='import'` journal entries),
  so the import must first **retire that raw GL** or it will double-count.

## What already exists (reused, not rebuilt)

The accounting module already has everything needed to *post* — the new work is the QBO connection,
the entity mappers, and the orchestration.

| Capability | Where | Reuse |
|---|---|---|
| Invoice → balanced JE | `posting.ts` `buildInvoiceRevenueJournalLines` | ✅ |
| Bill → balanced JE (with correct tax/inventory handling) | `posting.ts` `buildBillExpenseJournalLines` | ✅ (just hardened in P1-4) |
| Customer payment (atomic) | RPC `accounting.record_customer_payment` | ✅ |
| Vendor payment (atomic) | RPC `accounting.record_vendor_payment` | ✅ |
| Estimate → invoice | RPC `accounting.convert_estimate_to_invoice` | ✅ |
| Create + post a JE | `journalService.createAndPost` | ✅ |
| Idempotent dedupe key | `import/deterministicId.ts` (UUIDv5) | ✅ |
| Account/party classification + matching | `import/qboAccountMapping.ts`, `qboPartyMapping.ts` | ✅ |
| Customers/Vendors/Accounts upsert | `customersService`/`vendorsService`/`accountsService` `.import()` | ✅ |
| Scoped accounting client + React Query hooks | `accountingClient.ts`, `useAccountingMutations` | ✅ |
| Schema: invoices, invoice_lines, payments, payment_applications, bills, bill_lines, vendor_payments, vendor_payment_applications, estimates, estimate_lines, items, customers, vendors, accounts, journal_entries(`source_type` incl. `import`) | accounting migrations | ✅ |

**Build new:** the QBO OAuth + token store (server-side), the QBO REST client, per-entity
QBO→WorkTrack mappers, the orchestration/run UI, the GL-reconciliation step, and a verification report.

## Architecture

QuickBooks requires the **client secret and refresh token to stay server-side**, so all Intuit traffic
goes through **Netlify functions**, never the browser.

```
Browser (admin)                 Netlify Functions (server)            Supabase / Intuit
──────────────                  ──────────────────────────           ─────────────────
Connect to QuickBooks  ───────► qbo-oauth (/authorize) ─────redirect─► Intuit consent screen
   (Settings → Integrations)                                              │
   ◄──────────────────────────  qbo-oauth (/callback) ◄──auth code───────┘
                                   exchange code→tokens
                                   store {realmId, refresh_token} ───────► accounting.qbo_connection
Run import  ──────────────────► qbo-sync (entity, cursor)
                                   refresh access token (24h rotation)
                                   GET /v3/company/{realmId}/query ◄─────► Intuit QBO API
                                   map → upsert/post via acct() + RPCs ──► accounting.* (RLS as service)
   ◄── progress / counts ───────  returns {created, updated, skipped, failed}
```

- **OAuth 2.0 Authorization Code flow**, scope `com.intuit.quickbooks.accounting`. Access token ~1h;
  refresh token rotates every ~24h (max 5-yr lifetime) — we persist the newest refresh token on every
  call. ([Intuit OAuth docs](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0))
- **CSRF:** sign the OAuth `state` and verify on callback.
- **Querying:** QBO SQL-like `/query` with `STARTPOSITION`/`MAXRESULTS` (page size 1000 max), and **CDC**
  (`/cdc?entities=...&changedSince=...`) for incremental re-sync within a 30-day window.
  ([Query docs](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries) ·
  [CDC docs](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture))

## Data-model additions (one small migration)

To make the import **idempotent and re-runnable** (and support ongoing CDC sync), store the QBO id on
each imported record and persist the connection:

- `accounting.qbo_connection` — `realm_id`, `refresh_token` (encrypted), `access_token`,
  `access_token_expires_at`, `connected_by`, `connected_at`, `last_sync_at`, `last_cdc_cursor`.
  RLS: **no client policy** (service-role only, like `api_rate_limits`); the browser never reads tokens.
- `external_qbo_id text` (+ index) on: `customers`, `vendors`, `items`, `invoices`, `estimates`,
  `bills`, `payments`, `vendor_payments`. Lets a re-run **update** the existing record instead of
  duplicating, and lets payments resolve which invoice/bill they apply to by QBO id.
- A `accounting.qbo_import_log` (entity, qbo_id, action, status, message, run_id) for auditability and
  retry.

## Import order (dependencies)

Masters first, then documents, then applications. Each step is idempotent (keyed by `external_qbo_id`
for documents, UUIDv5 for catch-all JEs).

1. **Chart of Accounts** — match/extend `accounts` (reuse `qboAccountMapping`).
2. **Items / Products & Services** — create `items` with `income_account_id` / `expense_account_id` /
   `inventory_asset_account_id` resolved from the QBO item's account refs.
3. **Customers** and **Vendors** — upsert (reuse the party services); stamp `external_qbo_id`.
4. **GL reconciliation (gated)** — void the prior `source_type='import'` entries (see below).
5. **Estimates** — create `estimates`/`estimate_lines` (non-posting); link `external_qbo_id`. Convert to
   invoice only if the QBO estimate is accepted/linked to an invoice.
6. **Invoices** — create `invoices`/`invoice_lines` (resolve customer + item + per-line income account +
   tax), then **post** → `buildInvoiceRevenueJournalLines`. Stamp `external_qbo_id`.
7. **Bills** — create `bills`/`bill_lines` (resolve vendor + item/account per line + header tax), then
   **post** → `buildBillExpenseJournalLines`. Stamp `external_qbo_id`.
8. **Customer Payments** — `record_customer_payment` RPC; resolve `AppliedToTxns` → `payment_applications`
   by `external_qbo_id`.
9. **Vendor Bill Payments** — `record_vendor_payment` RPC; resolve applications by `external_qbo_id`.
10. **Completeness pass** (see below) — import the remaining QBO transaction types as balanced JEs.
11. **Verification report** — reconcile WorkTrack totals to QuickBooks reports.

## GL reconciliation (retire the already-imported GL)

Because the GL was already imported as `source_type='import'` JEs and we now want documents to drive the
ledger, step 4 **voids** those entries (posted JEs are immutable, so we void rather than delete — keeping
the audit trail):

```sql
update accounting.journal_entries
   set status='void', voided_at=now(), voided_by=<admin>,
       void_reason='Superseded by QBO document import'
 where source_type='import' and status='posted';
```

This is a **destructive-intent live operation** → it runs only with your explicit approval, after a dry
run that reports how many entries/dollars will be retired. (If you'd rather keep history before a cutover
date and only document-drive going forward, that's an alternative we can gate on a date.)

## Completeness — a true 1:1 replica

Invoices/estimates/bills/payments cover the bulk, but QuickBooks also has **JournalEntry, Deposit,
Transfer, CreditMemo, RefundReceipt, SalesReceipt, VendorCredit, Purchase (Check/Expense/CC)**. For a
genuine 1:1 ledger, step 10 imports those **remaining** types via a **catch-all JE importer** that reuses
the existing GL machinery (`toNewJournalEntryInput` + `createAndPost`, keyed by UUIDv5), querying only the
types **not** already imported as documents — so nothing double-posts. Items we model natively post as
documents; everything else posts as a faithful JE. This is the honest path to "matches QuickBooks exactly."

## Phased delivery (each phase verified before the next)

- **Phase 0 — Connect:** `qbo_connection` table + `qbo-oauth` function (authorize/callback/refresh) +
  a "Connect to QuickBooks" card in accounting settings + a read-only **CompanyInfo** test call.
  *Gate:* a successful round-trip showing the connected company name.
- **Phase 1 — Masters:** accounts, items, customers, vendors (idempotent upsert + `external_qbo_id`
  migration). *Gate:* counts match QBO; re-run creates 0 duplicates.
- **Phase 2 — Reconcile GL:** dry-run + gated void of `source_type='import'` entries.
- **Phase 3 — Documents:** estimates, invoices (+post), bills (+post). *Gate:* AR/AP balances and income
  totals match QBO.
- **Phase 4 — Payments:** customer payments + vendor bill payments + applications. *Gate:* open balances
  and aging match QBO.
- **Phase 5 — Completeness + verify:** catch-all JE import for remaining types; a **reconciliation
  report** comparing Trial Balance / Balance Sheet / P&L / AR-aging / AP-aging to the QBO equivalents,
  flagging any deltas. *Gate:* statements tie out to QuickBooks.

## Verification ("how we know it's 1:1")

- Pull QBO's **TrialBalance**, **BalanceSheet**, **ProfitAndLoss**, **AgedReceivables**, **AgedPayables**
  reports via the API and diff them against WorkTrack's report engine (which the audit verified ties out
  internally). Surface any account-level delta.
- Idempotency test: a second full run reports 0 created / N updated / 0 duplicated.
- Spot-check: a sample invoice/bill in WorkTrack shows the same lines, tax, total, and applied payments as
  in QuickBooks, and its journal entry balances.

## Security

- Client secret + refresh/access tokens **never** reach the browser; only the `qbo-*` Netlify functions
  hold them (env var `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`, tokens in the service-role-only
  `qbo_connection` table). Encrypt the refresh token at rest.
- Signed OAuth `state`; minimal scope; admin/`accounting_admin`-gated trigger of every sync function.
- The sync functions stay within the `accounting` schema and reuse the balance-guarded posting path, so an
  import can never write an unbalanced ledger.

## Prerequisites (you / one-time)

1. Create an app at **developer.intuit.com** (start in the **sandbox**), get **Client ID + Client
   Secret**, and set the **Redirect URI** to the deployed `…/api/qbo-oauth/callback`.
2. Add `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (sandbox|production), `QBO_REDIRECT_URI`
   as Netlify env vars.
3. Note: connecting **only your own company** can run on the developer keys; broad production use of an
   Intuit OAuth app requires Intuit's app review — not needed for a single internal company.

## Risks & limitations

- **Effort:** multi-step feature (OAuth + client + 8–9 entity mappers + reconciliation + verify).
  Build behind `VITE_ACCOUNTING_ENABLED` like the rest of the module.
- **Tax fidelity:** QBO's automated sales tax (AST) may not expose per-line rates the same way; we map
  `TxnTaxDetail` to our tax codes, falling back to a single tax line where needed.
- **Multi-currency / classes / locations:** map QBO Class/Department to our dimensions; single-currency
  assumed unless you use multi-currency (flag if so).
- **Rate limits:** QBO throttles (~500 req/min/realm); the sync paginates and backs off.

## Open questions to confirm at kickoff

1. **Retire prior GL** by voiding all `source_type='import'` entries (recommended), or keep history before
   a cutover date?
2. **Sandbox first** (dry run against QBO sandbox) before pointing at the live company?
3. Do you use QuickBooks **classes/locations** or **multi-currency** (affects mapping)?
