-- WorkTrackAccounting — Foundation 11/11: read-model views
--
-- security_invoker views so the querying user's RLS (accounting.can_read on
-- accounting tables, public.is_approved_user on core tables) applies. These reuse
-- existing operational data — labor from public.shifts, materials from
-- public.job_inventory × public.inventory.price, the org labor_rate from
-- public.organization_settings — alongside the new ledger.
--
-- NOTE: v_job_costing labor_cost is a reporting approximation (worked minutes ×
-- labor_rate). The authoritative job-cost math lives in the app
-- (src/lib/calculatePartQuote.ts, src/features/jobs/hooks/materialCostUtils.ts).
--
-- This migration is IDEMPOTENT.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS accounting.v_job_costing;
--   DROP VIEW IF EXISTS accounting.v_trial_balance;
--   DROP VIEW IF EXISTS accounting.v_ar_aging;
--   DROP VIEW IF EXISTS accounting.v_ap_aging;

-- Per-job revenue / cost / margin
create or replace view accounting.v_job_costing with (security_invoker = true) as
with labor as (
  select s.job_id,
         sum(greatest(
           extract(epoch from (s.clock_out_time - s.clock_in_time)) / 60.0
             - coalesce(extract(epoch from (s.lunch_end_time - s.lunch_start_time)) / 60.0, 0),
           0)) as labor_minutes
    from public.shifts s
   where s.clock_out_time is not null
     and s.job_id is not null
   group by s.job_id
),
materials as (
  select ji.job_id,
         sum(coalesce(ji.quantity, 0) * coalesce(inv.price, 0)) as material_cost
    from public.job_inventory ji
    join public.inventory inv on inv.id = ji.inventory_id
   group by ji.job_id
),
revenue as (
  select i.job_id,
         sum(il.line_total) as revenue
    from accounting.invoices i
    join accounting.invoice_lines il on il.invoice_id = i.id
   where i.status <> 'void'
     and i.job_id is not null
   group by i.job_id
),
rate as (
  select coalesce((select labor_rate from public.organization_settings where org_key = 'default'), 0) as labor_rate
)
select j.id as job_id,
       j.job_code,
       j.name,
       j.status,
       coalesce(l.labor_minutes, 0) as labor_minutes,
       round(coalesce(l.labor_minutes, 0) / 60.0 * (select labor_rate from rate), 2) as labor_cost,
       coalesce(m.material_cost, 0) as material_cost,
       coalesce(r.revenue, 0) as revenue,
       round(
         coalesce(r.revenue, 0)
         - coalesce(m.material_cost, 0)
         - coalesce(l.labor_minutes, 0) / 60.0 * (select labor_rate from rate),
       2) as margin
  from public.jobs j
  left join labor l     on l.job_id = j.id
  left join materials m on m.job_id = j.id
  left join revenue r   on r.job_id = j.id;

-- Trial balance from posted journal lines
create or replace view accounting.v_trial_balance with (security_invoker = true) as
select a.id as account_id,
       a.account_number,
       a.name,
       a.account_type,
       a.normal_balance,
       coalesce(sum(pl.debit), 0) as total_debit,
       coalesce(sum(pl.credit), 0) as total_credit,
       coalesce(sum(pl.debit), 0) - coalesce(sum(pl.credit), 0) as balance
  from accounting.accounts a
  left join (
    select jl.account_id, jl.debit, jl.credit
      from accounting.journal_lines jl
      join accounting.journal_entries je on je.id = jl.journal_entry_id
     where je.status = 'posted'
  ) pl on pl.account_id = a.id
 group by a.id, a.account_number, a.name, a.account_type, a.normal_balance;

-- AR aging (open customer invoices)
create or replace view accounting.v_ar_aging with (security_invoker = true) as
select i.id as invoice_id,
       i.invoice_number,
       i.customer_id,
       c.display_name as customer_name,
       i.invoice_date,
       i.due_date,
       i.total,
       i.amount_paid,
       i.balance_due,
       case when i.due_date is null then 0 else greatest(current_date - i.due_date, 0) end as days_overdue,
       case
         when i.due_date is null or current_date <= i.due_date then 'current'
         when current_date - i.due_date <= 30 then '1-30'
         when current_date - i.due_date <= 60 then '31-60'
         when current_date - i.due_date <= 90 then '61-90'
         else '90+'
       end as aging_bucket
  from accounting.invoices i
  join accounting.customers c on c.id = i.customer_id
 where i.status in ('sent', 'partially_paid')
   and i.balance_due > 0;

-- AP aging (open vendor bills)
create or replace view accounting.v_ap_aging with (security_invoker = true) as
select b.id as bill_id,
       b.bill_number,
       b.vendor_id,
       v.display_name as vendor_name,
       b.bill_date,
       b.due_date,
       b.total,
       b.amount_paid,
       b.balance_due,
       case when b.due_date is null then 0 else greatest(current_date - b.due_date, 0) end as days_overdue,
       case
         when b.due_date is null or current_date <= b.due_date then 'current'
         when current_date - b.due_date <= 30 then '1-30'
         when current_date - b.due_date <= 60 then '31-60'
         when current_date - b.due_date <= 90 then '61-90'
         else '90+'
       end as aging_bucket
  from accounting.bills b
  join accounting.vendors v on v.id = b.vendor_id
 where b.status in ('open', 'partially_paid')
   and b.balance_due > 0;

grant select on accounting.v_job_costing, accounting.v_trial_balance,
               accounting.v_ar_aging, accounting.v_ap_aging
  to authenticated, service_role;
