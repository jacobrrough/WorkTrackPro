# 1099-NEC e-File via IRS IRIS — Feature Scope

**Status:** scoping / greenlight doc — _not_ an implementation. It defines the goal, the
prerequisites, what already exists to build on, the gap, a phased plan, and the decisions
needed before work starts.

> **Verify-at-build caveat.** IRIS specifics (TCC application flow, CSV templates, A2A
> schema versions, deadlines) change yearly. Treat the IRS facts below as the shape of the
> problem and re-confirm exact formats against current **IRS Pub 5717 (IRIS A2A)**, the
> **IRIS Taxpayer Portal** help, and the **IRIS Schemas/Business Rules** at implementation
> time.

---

## 1. Why now

The IRS lowered the mandatory e-file threshold for information returns: once a filer issues
**10 or more** information returns in aggregate in a calendar year, paper filing is no
longer allowed — they must be e-filed. For a shop paying enough subcontractors, the 1099-NEC
count alone can cross that line. This is the one "e-file capability" genuinely worth building
in-house (see the security/tax discussion that spawned this): it extends the worklist we
already have rather than entering a regulated business.

## 2. What IRIS is (two filing paths)

**IRIS** = the IRS _Information Returns Intake System_, the free e-file channel for the 1099
series. Two ways in, both requiring a **Transmitter Control Code (TCC)**:

| Path                     | What it is                                                              | Fit for WorkTrack                                                              |
| ------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Taxpayer Portal**      | Web app: key in returns, or upload a CSV per the IRS template (capped per upload). | **Phase 1.** WorkTrack generates the IRIS-format CSV; admin uploads + transmits. Fast, low-risk. |
| **A2A (Application-to-Application)** | SOAP/XML web service: software transmits returns, polls acknowledgements, sends corrections programmatically. | **Phase 2.** Fully in-app transmit + ack. More build (XML schema, auth, status polling). |

## 3. Prerequisite — TCC (user action, has lead time)

- Apply for an **IRIS TCC** via the "IRIS Application for TCC" on the IRS site (needs an
  IRS account / ID.me, business details, and Responsible Officials). **Approval can take
  weeks — start this early; it gates everything.**
- The TCC + the payer EIN are configuration the feature reads at transmit time; they are
  credentials → store like other secrets (see `DISASTER_RECOVERY.md` §3), not in git.

## 4. What WorkTrack already has (build-on surface)

The #12 1099 worklist is done and is the natural base:

- **Read-model:** `accounting.v_1099_vendor_totals` — per-vendor / per-calendar-year sum of
  **posted, non-card** payments (card excluded as 1099-K; void-safe via posted journal
  entries).
- **Math:** [`form1099Math.ts`](../src/features/accounting/reports/form1099Math.ts) — applies
  the **$600** threshold, ranks reportable vendors, flags `wComplete` (legal name + TIN on
  file). Pure + unit-tested; identical on screen and export.
- **UI + export:** [`Form1099WorklistView.tsx`](../src/features/accounting/reports/Form1099WorklistView.tsx)
  with CSV/PDF export already wired.
- **W-9 data:** `accounting.vendor_tax_info` (legal_name, **tax_id**, address, exempt). The
  worklist reads the `accounting.v_vendor_w9_status` view, which exposes only a
  `has_tax_id` boolean — **the raw TIN never reaches the browser on the worklist path.**

## 5. The gap to fill

1. **Recipient TIN + address, server-side.** IRIS needs the raw TIN, legal name, and address
   per payee. By design the raw TIN is _not_ on the worklist wire. The e-file payload must be
   assembled **server-side** (a Netlify function under admin auth) that reads
   `vendor_tax_info` and emits the IRIS record — the browser never handles raw TINs. This is
   also where TIN-at-rest encryption lands (see §7).
2. **Payer block:** business legal name, EIN, address, contact, TCC — a small config record.
3. **Filing records (new table):** per tax-year submission tracking — payload built,
   transmitted, IRS **Receipt ID**, status (Accepted / Accepted-with-errors / Rejected),
   per-payee acceptance, and a link from a **correction** to its original.
4. **Transmit + acknowledge:** Phase 1 = produce the IRIS CSV for portal upload + record the
   Receipt ID the admin pastes back. Phase 2 = A2A transmit + automated ack polling.
5. **Corrections lifecycle:** generate a corrected return referencing the original
   submission (IRIS distinguishes original vs. correction).
6. **Recipient copies:** the payee's 1099-NEC copy (PDF) by Jan 31 — partly covered by the
   existing PDF exporter; confirm it matches the official layout.

## 6. Recommended phasing

- **Phase 1 — IRIS CSV export (small, ship first).** Server function assembles the IRIS
  Portal CSV (incl. TINs) for a tax year; admin uploads via the Portal and records the
  Receipt ID + status back into WorkTrack. Gets you compliant filing with minimal build and
  no XML/web-service surface. **This is the recommended first deliverable.**
- **Phase 2 — A2A direct transmit.** Add the SOAP/XML transmitter, authentication, and
  acknowledgement polling so filing + ack happen entirely in-app. Build only if the manual
  Portal step becomes a burden.

## 7. Security & the TIN-at-rest decision

The QBO-token encryption just shipped (`netlify/functions/lib/tokenCrypto.mjs`, AES-256-GCM,
key in `TOKEN_ENC_KEY`) is the right model for **server-only** secrets. Vendor TINs are
different: today the **browser W-9 editor reads/writes `vendor_tax_info.tax_id` directly**
under RLS (the migrations flag `tax_id` as a deferred encryption target). So TIN-at-rest
needs a decision:

- **Option A — DB-side (pgcrypto / Vault):** encrypt the `tax_id` column in Postgres; RLS
  still gates who can read it, and only the `v_vendor_w9_status.has_tax_id` expression
  changes (the migration comment already anticipates exactly this). Keeps the existing
  client read/write path.
- **Option B — route TIN through a function + reuse `tokenCrypto`:** move TIN read/write
  behind an admin function so the same app-layer envelope encryption (and key separation)
  applies. Heavier client change, but one crypto story for tokens **and** TINs.

For IRIS the payload is assembled server-side regardless, so either option works; **Option A
is the lighter lift** and matches the original design note. This decision should be made when
the IRIS feature (or a dedicated TIN-encryption pass) is greenlit — it is the remaining piece
of "encrypt secret columns at rest."

Other controls: admin-only trigger; audit-log every transmit/correction; never log raw TINs
or the assembled payload; mask TINs in any UI to last-4.

## 8. Decisions needed before build

1. **TCC:** confirm you'll apply (and for which payer EIN). _Gating, slow — start now._
2. **Phase 1 only, or commit to A2A (Phase 2) too?** Recommend Phase 1 first.
3. **TIN-at-rest:** Option A (pgcrypto/Vault) vs B (function + tokenCrypto). Recommend A.
4. **Scope of forms:** 1099-NEC only first, or also 1099-MISC? Recommend NEC-only to start.

## 9. Rough effort

- Phase 1 (CSV + payer config + filing-records table + server assembler + Receipt-ID
  capture UI): **~2–3 days.**
- TIN-at-rest (Option A): **~½ day**, independent and reusable.
- Phase 2 (A2A transmit + ack polling + corrections automation): **~3–5 days**, only if needed.

## 10. References (re-confirm at build time)

- IRS **Pub 5717** — IRIS A2A submission/transmission guide.
- IRIS Taxpayer Portal user guide + CSV templates.
- IRIS **Schemas & Business Rules** package (record layouts, validation).
- IRS "**E-file information returns**" + the **10-return** e-file requirement.
- Existing build-on code: `form1099Math.ts`, `Form1099WorklistView.tsx`,
  `accounting.v_1099_vendor_totals`, `accounting.vendor_tax_info`.
