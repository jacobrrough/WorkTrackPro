# WorkTrackAccounting — Bigcapital mining notes + Tax-table auto-refresh design

## ⚠️ Legal boundary (READ FIRST)
**Bigcapital is AGPL-3.0.** Because WorkTrackPro is served over a network, copying Bigcapital's *source/SQL* into it could trigger AGPL's network-copyleft and force the whole app to become AGPL. Therefore:
- ✅ ALLOWED: non-copyrightable **facts** (standard chart-of-accounts numbers/names, GAAP report structures, public tax data) and general **design approaches**.
- ❌ NOT ALLOWED: copying their TypeScript/SQL/report-calculation code verbatim or as a close derivative.

Everything below is standard small-business accounting (facts), cross-checked against Bigcapital's default seed for completeness — re-implement in our own conventions.

## 1. Chart of accounts — recommended additions
Our seed (`migration 20260601000003`) has 16 system accounts. These standard accounts are worth adding (additive migration; `is_system` where structural):

| Code | Name | Type / subtype | Why it matters |
|---|---|---|---|
| 2050 | Opening Balance Liabilities | liability / other_current_liability | **Required for import/migration** — offsets imported historical balances |
| 3050 | Opening Balance Equity | equity | **Required for import/migration** — the balancing equity offset |
| 1250 | Uncategorized Asset | asset / other_current_asset | Bank-feed landing zone before categorization |
| 4900 | Uncategorized Income | income | Bank-feed landing zone (A4 rules recategorize) |
| 6900 | Uncategorized Expense | expense | Bank-feed landing zone |
| 1260 | Payment Processor Clearing | asset / other_current_asset | Stripe/PayPal payment-link settlement |
| 1400 | Prepaid Expenses | asset / other_current_asset | Accrual accounting |
| 2400 | Deferred/Unearned Revenue | liability / other_current_liability | Customer prepayments |
| 1030 | Petty Cash | asset / cash | Cash detail |
| 2500 | Loans Payable | liability / long_term_liability | Borrowings |
| 3200 | Owner Drawings | equity | Owner withdrawals |
| 7000 | Exchange Gain/Loss | other_expense | Multi-currency (optional) |
| 6100–6400 | Rent, Office, Bank Fees, Depreciation Expense | expense | Common expense detail |

(Keep our existing 1000/1050/1200/1300/1500/1510/2000/2100/2200/2300/3000/3900/4000/4100/5000/6000.)

## 2. Reports — parity checklist
Already built (A3): Trial Balance, P&L, Balance Sheet, AR aging, AP aging. Standard set to reach parity later: **Statement of Cash Flows**, General Ledger detail, Journal report, Account-transactions drill-down, Sales/Purchases by customer/vendor/item, and the Sales-Tax Liability summary (C1).

## 3. Patterns worth adopting (approach only)
- **Opening-balance-equity flow**: imports post historical balances against 3050/2050 so the trial balance stays balanced without a manual second entry.
- **Undeposited Funds → deposit grouping**: receipts land in 1050, then a "make deposit" groups them into the bank account.
- **Uncategorized Income/Expense as a bank-feed inbox**, recategorized by the A4 rules engine.
- **Clearing accounts** for payment processors (money in transit between processor and bank).

---

## 4. NEW MODULE — `TAX-SYNC`: quarterly tax-table auto-refresh + drift alert (ADVISORY-ONLY)
Implements the request: pull fresh local/state tax tables every 3 months and **alert the admin when current stored rates differ from the new data** — but **never auto-apply** changes (admin confirms).

**DB (additive, schema `accounting`, RLS + audit via `_apply_standard_table`):**
- `accounting.tax_table_sources` — `id, name, kind (sales|payroll), jurisdiction, url, official_file_url, check_frequency_days default 90, active, last_checked_at`. Seed two: **CDTFA** (CA sales/use tax rates) and **CA EDD** (payroll UI/ETT/SDI/PIT rates).
- `accounting.tax_table_snapshots` — `id, source_id, fetched_at, content_hash, parsed jsonb, raw text`. One row per pull (history).
- `accounting.tax_table_drift` — `id, source_id, snapshot_id, detected_at, diff jsonb, severity, status (open|reviewed|applied|dismissed), reviewed_by, reviewed_at`. One row per detected mismatch.

**Backend — Netlify scheduled function** `netlify/functions/tax-table-refresh.mjs`:
- Schedule **quarterly** via cron `0 6 1 1,4,7,10 *` (1st of Jan/Apr/Jul/Oct).
- Uses the service role. For each active source: fetch the **official downloadable data file** (CDTFA publishes a sales-tax-rates file; EDD publishes payroll rate tables) — **prefer official files over fragile HTML scraping** — parse to a normalized `{jurisdiction, rate, effective_date}` set, compute `content_hash`, store a snapshot, then **diff** against the current active `accounting.tax_rates` (sales) / payroll-rate store.
- **Gated on a server env var `ACCOUNTING_TAX_SYNC_ENABLED` (default OFF):** when unset the function exits immediately — no external fetch, no DB write — so it stays inert in production until the module graduates. (A frontend build flag can't gate a scheduled function, so this server gate is what preserves the isolation guarantee.)
- On any change → insert a `tax_table_drift` row (status `open`). **That row IS the admin alert** and stays entirely within `accounting.*`; the admin UI surfaces open drift prominently (badge + list). Do NOT write `public.*`/`system_notifications` — email/push delivery is a **deferred** enhancement needing a separate cross-schema sign-off.
- **Never mutates `accounting.tax_rates` automatically.** Fail-safe: on fetch/parse error, log + record, never corrupt stored rates.
- Also expose a manual "check now" callable for the admin UI.

**Frontend — `accounting_admin`-only "Tax table updates" screen (under Settings):**
- List sources + last-checked + open drift alerts.
- Drift detail: old vs new rates side-by-side.
- Explicit **Apply** (admin-confirmed → updates `accounting.tax_rates`, marks drift `applied`) and **Dismiss**.
- Prominent G9 disclaimer ("Not certified tax software. Always verify with a CPA/EA.").

**Caveats for the builder (will be flagged for human verification):**
- The **source-specific parsers depend on the current CDTFA/EDD file formats** — implement best-effort and mark each parser "VERIFY against the live file format" for a human; the framework (snapshot/diff/alert/UI) is fully testable, the parsers are not mechanically verifiable.
- Defensive parsing + rate-limit external fetches; treat fetched content as untrusted input.
- Advisory-only by design — this is what makes it safe to build autonomously.
