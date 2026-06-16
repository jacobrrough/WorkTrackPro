-- WorkTrackAccounting — server-side account-balance aggregation for DATE-WINDOWED reports.
--
-- WHY: reportsService.getAccountBalances aggregated a date-windowed trial balance in the
-- BROWSER — it fetched every posted accounting.journal_lines row for the window (49k+ at
-- production scale) over PostgREST and summed them in JS. That single SELECT exceeds the
-- statement timeout, so Profit & Loss / Balance Sheet / the QBO verification (which all pass a
-- date bound) threw "canceling statement due to statement timeout". The no-window path already
-- uses the pre-aggregated accounting.v_trial_balance view; this gives the windowed path the
-- same server-side GROUP BY.
--
-- The function returns ONE row per account (~160), the SAME column shape as v_trial_balance, so
-- the client row mapper is shared. NULL bound = unbounded on that side (P&L passes a from/to;
-- the Balance Sheet passes only `to`). SECURITY INVOKER (the default): RLS on accounts /
-- journal_lines / journal_entries applies exactly as it did for the direct query.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS accounting.report_account_balances(date, date);

create or replace function accounting.report_account_balances(
  p_from date default null,
  p_to date default null
)
returns table (
  account_id uuid,
  account_number text,
  name text,
  account_type text,
  normal_balance text,
  total_debit numeric,
  total_credit numeric
)
language sql
stable
security invoker
set search_path = accounting, public
as $$
  select a.id as account_id,
         a.account_number::text,
         a.name::text,
         a.account_type::text,
         a.normal_balance::text,
         coalesce(sum(pl.debit), 0) as total_debit,
         coalesce(sum(pl.credit), 0) as total_credit
    from accounting.accounts a
    left join (
      select jl.account_id, jl.debit, jl.credit
        from accounting.journal_lines jl
        join accounting.journal_entries je on je.id = jl.journal_entry_id
       where je.status = 'posted'
         and (p_from is null or je.entry_date >= p_from)
         and (p_to is null or je.entry_date <= p_to)
    ) pl on pl.account_id = a.id
   group by a.id, a.account_number, a.name, a.account_type, a.normal_balance;
$$;

revoke all on function accounting.report_account_balances(date, date) from public;
grant execute on function accounting.report_account_balances(date, date) to authenticated, service_role;
