-- WorkTrackAccounting — backfill job <-> document links + job customers from existing numbers.
--
-- Jobs carry free-text est_number / inv_number that predate the accounting module; the
-- QBO-imported estimates/invoices kept those numbers but have job_id = null (QBO has no concept
-- of a WorkTrack job). This one-time backfill connects them by number so the imported documents
-- become first-class linked documents on the job, and fills each job's customer from its matched
-- document.
--
-- Safe by construction: estimate_number / invoice_number are unique and est_number is 1:1 with
-- jobs, so those links are unambiguous. Only invoice_number can be shared by more than one job,
-- so the invoice->job link is set ONLY when exactly one job references that invoice (the customer
-- fill is unaffected — all jobs sharing one invoice share its single customer). Idempotent: every
-- statement only fills NULLs, so re-running (or running on a fresh/empty DB) is a no-op.
--
-- ROLLBACK is not automatic (pre-backfill NULLs are not recorded). To undo a specific link, null
-- the job_id / customer_id on the affected row.

-- 1. estimates -> job  (estimate_number is unique; est_number is 1:1 with jobs)
update accounting.estimates e
   set job_id = j.id
  from public.jobs j
 where e.job_id is null
   and coalesce(btrim(j.est_number), '') <> ''
   and e.estimate_number = btrim(j.est_number);

-- 2. invoices -> job  (only when a SINGLE job references this invoice number; skip ambiguous)
update accounting.invoices i
   set job_id = j.id
  from public.jobs j
 where i.job_id is null
   and coalesce(btrim(j.inv_number), '') <> ''
   and i.invoice_number = btrim(j.inv_number)
   and (select count(*) from public.jobs j2 where btrim(j2.inv_number) = i.invoice_number) = 1;

-- 3. job.customer_id <- matched invoice (preferred) or estimate, where the job has none
update public.jobs j
   set customer_id = sub.customer_id
  from (
    select j2.id as job_id,
           coalesce(
             (select i.customer_id from accounting.invoices i
               where i.invoice_number = btrim(j2.inv_number) limit 1),
             (select e.customer_id from accounting.estimates e
               where e.estimate_number = btrim(j2.est_number) limit 1)
           ) as customer_id
      from public.jobs j2
     where j2.customer_id is null
  ) sub
 where j.id = sub.job_id
   and sub.customer_id is not null;
