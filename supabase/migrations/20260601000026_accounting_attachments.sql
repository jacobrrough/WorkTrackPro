-- WorkTrackAccounting — DOCUMENT MANAGEMENT (HELD / UNVERIFIED — NOT FOR FILING)
--                        additive metadata for receipts/contracts/files attached to
--                        accounting entities. Files live in the EXISTING storage bucket.
--
-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  UNVERIFIED — NOT FOR FILING. This module is built FLAG-DARK and UNVERIFIED.   ║
-- ║  It requires CPA and/or security sign-off before it is enabled. Every screen   ║
-- ║  and preview this module renders must carry the UnverifiedBanner /             ║
-- ║  "UNVERIFIED — NOT FOR FILING" disclaimer (enforced in the UI lane; the DB     ║
-- ║  cannot render a banner). Encryption-at-rest is DEFERRED to the Phase E         ║
-- ║  security module — files sit UNENCRYPTED in the bucket until then (see below).  ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- WHAT THIS MODULE DOES
--   Lets a user attach receipts / contracts / supporting files to an accounting
--   entity (invoice, bill, payment, vendor_payment, journal_entry, fixed_asset) and
--   list / preview / delete them. Files are stored as objects in the EXISTING
--   `attachments` storage bucket under a new `accounting/<entity_type>/<entity_id>/`
--   path prefix; THIS table holds only the METADATA (where the object is, its name,
--   mime, size, who uploaded it). The browser writes (1) the storage object and
--   (2) one row here — nothing else.
--
-- ── DOCUMENT STORAGE IS IN SCOPE FOR THIS MODULE (reuse, do NOT invent) ───────────
--   Per the held-module scope, this module REUSES the EXISTING `attachments` storage
--   bucket and its EXISTING bucket-wide authenticated storage.objects RLS (verified in
--   the repo's CREATE_STORAGE_BUCKETS.sql / FIX_STORAGE_RLS_FOR_PARTS.sql — any
--   authenticated user, any path within the bucket). We add NO new bucket and NO new
--   storage.objects policy: the `accounting/` prefix is already covered by the existing
--   `bucket_id = 'attachments'` policies. This migration touches ONLY schema accounting.
--   IMPORTANT SECURITY CAVEAT FOR THE HUMAN (see WHAT A HUMAN MUST VERIFY in the build
--   report): those bucket policies are PERMISSIVE — any authenticated user can read/
--   delete ANY object in the bucket if they know its path. The RLS on THIS table gates
--   the METADATA (can_read / can_write), but the OBJECT bytes are only as protected as
--   the bucket. Finer per-object storage authz (and at-rest encryption) is a Phase E item.
--
-- WHY THIS SHAPE — additive, schema `accounting` only (G1; ZERO public.* DDL)
--   The EXISTING public.attachments table is OWNER-SPECIFIC (its own columns/owner model)
--   and CANNOT be extended to carry accounting entities without an ALTER — which is
--   BANNED (G1). So we add a NEW, purely-additive accounting.attachments table with a
--   POLYMORPHIC (entity_type, entity_id) owner reference. public.attachments is NOT
--   touched in any way. The only cross-schema FK is uploaded_by -> public.profiles(id)
--   ON DELETE SET NULL (same additive pattern as created_by everywhere else; public.
--   profiles is NOT altered).
--
-- POLYMORPHIC entity_id HAS NO DB FOREIGN KEY (decision, disclosed — NOT a blocker):
--   A single column cannot FK to six different parent tables at once, so entity_id is a
--   plain uuid validated by the app (the upload control is always mounted INSIDE the
--   entity's own detail screen, which bounds the value to a real, same-tenant entity).
--   entity_type is CHECK-constrained to the six supported kinds. Orphan cleanup when a
--   parent is voided/deleted is APP-LAYER in v1 (the service cascades: remove storage
--   objects + delete these rows). A DB-level safety net (per-entity trigger or a nightly
--   sweep) is a documented follow-up. This is the standard polymorphic-attachment trade-
--   off and is called out in the build report's "WHAT A HUMAN MUST VERIFY" list.
--
-- NO MONEY MOVED, NO JOURNAL ENTRY (G3 is VACUOUS):
--   Attaching/removing a document moves ZERO money and posts ZERO journal entries. There
--   is NO post_journal_entry call anywhere in this module and NO ledger write. G3 holds
--   trivially because there is nothing to post. The "unbalanced-JE rejected" proof is
--   therefore N/A; the substitute adversarial proofs for this migration are:
--     (1) a non-role user is DENIED by RLS on accounting.attachments (read AND write);
--     (2) inserting an attachment row leaves the general ledger UNCHANGED
--         (journal_entries / journal_lines row counts do not move);
--     (3) entity_type is CHECK-constrained — an unknown kind is rejected.
--
-- MONEY MATH (G6): N/A. size_bytes is a plain BYTE COUNT (bigint), NOT currency — no
--   numeric(14,2) column and no cents logic appears in this module.
--
-- ENCRYPTION-AT-REST IS DEFERRED (G8 — phased, not half-done): files are stored
--   UNENCRYPTED. The Phase E security module adds at-rest (and possibly client-side)
--   encryption ADDITIVELY (new columns/functions; this table is forward-compatible — a
--   future `encryption_key_id` / `is_encrypted` column can be added with ALTER ADD COLUMN,
--   which is additive and allowed on an accounting.* table). Until then the UnverifiedBanner
--   on every surface discloses that attachments are unencrypted.
--
-- This migration is IDEMPOTENT (create table if not exists; guarded index creation;
--   _apply_standard_table is drop/create of policies + triggers).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS accounting.attachments CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) accounting.attachments — polymorphic document metadata (additive; NOT money)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per stored file. Rows are IMMUTABLE after insert (replace = delete + new
-- upload), so there is intentionally NO updated_at column and NO touch trigger
-- (_apply_standard_table is called with p_has_updated_at = false below).
create table if not exists accounting.attachments (
  id uuid primary key default gen_random_uuid(),
  -- The kind of accounting entity this file is attached to. CHECK-constrained to the
  -- six supported entities so an unknown kind is rejected at the DB. (payment and
  -- vendor_payment are supported here for when their standalone detail screens exist;
  -- v1 attaches payment-level docs via the invoice/bill detail — see build report.)
  entity_type text not null check (entity_type in (
    'invoice',
    'bill',
    'payment',
    'vendor_payment',
    'journal_entry',
    'fixed_asset'
  )),
  -- SOFT reference to the parent entity's id. NO foreign key on purpose: a single column
  -- cannot FK to six parent tables, and the app bounds this value (the upload control is
  -- mounted inside the entity's own detail screen). Integrity + orphan cleanup are app-
  -- layer in v1 (documented).
  entity_id uuid not null,
  -- Path of the object WITHIN the existing `attachments` bucket, e.g.
  --   'accounting/invoice/<entity_id>/<uuid>.pdf'
  -- The bucket name is NOT stored here (it is the fixed existing 'attachments' bucket,
  -- referenced by a constant in the service layer).
  storage_path text not null,
  -- Original display filename (e.g. 'receipt-2026-05.pdf').
  filename text not null,
  -- MIME type from File.type (e.g. 'application/pdf', 'image/png'); nullable because the
  -- browser may not always provide one.
  content_type text,
  -- File size in BYTES from File.size (NOT money — no cents rule applies). bigint so large
  -- files do not overflow int4.
  size_bytes bigint,
  -- Who uploaded it. FK on this (accounting/child) side; ON DELETE SET NULL preserves the
  -- attachment row if the profile is later removed (mirrors created_by everywhere else).
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Indexes (guarded; mirrors every prior accounting migration).
do $$
begin
  -- Primary access path: list all attachments for one entity, newest first.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_attachments_entity') then
    create index idx_acct_attachments_entity
      on accounting.attachments(entity_type, entity_id, created_at desc);
  end if;
  -- Lookup / dedupe by storage path (e.g. to find the row for an object on delete, and
  -- to detect a duplicate path). Unique: one metadata row per stored object.
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='uq_acct_attachments_path') then
    create unique index uq_acct_attachments_path
      on accounting.attachments(storage_path);
  end if;
  -- Covering index for the uploaded_by FK (silences unindexed_foreign_keys; supports
  -- "files I uploaded" style lookups and keeps the ON DELETE SET NULL efficient).
  if not exists (select 1 from pg_indexes where schemaname='accounting' and indexname='idx_acct_attachments_uploaded_by') then
    create index idx_acct_attachments_uploaded_by
      on accounting.attachments(uploaded_by) where uploaded_by is not null;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Standard RLS + audit wiring (read=can_read, write=can_write)
-- ─────────────────────────────────────────────────────────────────────────────
-- Attaching a receipt to a bill is ordinary bookkeeping, so write = can_write()
-- (accountant + accounting_admin + global admin), NOT admin-only. Rows are immutable
-- (no updated_at) -> p_has_updated_at = false, so NO touch trigger is attached. The
-- audit trigger (insert/update/delete) IS attached so every attach/remove is logged in
-- accounting.audit_log (the metadata row is logged; the storage object bytes are not —
-- noted for the human).
select accounting._apply_standard_table('attachments', false);

-- Belt-and-suspenders explicit grants (default privileges from migration 001 already
-- cover new objects; restated for unambiguous current-object grants, matching the
-- convention in migrations 007/013/016/022/025).
grant select, insert, update, delete on all tables in schema accounting to authenticated, service_role;
grant usage, select on all sequences in schema accounting to authenticated, service_role;
grant execute on all functions in schema accounting to authenticated, service_role;
