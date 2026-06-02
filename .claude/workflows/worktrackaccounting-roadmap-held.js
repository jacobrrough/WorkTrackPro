export const meta = {
  name: 'worktrackaccounting-roadmap-held',
  description:
    'Autonomously build the HELD / high-risk WorkTrackAccounting modules FLAG-DARK and UNVERIFIED (user explicitly authorized): import/migration, notification delivery, document management, payroll, and security hardening. Sequential + gated on MECHANICS/isolation only — domain correctness (tax math, import fidelity, security posture) is loudly disclaimed in-app and listed for human sign-off. Runs on the claude/accounting-held-unverified branch; never auto-commits.',
  phases: [
    { title: 'IMPORT migration' },
    { title: 'NOTIFY delivery' },
    { title: 'DOCS attachments' },
    { title: 'C2 Payroll' },
    { title: 'E Security hardening' },
    { title: 'Summary' },
  ],
};

const HELD_PIPELINE =
  'C:/Users/jrrou/WorkTrackPro/.claude/worktrees/romantic-curran-565e37/.claude/workflows/worktrackaccounting-module-held.js';

const PER_MODULE_RESERVE = 300_000;

const MODULES = [
  {
    id: 'IMPORT',
    phase: 'IMPORT migration',
    args:
      'IMPORT/MIGRATION (UNVERIFIED) — Import historical data from QuickBooks Online (CSV/JSON export), QuickBooks Desktop (IIF), and generic Excel/CSV into the accounting schema. Additive tables: accounting.import_batches (source qbo|qbd|csv, status, file_meta, summary jsonb) + accounting.import_staging (batch_id, raw jsonb, mapped jsonb, status, error). Build client-side parsers for IIF + CSV + QBO export shapes; a chart-of-accounts mapping wizard (source account -> accounting.accounts); a DRAFT import that, only on explicit admin commit, posts BALANCED journal entries via post_journal_entry using 3050 Opening Balance Equity / 2050 Opening Balance Liabilities as the offset for opening balances; dedup by content hash; nothing touches the ledger without admin confirmation. UnverifiedBanner on every screen. HUMAN MUST VERIFY: account mapping, no double-posting, opening balances reconcile to the source trial balance. Build per the held pipeline + all invariants.',
  },
  {
    id: 'NOTIFY',
    phase: 'NOTIFY delivery',
    args:
      'NOTIFICATION DELIVERY (UNVERIFIED) — Wire accounting events to the EXISTING app notification system (public.system_notifications via the existing notification service — this cross-schema delivery is IN SCOPE for this module). Events: invoice sent / overdue, bill due soon, low bank balance, upcoming tax-filing deadline (from the C1 calendar). Additive accounting.notification_rules (event_type, threshold, enabled). Build a dispatcher: app-side for event-driven ones, and an ENV-GATED (default OFF) Netlify scheduled function for the time-based ones, creating notifications via the existing service. A preferences surface. All accounting DATA stays in accounting.*; only delivery calls the existing notification API. UnverifiedBanner where config shows. Build per the held pipeline + all invariants.',
  },
  {
    id: 'DOCS',
    phase: 'DOCS attachments',
    args:
      'DOCUMENT MANAGEMENT (UNVERIFIED) — Attach receipts/contracts/files to accounting entities (invoices, bills, payments, journal entries, fixed assets). Reuse the EXISTING storage bucket + attachment patterns (this storage use is IN SCOPE). Additive accounting.attachments (entity_type, entity_id, storage_path, filename, content_type, size_bytes, uploaded_by) with RLS + audit. Build an upload/list/delete control mounted on the relevant detail screens, with image/PDF preview. Encryption-at-rest is DEFERRED to the security module (note it). UnverifiedBanner on the attachment UI. Build per the held pipeline + all invariants.',
  },
  {
    id: 'C2-PAYROLL',
    phase: 'C2 Payroll',
    args:
      'PAYROLL (HIGH RISK, UNVERIFIED — NOT FOR FILING) — Full payroll behind the flag. Additive tables: employees (W-4/DE-4 fields; link to public.profiles where applicable), pay_schedules, pay_runs, paychecks (gross, taxes jsonb, deductions jsonb, net; hours sourced from public.shifts READ-ONLY), payroll_tax_tables (admin-updatable; seed from OFFICIAL published values — IRS Pub 15-T federal withholding + FICA/FUTA/Medicare; CA EDD UI/ETT/SDI/PIT — CITE the source doc + revision in comments), payroll_liabilities; RLS via can_payroll(). Build: employee management; a pay-run that computes federal (FICA/FUTA/Medicare) + CA (UI/ETT/SDI/PIT) withholding from the updatable tables, sources hours from shifts, and posts a BALANCED payroll journal entry (Dr wage/tax expense, Cr cash + payroll liabilities) via post_journal_entry; a paystub view; W-2 / 1099-NEC / DE-9C report STUBS; a NACHA file generator STUB (NO real ACH). Admin tax-table UI. PROMINENT UnverifiedBanner on EVERY payroll screen/export. HUMAN MUST VERIFY (extensive): every rate/bracket vs current IRS Pub 15-T & CA EDD, withholding formulas, statutory deductions, NACHA format, filing forms — nothing is filing-grade until a payroll professional signs off. Do NOT halt on the correctness stop-condition — build-then-disclaim. Build per the held pipeline + all invariants.',
  },
  {
    id: 'E-SECURITY',
    phase: 'E Security hardening',
    args:
      'SECURITY HARDENING (Phase E, UNVERIFIED) — Additive, behind the flag, NEVER drop existing columns/tables. (1) pgcrypto field encryption: add encrypted bytea columns + SECURITY DEFINER accessor functions for sensitive fields (vendors.tax_id, bank_accounts.mask, employees SSN/wages) using pgp_sym_encrypt with a key from Supabase Vault; keep plaintext columns during transition and DOCUMENT the cutover. (2) Tamper-evident audit: populate the accounting.audit_log hash-chain columns (prev_hash/row_hash/chain_seq) via pgcrypto digest inside accounting.audit(), plus a verify-chain function. (3) RBAC management UI over accounting.user_roles (grant/revoke; accounting_admin only). (4) A backup/restore admin screen STUB documenting pg_dump + AES (NO destructive actions). (5) Rate-limit / input-hardening on the Netlify functions. UnverifiedBanner on security screens. HUMAN MUST VERIFY: key management/rotation, encryption coverage, hash-chain integrity, backup/restore procedure — needs a security review. Build per the held pipeline + all invariants.',
  },
];

const results = [];
let stoppedReason = 'completed the held batch IMPORT → E-SECURITY';

for (const m of MODULES) {
  if (budget.total && budget.remaining() < PER_MODULE_RESERVE) {
    stoppedReason = `token budget reserve reached before ${m.id} (${Math.round(budget.remaining() / 1000)}k left)`;
    log(stoppedReason);
    break;
  }

  phase(m.phase);
  log(`▶ ${m.id}: building HELD/UNVERIFIED module (mechanics+isolation gated; correctness disclaimed).`);

  let res = null;
  try {
    res = await workflow({ scriptPath: HELD_PIPELINE }, m.args);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    stoppedReason = `${m.id} pipeline threw: ${msg}`;
    log(`✖ ${stoppedReason}`);
    results.push({ id: m.id, passed: false, error: msg });
    break;
  }

  const passed = !!(res && res.passed);
  results.push({
    id: m.id,
    passed,
    attempts: res && res.attempts,
    humanMustVerify: (res && res.humanMustVerify) || [],
    verdict: res && res.verdict ? { pass: res.verdict.pass, blocking: res.verdict.blocking } : null,
  });

  if (!passed) {
    stoppedReason = `${m.id} did NOT pass mechanical review after retries — stopping (later modules build on this one).`;
    log(`✖ ${stoppedReason}`);
    break;
  }
  log(`✅ ${m.id} mechanically green (UNVERIFIED). Left uncommitted on claude/accounting-held-unverified.`);
}

phase('Summary');
const summary = await agent(
  `Close out the HELD/UNVERIFIED autonomous run for the user. Produce:
1) Per-module table: id · mechanical pass/fail · attempts.
2) A CONSOLIDATED "WHAT A HUMAN MUST VERIFY BEFORE ENABLING" list, grouped by module (especially payroll tax rates/formulas, import fidelity, and security/encryption/key posture). Pull from each module's humanMustVerify.
3) FINAL whole-worktree sweep (verbatim): npm run typecheck; npm run test; build with VITE_ACCOUNTING_ENABLED UNSET and PROVE dist has zero accounting code; git status --short. Do NOT commit.
4) State plainly: these modules are MECHANICALLY green and fully flag-dark, but NONE is domain-verified — they must NOT be enabled until a CPA (payroll/tax) and a security reviewer sign off. This branch (claude/accounting-held-unverified) must be marked DO-NOT-MERGE until then.

Machine results: ${JSON.stringify(results)}
Stop reason: ${stoppedReason}`,
  { label: 'held-summary', phase: 'Summary' }
);

return { branch: 'claude/accounting-held-unverified', results, stoppedReason, summary };
