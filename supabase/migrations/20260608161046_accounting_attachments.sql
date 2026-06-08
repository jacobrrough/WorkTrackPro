-- WorkTrackAccounting — document attachments on accounting entities
--
-- Adds one additive table that lets any accounting entity carry uploaded document
-- attachments (a vendor bill PDF, a scanned invoice, a receipt image, …):
--   • accounting.attachments — one row of FILE METADATA per uploaded document. The
--                              file itself lives in the private Supabase Storage bucket
--                              `accounting-attachments` at storage_path; this row is the
--                              metadata + the polymorphic link to its host entity.
--
-- These rows are pure METADATA. Attaching a document moves NO money, so per invariant G3
-- it posts NO journal entry — the same rationale the dimensions migration (013), the
-- custom-fields migration (019) and the budgets migration (017) document for pure
-- reporting/control features. There is no debit/credit, no post_journal_entry call and no
-- posting math anywhere in this migration.
--
-- ADDITIVE-ONLY (G1): every object lives in schema `accounting`. This adds NO columns to
-- any existing table — attachments live in their own table keyed by (entity_type,
-- entity_id). Existing invoice/bill/journal_entry rows and the INSERT statements that
-- create them are byte-for-byte unchanged, so this cannot break existing forms at the DB
-- layer. The only cross-schema FK is on the accounting (child) side -> public.profiles(id)
-- for uploaded_by (matches every other accounting table's created_by precedent). NO
-- public.* table or column is altered or dropped. No existing accounting.* table is
-- altered.
--
-- entity_id is a PLAIN uuid with NO cross-table foreign key, on purpose: one column
-- cannot FK six different parent tables (invoice/bill/journal_entry/account/vendor/
-- customer), and a hard FK would couple an attachment to a single entity table. Integrity
-- is by application + the entity_type CHECK. This mirrors the deliberate "plain uuid, no
-- FK" precedent on accounting.custom_field_values.entity_id and accounting.audit_log
-- .record_id, keeping the feature additive and decoupled.
--
-- STORAGE (runbook step): the file bytes live in a PRIVATE Storage bucket named
-- `accounting-attachments` (served to the client via short-lived signed URLs, never a
-- public URL). A Storage bucket CANNOT be created in SQL — it must be created once in the
-- Supabase Dashboard (Storage → New bucket → name `accounting-attachments`, Public = OFF).
-- This migration only adds the RLS policies on storage.objects that gate that bucket; the
-- bucket itself is a manual runbook step. Until the bucket exists, uploads fail by design.
--
-- RLS/AUDIT (G2, G7): the table is wired with accounting._apply_standard_table
-- (read = can_read(), write = can_write(), plus the audit() and touch_updated_at()
-- triggers), exactly like accounting.custom_field_defs in migration 019. The four
-- storage.objects policies gate the bucket with the SAME accounting.can_read() /
-- accounting.can_write() guards (not plain `authenticated`) so a user who cannot read the
-- accounting schema cannot read the files either.
--
-- This migration is IDEMPOTENT (CREATE TABLE IF NOT EXISTS, guarded index creation via a
-- pg_indexes check, idempotent _apply_standard_table, DROP/CREATE storage policies,
-- additive grants).
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "acct attachments storage delete" ON storage.objects;
--   DROP POLICY IF EXISTS "acct attachments storage update" ON storage.objects;
--   DROP POLICY IF EXISTS "acct attachments storage insert" ON storage.objects;
--   DROP POLICY IF EXISTS "acct attachments storage read" ON storage.objects;
--   DROP INDEX IF EXISTS accounting.idx_acct_attachments_entity;
--   DROP TABLE IF EXISTS accounting.attachments CASCADE;
--   -- (the `accounting-attachments` Storage bucket, if created, is removed in the Dashboard.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Attachments — one row of file metadata per uploaded document
-- ─────────────────────────────────────────────────────────────────────────────
-- entity_type partitions an attachment by which accounting entity it is filed against;
-- entity_id is the host row's id (a plain uuid, NO cross-table FK — see the header).
-- bucket/storage_path locate the file bytes in Storage (bucket defaults to the private
-- `accounting-attachments` bucket). filename is the original upload name shown in the UI;
-- mime_type/byte_size describe the bytes. uploaded_by is the uploader (set-null on profile
-- delete, matching every accounting table's created_by). (bucket, storage_path) is unique
-- so the same object is never linked twice.
create table if not exists accounting.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (
    entity_type in ('invoice', 'bill', 'journal_entry', 'account', 'vendor', 'customer')
  ),
  entity_id uuid not null,               -- plain uuid, NO cross-table FK (see header)
  bucket text not null default 'accounting-attachments',
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  byte_size bigint not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

-- Powers the per-entity list fetch "all attachments for this entity".
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_attachments_entity'
  ) then
    create index idx_acct_attachments_entity
      on accounting.attachments (entity_type, entity_id);
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper.
select accounting._apply_standard_table('attachments');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Storage RLS for the private `accounting-attachments` bucket
-- ─────────────────────────────────────────────────────────────────────────────
-- Gate every object in the bucket with the SAME accounting guards as the table (NOT plain
-- `authenticated`): a reader needs accounting.can_read(), a writer accounting.can_write().
-- Drop-then-create keeps this idempotent on every PG version (the newer accounting
-- migrations avoid `create policy if not exists`). The bucket itself is created in the
-- Dashboard (runbook step in the header) — these policies only gate it.
drop policy if exists "acct attachments storage read" on storage.objects;
create policy "acct attachments storage read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'accounting-attachments' and accounting.can_read());

drop policy if exists "acct attachments storage insert" on storage.objects;
create policy "acct attachments storage insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'accounting-attachments' and accounting.can_write());

drop policy if exists "acct attachments storage update" on storage.objects;
create policy "acct attachments storage update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'accounting-attachments' and accounting.can_write())
  with check (bucket_id = 'accounting-attachments' and accounting.can_write());

drop policy if exists "acct attachments storage delete" on storage.objects;
create policy "acct attachments storage delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'accounting-attachments' and accounting.can_write());

-- Belt-and-suspenders explicit grants (default privileges already cover new objects;
-- restated for unambiguous current-object grants, matching sibling migrations).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
