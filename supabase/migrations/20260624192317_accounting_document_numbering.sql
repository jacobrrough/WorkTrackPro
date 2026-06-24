-- WorkTrackAccounting — automatic sequential document numbers for invoices & estimates
--
-- PROBLEM THIS FIXES: accounting.invoices.invoice_number / accounting.estimates.estimate_number
-- were nullable and never assigned by the app (only the QuickBooks import set them), so every
-- in-app invoice/estimate stayed numberless and rendered as the literal word "Draft" forever —
-- even after it was sent/posted.
--
-- This migration makes EVERY insert path (the create form, convert_estimate_to_invoice,
-- void_and_reissue_invoice, progress billing, recurring templates, …) auto-assign the next
-- sequential, prefixed number via a BEFORE INSERT trigger — UNLESS a number is already supplied
-- (the QuickBooks import passes the real QBO number, which the trigger leaves untouched).
--
-- Format + next value are admin-configurable in accounting.settings:
--   invoice_number_format  = {"prefix":"INV-","pad":5}   -> INV-08127, INV-08128, …
--   estimate_number_format = {"prefix":"EST-","pad":4}   -> EST-1386,  EST-1387,  …
-- The numeric run is driven by two dedicated sequences (atomic, gap-tolerant — the same
-- mechanism accounting.journal_entry_number_seq already uses). Starting values match the shop's
-- live QuickBooks run: next invoice 08127, next estimate 1386.
--
-- Prefixes keep these distinct from QuickBooks' bare numbers, so the two systems never collide
-- while they run side by side. A number can still be overridden by hand (invoicesService /
-- estimatesService.setNumber) for reconciliation; the column's UNIQUE constraint rejects dupes.
--
-- This migration is IDEMPOTENT and purely additive.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS assign_invoice_number  ON accounting.invoices;
--   DROP TRIGGER IF EXISTS assign_estimate_number ON accounting.estimates;
--   DROP FUNCTION IF EXISTS accounting.assign_document_number();
--   DROP FUNCTION IF EXISTS accounting.format_document_number(text, bigint);
--   DROP SEQUENCE IF EXISTS accounting.invoice_number_seq;
--   DROP SEQUENCE IF EXISTS accounting.estimate_number_seq;
--   DELETE FROM accounting.settings WHERE setting_key IN ('invoice_number_format','estimate_number_format');

-- 1) Dedicated number runs. Created at the shop's current QuickBooks position ONLY if absent, so
--    re-running this migration never rewinds a live sequence (which would re-issue used numbers).
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname = 'accounting' and c.relname = 'invoice_number_seq'
  ) then
    create sequence accounting.invoice_number_seq start with 8127 minvalue 1;
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname = 'accounting' and c.relname = 'estimate_number_seq'
  ) then
    create sequence accounting.estimate_number_seq start with 1386 minvalue 1;
  end if;
end $$;

-- 2) Format config (admin-editable). on conflict do nothing -> never clobbers a later admin edit.
insert into accounting.settings (setting_key, setting_value) values
  ('invoice_number_format',  '{"prefix":"INV-","pad":5}'::jsonb),
  ('estimate_number_format', '{"prefix":"EST-","pad":4}'::jsonb)
on conflict (setting_key) do nothing;

-- 3) Format a raw sequence value into a prefixed, zero-padded document number.
--    pad is a MINIMUM width: a value longer than pad is never truncated (greatest()).
create or replace function accounting.format_document_number(p_kind text, p_n bigint)
returns text
language plpgsql
stable
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_cfg    jsonb;
  v_prefix text;
  v_pad    int;
  v_digits text := p_n::text;
begin
  select setting_value into v_cfg
    from accounting.settings
   where setting_key = p_kind || '_number_format';
  v_prefix := coalesce(v_cfg->>'prefix', '');
  v_pad    := coalesce((v_cfg->>'pad')::int, 0);
  return v_prefix || lpad(v_digits, greatest(v_pad, length(v_digits)), '0');
end;
$$;

-- 4) BEFORE INSERT trigger: stamp the next number when the row doesn't already carry one.
--    A supplied number (e.g. the QuickBooks import's real QBO number) is left untouched, and the
--    sequence is NOT advanced for it — so imports never burn an in-app number.
create or replace function accounting.assign_document_number()
returns trigger
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
begin
  if tg_table_name = 'invoices' then
    if new.invoice_number is null or btrim(new.invoice_number) = '' then
      new.invoice_number := accounting.format_document_number(
        'invoice', nextval('accounting.invoice_number_seq'));
    end if;
  elsif tg_table_name = 'estimates' then
    if new.estimate_number is null or btrim(new.estimate_number) = '' then
      new.estimate_number := accounting.format_document_number(
        'estimate', nextval('accounting.estimate_number_seq'));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_invoice_number on accounting.invoices;
create trigger assign_invoice_number
  before insert on accounting.invoices
  for each row execute function accounting.assign_document_number();

drop trigger if exists assign_estimate_number on accounting.estimates;
create trigger assign_estimate_number
  before insert on accounting.estimates
  for each row execute function accounting.assign_document_number();

-- 5) Grants (belt-and-suspenders; the schema's ALTER DEFAULT PRIVILEGES already cover these).
grant usage, select on accounting.invoice_number_seq, accounting.estimate_number_seq
  to authenticated, service_role;
grant execute on function accounting.format_document_number(text, bigint) to authenticated, service_role;
grant execute on function accounting.assign_document_number() to authenticated, service_role;
