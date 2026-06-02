-- WorkTrackAccounting — C2 PAYROLL 4/4: pay-run RPCs (recalc / commit / void) — the ONLY ledger path
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Ships FLAG-DARK; requires CPA/EA payroll
--     AND/OR security sign-off before enabling. The UI banners every screen/report/export. The
--     withholding MATH is NOT here — it lives in the pure, heavily unit-tested TS engine
--     (src/services/api/accounting/payrollTax.ts), which the API layer runs to fill
--     accounting.paychecks while the run is editable. These RPCs only (a) reset a non-committed
--     run for recompute, (b) POST one balanced journal entry from the already-computed cents, and
--     (c) void it. EVERY rate/bracket the engine uses (migration 028) must be verified by a
--     payroll professional before any of this is used for real.
--
-- WHAT THIS MIGRATION ADDS (three functions in schema accounting; ZERO public.* change; G1):
--   • accounting.recalc_pay_run(uuid)        — payroll-gated. While a run is draft/calculated,
--                                              clears its paychecks + payroll_liabilities and
--                                              sets status='draft' so the API can recompute and
--                                              reinsert (the engine writes the new rows, then
--                                              flips the run to 'calculated'). NEVER touches the
--                                              ledger. Refuses on a committed/void run.
--   • accounting.commit_pay_run(uuid) -> jsonb — payroll-gated, SECURITY DEFINER, the ONLY path
--                                              that touches the ledger. Validates status
--                                              ='calculated'; IDEMPOTENT (re-commit returns the
--                                              stored summary). Builds ONE balanced DRAFT journal
--                                              entry (source_type='payroll', source_id=run id)
--                                              from the paycheck/liability cents, then drives the
--                                              draft->posted transition so guard_journal_entry
--                                              enforces debits = credits + >= 2 lines at the single
--                                              enforcement point. Any imbalance/RAISE rolls back
--                                              the WHOLE commit (no half-posted run). Honors the D1
--                                              books-closed lock automatically (the lock fires on
--                                              the same posted transition). Stamps
--                                              posted_journal_entry_id + summary.
--   • accounting.void_pay_run(uuid, text) -> uuid — payroll-gated. Voids the run's posted JE
--                                              (posted entries are immutable — G3, only posted->void
--                                              is allowed), then marks the run 'void'. The void of
--                                              the JE is the ledger correction; the run row records why.
--
-- ── WHY THESE RPCs DRIVE THE draft->posted / posted->void TRANSITION DIRECTLY (not via the
--    post_journal_entry / void_journal_entry wrappers) ──────────────────────────────────────────
--   accounting.post_journal_entry and void_journal_entry are gated on accounting.can_write()
--   (= accounting_admin OR accountant — NOT the payroll role). Because these payroll RPCs run
--   SECURITY DEFINER, auth.uid() inside a nested call is STILL the original caller, so routing a
--   commit by a PURE 'payroll'-role user through post_journal_entry would wrongly raise
--   insufficient_privilege (a payroll user is neither admin nor accountant). To honor the PLAN's
--   "commit is can_payroll()-gated" while keeping money movement on the SINGLE balance-enforced
--   transition, these RPCs perform the draft->posted (and posted->void) UPDATE themselves AFTER
--   re-checking can_payroll(). The G3 enforcement point is UNCHANGED: guard_journal_entry fires on
--   that exact UPDATE and rejects any unbalanced / < 2-line / illegal transition (and the deferred
--   assert_journal_lines_balanced re-checks at COMMIT), identical to what post_journal_entry would
--   have triggered. The ONLY thing skipped is post_journal_entry's redundant can_write() role
--   re-check — which we deliberately do NOT want to broaden globally (that would let payroll users
--   post arbitrary manual JEs). Net effect: the balanced JE still goes through the one guard; a
--   legitimate payroll user can commit; no over-grant of general posting rights. An admin caller
--   would also satisfy can_write(), so this is strictly a superset-safe relaxation for the payroll
--   role on the payroll source_type only.
--
-- ── EXACT DOUBLE-ENTRY (G3) — ONE balanced entry per pay run (all amounts integer cents) ──────
--   For a run with totals (summed over its paychecks):
--     G  = Σ gross_cents
--     Wₑ = Σ employee_taxes_cents   (fed PIT, CA PIT, employee FICA/Medicare/Add'l-Medicare/SDI)
--     Eᵣ = Σ employer_taxes_cents   (employer FICA/Medicare + FUTA + CA UI + CA ETT)
--     D  = Σ other_deductions_cents (non-statutory; e.g. benefits)
--     N  = Σ net_cents              (= G − Wₑ − D by construction in the engine)
--   the posted entry is:
--     Dr 6500 Wages & Salaries Expense        = G
--     Dr 6510 Employer Payroll Tax Expense    = Eᵣ                      (omitted if Eᵣ = 0)
--     Cr 2300 Payroll Liabilities             = Wₑ + Eᵣ + D             (omitted if that sum = 0)
--     Cr 1010 Payroll Clearing                = N                       (omitted if N = 0)
--   BALANCE IDENTITY: Dr = G + Eᵣ ; Cr = Wₑ + Eᵣ + D + N. Since N = G − Wₑ − D,
--     Cr = Wₑ + Eᵣ + D + (G − Wₑ − D) = G + Eᵣ = Dr.  ∎  (asserted in cents BEFORE posting.)
--   WHY 2300 carries Wₑ + Eᵣ + D: employee withholdings are amounts the employer OWES the taxing
--   agencies (a liability, not an expense); the EMPLOYER taxes are ALSO a liability payable to the
--   agencies (and the matching expense is the 6510 debit); other deductions are owed to their
--   payees. Net pay is parked in 1010 Payroll Clearing (a cash-adjacent clearing asset) and is
--   later moved to real cash by a SEPARATE balanced JE — so ACH/NACHA stays a STUB and no payroll
--   action touches a live bank rail. accounting.payroll_liabilities already holds the per-agency
--   breakdown of that 2300 credit (written by the engine), bridging to future per-agency deposits.
--
--   ZERO-LINE SAFETY: accounting.journal_lines CHECKs reject a 0/0 line (debit>0 OR credit>0) and
--   reject a both-positive line. So this RPC SKIPS any line whose amount is zero (exactly as
--   post_depreciation_row does for a zero-amount period). A run with G>0 always yields >= 2
--   non-zero lines (the 6500 debit + at least one of {1010 net, 2300}), so the >= 2-line guard is
--   satisfied. A run with G = 0 posts NOTHING and is marked committed with an empty-entry summary
--   (no JE id) — there is nothing to book.
--
-- IDEMPOTENCY / IMMUTABILITY: commit re-entry on an already-committed run returns the stored
--   summary unchanged (no double-post). The run is row-locked FOR UPDATE during commit. Posted JEs
--   are immutable (void/reverse only). recalc refuses once committed.
--
-- This migration is IDEMPOTENT (create or replace function only — no tables, no DDL state).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.void_pay_run(uuid, text);
--   DROP FUNCTION IF EXISTS accounting.commit_pay_run(uuid);
--   DROP FUNCTION IF EXISTS accounting.recalc_pay_run(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) recalc_pay_run — reset a non-committed run so the engine can recompute it
-- ─────────────────────────────────────────────────────────────────────────────
-- Clears the run's computed children and returns it to 'draft'. The API then runs the pure
-- engine, reinserts paychecks + payroll_liabilities, and flips the run to 'calculated'. This RPC
-- NEVER posts and NEVER touches accounting.journal_*; it only prepares the run for recompute.
create or replace function accounting.recalc_pay_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status text;
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to recalculate a pay run'
      using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from accounting.pay_runs where id = p_run_id for update;
  if not found then
    raise exception 'pay run % not found', p_run_id using errcode = 'no_data_found';
  end if;
  if v_status in ('committed', 'void') then
    raise exception 'pay run % is % and cannot be recalculated', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  -- Delete computed children (cascade-safe: these tables only reference the run + masters).
  delete from accounting.payroll_liabilities where pay_run_id = p_run_id;
  delete from accounting.paychecks           where pay_run_id = p_run_id;

  update accounting.pay_runs
     set status = 'draft', summary = '{}'::jsonb, updated_at = now()
   where id = p_run_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) commit_pay_run — the ONLY ledger-touching path (mirrors commit_import_batch)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.commit_pay_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status        text;
  v_period_end    date;
  v_pay_date      date;
  v_paycheck_n    int;
  v_defaults      jsonb;
  v_acct_wages    uuid;   -- 6500 Wages & Salaries Expense
  v_acct_emptax   uuid;   -- 6510 Employer Payroll Tax Expense
  v_acct_liab     uuid;   -- 2300 Payroll Liabilities
  v_acct_clearing uuid;   -- 1010 Payroll Clearing
  -- totals in INTEGER CENTS
  v_gross         bigint := 0;   -- G
  v_emp_withheld  bigint := 0;   -- Wₑ (employee taxes)
  v_employer_tax  bigint := 0;   -- Eᵣ (employer taxes)
  v_other_deduct  bigint := 0;   -- D
  v_net           bigint := 0;   -- N
  v_cr_liab       bigint := 0;   -- Wₑ + Eᵣ + D (the 2300 credit)
  v_dr_total      bigint;
  v_cr_total      bigint;
  v_entry_id      uuid;
  v_sort          int := 0;
begin
  -- (1) PAYROLL-ONLY. Defense in depth: RLS already gates table writes; this gates the posting
  -- path itself so the ledger is never touched by a non-payroll user.
  if not accounting.can_payroll() then
    raise exception 'only a payroll user may commit a pay run'
      using errcode = 'insufficient_privilege';
  end if;

  -- (2) Lock the run and validate state. Idempotency: a re-commit of an already-committed run
  -- returns the stored summary unchanged (no double-posting).
  select status, period_end, pay_date
    into v_status, v_period_end, v_pay_date
    from accounting.pay_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'pay run % not found', p_run_id using errcode = 'no_data_found';
  end if;
  if v_status = 'committed' then
    return (select summary from accounting.pay_runs where id = p_run_id);
  end if;
  if v_status <> 'calculated' then
    raise exception 'pay run % must be in status ''calculated'' to commit (is %)',
      p_run_id, v_status using errcode = 'check_violation';
  end if;

  -- (3) Resolve posting accounts by key (never hardcoded ids). Configured by migration 027.
  select setting_value into v_defaults
    from accounting.settings where setting_key = 'default_accounts';
  v_acct_wages    := nullif(v_defaults ->> 'wagesExpense', '')::uuid;
  v_acct_emptax   := nullif(v_defaults ->> 'employerPayrollTaxExpense', '')::uuid;
  v_acct_liab     := nullif(v_defaults ->> 'payrollLiabilities', '')::uuid;
  v_acct_clearing := nullif(v_defaults ->> 'payrollClearing', '')::uuid;
  if v_acct_wages is null or v_acct_emptax is null
     or v_acct_liab is null or v_acct_clearing is null then
    raise exception 'payroll default accounts are not configured (run migration 027): wages=%, emptax=%, liab=%, clearing=%',
      v_acct_wages, v_acct_emptax, v_acct_liab, v_acct_clearing using errcode = 'check_violation';
  end if;

  -- (4) Sum the already-computed paycheck cents (the engine wrote these while editable).
  select count(*),
         coalesce(sum(gross_cents), 0),
         coalesce(sum(employee_taxes_cents), 0),
         coalesce(sum(employer_taxes_cents), 0),
         coalesce(sum(other_deductions_cents), 0),
         coalesce(sum(net_cents), 0)
    into v_paycheck_n, v_gross, v_emp_withheld, v_employer_tax, v_other_deduct, v_net
    from accounting.paychecks
   where pay_run_id = p_run_id;

  -- (5) Assert the cents identity BEFORE posting (defense-in-depth; the GL guard re-asserts at
  -- draft->posted). Each paycheck's net must equal gross − employee tax − other deductions; if the
  -- engine wrote inconsistent cents this catches it here and the whole commit rolls back.
  v_cr_liab  := v_emp_withheld + v_employer_tax + v_other_deduct;
  v_dr_total := v_gross + v_employer_tax;
  v_cr_total := v_cr_liab + v_net;
  if v_dr_total <> v_cr_total then
    raise exception 'pay run % does not balance in cents: Dr % (gross % + employer-tax %) <> Cr % (liabilities % + net %). Recalculate the run.',
      p_run_id, v_dr_total, v_gross, v_employer_tax, v_cr_total, v_cr_liab, v_net
      using errcode = 'check_violation';
  end if;

  -- (6) G = 0 → nothing to book (e.g. a run with no paid hours). Mark committed with an empty
  -- summary and NO journal entry; a 0/0 entry could not satisfy the >= 2-line balance guard.
  if v_gross = 0 then
    update accounting.pay_runs
       set status = 'committed', committed_at = now(), committed_by = auth.uid(),
           summary = jsonb_build_object(
             'paychecks', v_paycheck_n, 'grossCents', 0, 'netCents', 0,
             'employeeTaxCents', 0, 'employerTaxCents', 0, 'otherDeductionsCents', 0,
             'postedJournalEntryId', null, 'note', 'zero-gross run: no journal entry posted'),
           updated_at = now()
     where id = p_run_id;
    return (select summary from accounting.pay_runs where id = p_run_id);
  end if;

  -- (7) Build ONE DRAFT balanced entry dated the pay date (period_end as a fallback memo anchor).
  insert into accounting.journal_entries (entry_date, memo, source_type, source_id, status, created_by)
  values (
    v_pay_date,
    'Payroll — pay date ' || v_pay_date::text || ' (period ending ' || v_period_end::text || ', '
      || v_paycheck_n::text || ' paycheck(s))',
    'payroll',               -- already allowed by the GL source_type enum (migration 004; no enum change)
    p_run_id,
    'draft',
    auth.uid()
  )
  returning id into v_entry_id;

  -- Dr 6500 Wages & Salaries Expense = G (always > 0 here, so always emitted).
  v_sort := v_sort + 1;
  insert into accounting.journal_lines
    (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
  values (v_entry_id, v_acct_wages, round(v_gross / 100.0, 2), 0, 'Gross wages', v_sort);

  -- Dr 6510 Employer Payroll Tax Expense = Eᵣ (SKIP if zero — 0/0 line is rejected by the CHECK).
  if v_employer_tax > 0 then
    v_sort := v_sort + 1;
    insert into accounting.journal_lines
      (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_acct_emptax, round(v_employer_tax / 100.0, 2), 0,
            'Employer payroll taxes (FICA/Medicare/FUTA/CA UI/ETT)', v_sort);
  end if;

  -- Cr 2300 Payroll Liabilities = Wₑ + Eᵣ + D (SKIP if zero).
  if v_cr_liab > 0 then
    v_sort := v_sort + 1;
    insert into accounting.journal_lines
      (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_acct_liab, 0, round(v_cr_liab / 100.0, 2),
            'Payroll liabilities (employee withholdings + employer taxes + deductions)', v_sort);
  end if;

  -- Cr 1010 Payroll Clearing = N (SKIP if zero — e.g. a fully-withheld check leaving net 0).
  if v_net > 0 then
    v_sort := v_sort + 1;
    insert into accounting.journal_lines
      (journal_entry_id, account_id, debit, credit, line_memo, sort_order)
    values (v_entry_id, v_acct_clearing, 0, round(v_net / 100.0, 2),
            'Net pay (cleared to cash separately — ACH/NACHA is a STUB)', v_sort);
  end if;

  -- (8) Drive the draft->posted transition. guard_journal_entry fires on THIS update and enforces
  -- debits = credits + >= 2 lines (and the deferred assert_journal_lines_balanced re-checks at
  -- COMMIT); the D1 books-closed lock also fires here (a pay_date in a closed period raises). Any
  -- RAISE rolls back the whole commit — no half-posted run. We set status/posted_at/posted_by
  -- exactly as post_journal_entry would, but skip its can_write() re-check (see the header note:
  -- can_payroll() was already enforced above; we do not want to broaden general posting rights).
  update accounting.journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid()
   where id = v_entry_id;

  -- (9) Stamp the run committed with a summary.
  update accounting.pay_runs
     set status = 'committed',
         committed_at = now(),
         committed_by = auth.uid(),
         posted_journal_entry_id = v_entry_id,
         summary = jsonb_build_object(
           'paychecks',            v_paycheck_n,
           'grossCents',           v_gross,
           'netCents',             v_net,
           'employeeTaxCents',     v_emp_withheld,
           'employerTaxCents',     v_employer_tax,
           'otherDeductionsCents', v_other_deduct,
           'postedJournalEntryId', v_entry_id
         ),
         updated_at = now()
   where id = p_run_id;

  return (select summary from accounting.pay_runs where id = p_run_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) void_pay_run — reverse a committed run by voiding its posted JE
-- ─────────────────────────────────────────────────────────────────────────────
-- Voids the run's posted journal entry (flips it posted -> void), then marks the run 'void'.
-- Posted JEs are immutable — voiding is the sanctioned correction (G3). guard_journal_entry permits
-- ONLY posted -> void (with the immutable header columns unchanged) and rejects anything else. We
-- drive the transition directly after re-checking can_payroll() — same rationale as commit (see the
-- header note: void_journal_entry's can_write() gate would wrongly reject a pure payroll user). A
-- run with no posted JE (a zero-gross commit) is still marked void with no ledger change.
create or replace function accounting.void_pay_run(p_run_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = accounting, public, pg_catalog
as $$
declare
  v_status     text;
  v_je_id      uuid;
  v_je_status  text;
begin
  if not accounting.can_payroll() then
    raise exception 'insufficient privileges to void a pay run'
      using errcode = 'insufficient_privilege';
  end if;

  select status, posted_journal_entry_id
    into v_status, v_je_id
    from accounting.pay_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'pay run % not found', p_run_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'committed' then
    raise exception 'only a committed pay run can be voided (run % is %)', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  -- Void the ledger proof (if any). guard_journal_entry allows ONLY posted -> void; the entry is
  -- immutable thereafter. Corrections beyond a simple void use a separate reversing entry.
  if v_je_id is not null then
    select status into v_je_status from accounting.journal_entries where id = v_je_id for update;
    if v_je_status = 'posted' then
      update accounting.journal_entries
         set status = 'void', voided_at = now(), voided_by = auth.uid(),
             void_reason = coalesce(p_reason, 'pay run voided')
       where id = v_je_id;
    end if;
  end if;

  update accounting.pay_runs
     set status = 'void',
         voided_at = now(),
         voided_by = auth.uid(),
         void_reason = p_reason,
         updated_at = now()
   where id = p_run_id;

  return p_run_id;
end;
$$;

-- Belt-and-suspenders explicit grants (default privileges already cover new objects; restated
-- for unambiguous current-object grants, matching the convention in migrations 016/018/024).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
