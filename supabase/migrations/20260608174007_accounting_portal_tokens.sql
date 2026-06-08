-- WorkTrackAccounting — #7 customer portal: opaque access tokens + safe payload RPC
--
-- Adds ONE additive table plus ONE SECURITY DEFINER read function that together let a
-- customer view an invoice (or their statement) WITHOUT an app login, via an opaque link:
--   • accounting.portal_tokens        — one row per minted portal link. We store ONLY the
--                                        SHA-256 HASH of the opaque token, never the raw token
--                                        (a DB leak must not yield usable links). The raw token
--                                        is returned to the admin once, embedded in the emailed
--                                        URL, and never persisted anywhere.
--   • accounting.portal_invoice_payload(p_token_hash text) — the ONLY way the public portal
--                                        function reads anything. It validates the token hash,
--                                        bumps last_used_at, and returns a STRICT, EXPLICIT-COLUMN
--                                        safe projection (NEVER select *). Granted to service_role
--                                        ONLY; revoked from anon + authenticated.
--
-- These rows are pure ACCESS METADATA. Minting/using a portal link moves NO money, so per
-- invariant G3 it posts NO journal entry — the same rationale the attachments (021),
-- invoice_emails (this set's sibling), dimensions (013) and custom-fields (019) migrations
-- document. No debit/credit, no post_journal_entry, no posting math anywhere here.
--
-- ADDITIVE-ONLY (G1): every object lives in schema `accounting`. NO columns added to any
-- existing table. Cross-schema FK only on the accounting (child) side -> public.profiles(id)
-- for created_by. customer_id / invoice_id are real FKs to the accounting AR masters
-- (ON DELETE CASCADE — a token for a deleted customer/invoice is meaningless). NO public.*
-- object is altered or dropped.
--
-- SECURITY MODEL (why this is safe to expose to an unauthenticated portal):
--   • The raw token is high-entropy and opaque; only its SHA-256 hash is stored, so the
--     token_hash column is useless to an attacker who reads the table.
--   • The portal serverless function (portal-invoice.mjs) runs as service_role and is the
--     ONLY grantee of portal_invoice_payload. anon/authenticated cannot call it, so a browser
--     cannot reach the payload directly — it must go through the function (which rate-limits,
--     locks CORS to the site origin, and constant-time validates).
--   • The function pins search_path = accounting, pg_catalog and returns EXPLICIT columns
--     only. It NEVER exposes journal_entry_id, cost, internal notes, created_by, or any other
--     internal field — only an invoice header + lines + customer display name + balance, and
--     (for a 'customer'-scoped token) that customer's open-invoice statement rows.
--   • Expiry + revocation are enforced inside the function: a revoked_at or past expires_at
--     yields NULL (no rows), so a leaked-but-revoked/expired link returns nothing.
--
-- This migration is IDEMPOTENT (CREATE TABLE IF NOT EXISTS, guarded indexes, idempotent
-- _apply_standard_table, CREATE OR REPLACE FUNCTION, idempotent revoke/grant).
--
-- ROLLBACK:
--   REVOKE EXECUTE ON FUNCTION accounting.portal_invoice_payload(text) FROM service_role;
--   DROP FUNCTION IF EXISTS accounting.portal_invoice_payload(text);
--   DROP INDEX IF EXISTS accounting.idx_acct_portal_tokens_customer;
--   DROP INDEX IF EXISTS accounting.idx_acct_portal_tokens_invoice;
--   DROP TABLE IF EXISTS accounting.portal_tokens CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Portal tokens — store the HASH only, never the raw token
-- ─────────────────────────────────────────────────────────────────────────────
-- token_hash is the SHA-256 (hex) of the opaque token the function computes from the URL.
-- scope decides what the link can see: 'invoice' = exactly one invoice; 'customer' = that
-- customer's invoices + statement. invoice_id is required for 'invoice' scope (enforced by the
-- CHECK), NULL for 'customer' scope. expires_at bounds the link's life; revoked_at lets an
-- admin kill it early; last_used_at is bumped on each successful payload read for an audit trail.
create table if not exists accounting.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,       -- SHA-256 of the opaque token — NEVER store the raw token
  customer_id uuid not null references accounting.customers(id) on delete cascade,
  scope text not null check (scope in ('customer', 'invoice')),
  invoice_id uuid references accounting.invoices(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An invoice-scoped token must name its invoice; a customer-scoped token must not.
  constraint portal_tokens_scope_invoice_chk check (
    (scope = 'invoice' and invoice_id is not null)
    or (scope = 'customer' and invoice_id is null)
  )
);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_portal_tokens_invoice'
  ) then
    create index idx_acct_portal_tokens_invoice on accounting.portal_tokens (invoice_id);
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'accounting' and indexname = 'idx_acct_portal_tokens_customer'
  ) then
    create index idx_acct_portal_tokens_customer on accounting.portal_tokens (customer_id);
  end if;
end $$;

-- RLS + audit + touch_updated_at via the standard helper. Admins manage tokens through the
-- authenticated client (read = can_read, write = can_write); the public portal NEVER touches
-- this table directly — it only calls portal_invoice_payload as service_role.
select accounting._apply_standard_table('portal_tokens');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Safe payload RPC — the ONLY read path for the public portal
-- ─────────────────────────────────────────────────────────────────────────────
-- Validates the token hash (exists, not revoked, not expired), bumps last_used_at, and returns
-- a single jsonb document with an EXPLICIT safe projection. Returns NULL when the token is
-- missing/revoked/expired (the function caller treats NULL as "invalid link"). NEVER selects *,
-- NEVER exposes journal_entry_id / income_account_id / internal notes / created_by / cost.
--
-- search_path is pinned (accounting, pg_catalog) per the SECURITY DEFINER hardening pattern.
-- SECURITY DEFINER + the service_role-only grant is what lets the portal function read across
-- RLS without ever handing the browser a Supabase client.
create or replace function accounting.portal_invoice_payload(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = accounting, pg_catalog
as $$
declare
  v_token accounting.portal_tokens%rowtype;
  v_result jsonb;
begin
  if p_token_hash is null or length(p_token_hash) = 0 then
    return null;
  end if;

  -- Defense-in-depth (security review M-1): this function is granted to service_role ONLY, but a
  -- future blanket `grant execute on all functions ... to authenticated` in a later migration
  -- could silently re-expose it. In a SECURITY DEFINER function current_user is the DEFINER, so we
  -- gate on the REQUEST's PostgREST role instead and refuse any caller that is not service_role.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    return null;
  end if;

  -- Look up the token by hash and validate it in one shot. A revoked or expired token
  -- yields no row → return null (no leakage of which condition failed).
  select * into v_token
  from accounting.portal_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  -- Audit the access. Best-effort; never block a valid read on the bump.
  update accounting.portal_tokens
     set last_used_at = now()
   where id = v_token.id;

  -- Build the safe document. EXPLICIT columns only — no internal/posting fields.
  select jsonb_build_object(
    'scope', v_token.scope,
    'customer', (
      select jsonb_build_object(
        'displayName', c.display_name,
        'companyName', c.company_name
      )
      from accounting.customers c
      where c.id = v_token.customer_id
    ),
    -- The invoice(s) this token grants. For 'invoice' scope: exactly the named invoice.
    -- For 'customer' scope: that customer's non-void invoices (most recent first).
    'invoices', coalesce((
      select jsonb_agg(q.doc order by q.invoice_date desc, q.created_at desc)
      from (
        select jsonb_build_object(
          'id', i.id,
          'invoiceNumber', i.invoice_number,
          'invoiceDate', i.invoice_date,
          'dueDate', i.due_date,
          'terms', i.terms,
          'status', i.status,
          'subtotal', i.subtotal,
          'discountTotal', i.discount_total,
          'taxTotal', i.tax_total,
          'total', i.total,
          'amountPaid', i.amount_paid,
          'balanceDue', i.balance_due,
          'memo', i.memo,
          'lines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'description', l.description,
                'quantity', l.quantity,
                'unitPrice', l.unit_price,
                'lineTotal', l.line_total
              )
              order by l.sort_order
            )
            from accounting.invoice_lines l
            where l.invoice_id = i.id
          ), '[]'::jsonb)
        ) as doc,
        i.invoice_date,
        i.created_at
        from accounting.invoices i
        where i.customer_id = v_token.customer_id
          and i.status <> 'void'
          and (v_token.scope = 'customer' or i.id = v_token.invoice_id)
      ) q
    ), '[]'::jsonb),
    -- Statement rows: the customer's open (non-void, positive-balance) invoices. Always
    -- included so a 'customer' link shows an account statement; an 'invoice' link shows the
    -- single invoice's own row. Same safe columns, no internal fields.
    'statement', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'invoiceNumber', s.invoice_number,
          'invoiceDate', s.invoice_date,
          'dueDate', s.due_date,
          'total', s.total,
          'balanceDue', s.balance_due,
          'status', s.status
        )
        order by s.invoice_date, s.created_at
      )
      from accounting.invoices s
      where s.customer_id = v_token.customer_id
        and s.status <> 'void'
        and s.balance_due > 0
        and (v_token.scope = 'customer' or s.id = v_token.invoice_id)
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- LOCK DOWN the function: service_role ONLY. The public portal reaches it through the
-- serverless function (service-role client); a browser (anon/authenticated) can NEVER call it.
revoke all on function accounting.portal_invoice_payload(text) from public, anon, authenticated;
grant execute on function accounting.portal_invoice_payload(text) to service_role;

-- Table/sequence privileges for accounting.portal_tokens come from the schema's ALTER DEFAULT
-- PRIVILEGES (migration 20260603163733), so we deliberately do NOT restate a broad
-- `grant ... on all tables in schema accounting` here: a portal-hardening migration must never
-- silently re-open the whole accounting schema to `authenticated` (security review H-1).
-- Re-assert the portal payload lock-down LAST so nothing in THIS file can re-expose it.
revoke all on function accounting.portal_invoice_payload(text) from public, anon, authenticated;
grant execute on function accounting.portal_invoice_payload(text) to service_role;
