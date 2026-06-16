# Monthly Close & Reconciliation Checklist

A repeatable month-end close for the WorkTrack accounting module. Run it after the last
day of each month; target completion by the **10th business day**. Tick each box; record
who/when. This is the control record an auditor or your CPA will want to see — it
demonstrates the books are reviewed, reconciled, and locked on a schedule.

> Roles: **Bookkeeper** does the work; **Reviewer/CPA** signs off on §6. For a single
> operator, do §1–5 yourself and have the CPA review §6 quarterly at minimum.

---

## 0. Cutoff (start of close)

- [ ] Confirm all source documents for the month are entered: customer invoices, vendor
      bills, expenses, payments received, payments made, credit memos.
- [ ] Confirm nothing dated in the **next** period snuck into this one (and vice-versa).
- [ ] If the QuickBooks replica is in use, run a **sync** so WorkTrack and QBO cover the
      same transactions before you reconcile (`/app/accounting/integrations/sync`).

## 1. Bank & credit-card reconciliation

- [ ] For each bank / card account: statement **ending balance** = reconciled balance in
      the books.
- [ ] Every statement line is matched to a recorded transaction; investigate un-matched
      items both directions (in books not on statement = outstanding; on statement not in
      books = missing entry).
- [ ] Outstanding checks / deposits-in-transit listed and reasonable (none stale).
- [ ] Record the reconciled balance + date for each account.

## 2. Subledgers tie to the General Ledger

- [ ] **A/R aging** total = Accounts Receivable control account balance.
- [ ] **A/P aging** total = Accounts Payable control account balance.
- [ ] Review aging buckets: follow up on 60+ day receivables; confirm nothing miscategorized.
- [ ] Undeposited Funds / clearing accounts are near zero (or every residual is explained).
- [ ] Inventory / WIP (if tracked) ties to the supporting job/part valuation.

## 3. Journal entries & accruals

- [ ] Post recurring/standard accruals for the month (prepaids amortized, depreciation,
      payroll accrual, accrued expenses, deferred revenue).
- [ ] **Review every manual journal entry** for the period: each has a description, is
      balanced (debits = credits), and is posted (not left in draft). No mystery entries.
- [ ] Reclass any obvious miscodings caught during review.

## 4. Verify against QuickBooks (if the replica is enabled)

- [ ] Run the **verification report** at `/app/accounting/integrations` and diff
      WorkTrack's engine vs QBO for the period: **Trial Balance**, **Balance Sheet**,
      **P&L**, **A/R & A/P Aging**, **General Ledger**.
- [ ] Investigate any variance beyond rounding; resolve before locking. (A clean diff here
      is the strongest single signal the month is right.)

## 5. Financial review (reasonableness)

- [ ] **Trial balance balances** (total debits = total credits).
- [ ] Balance Sheet: Assets = Liabilities + Equity; cash, A/R, A/P agree with §1–2.
- [ ] P&L: compare to prior month / budget; explain unusual swings; confirm revenue
      recognized in the right period; no expense in the wrong account.
- [ ] Sales-tax liability for the period looks right (and is set aside for filing). Note:
      WorkTrack's internal rates are advisory — confirm against your filing authority or a
      certified provider before remitting.

## 6. Sign-off & lock

- [ ] Reviewer/CPA reviews §1–5 and the financial statements.
- [ ] **Lock the period** so prior-month figures can't change silently (close/lock the
      accounting period for the month).
- [ ] Export & file the month's statements (Trial Balance, Balance Sheet, P&L) and the
      reconciliation records to your document archive.
- [ ] Record sign-off: **closed by / reviewed by / date**.

---

## Quarter / year-end add-ons

- [ ] **Quarterly:** sales-tax return prepared/filed; estimated income-tax payments;
      CPA review of the full quarter.
- [ ] **Year-end:** **1099 vendor review** — confirm W-9s on file, totals for reportable
      vendors, and prepare/file 1099-NEC. Once you issue **10+** information returns in a
      year the IRS requires e-filing (see the IRIS e-file feature scope). Then: fixed-asset
      / depreciation true-up, inventory count, accruals reversal, and hand the CPA a clean
      trial balance.

---

### Close log (copy per month)

| Month | Bank rec'd | Subledgers tie | JEs reviewed | QBO diff clean | Closed by | Reviewed by | Date |
| ----- | ---------- | -------------- | ------------ | -------------- | --------- | ----------- | ---- |
|       |            |                |              |                |           |             |      |
