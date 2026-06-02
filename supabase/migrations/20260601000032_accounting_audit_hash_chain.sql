-- WorkTrackAccounting — Phase E SECURITY HARDENING 2/3 (E2): tamper-evident audit hash-chain
--
-- ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Requires CPA and/or SECURITY sign-off before
--     this module is enabled. The hash-chain integrity guarantee MUST be reviewed by a security
--     professional (see "WHAT A HUMAN MUST VERIFY").
--
-- WHAT THIS MIGRATION ADDS (NO schema change — the prev_hash / row_hash / chain_seq columns already
--   exist from migration 002; ZERO public.* change; G1):
--   • A deterministic canonical-serializer accounting._audit_canonical(...) used by BOTH the trigger
--     and the verifier, so the bytes that get hashed are IDENTICAL on write and on re-verification.
--   • accounting.audit() is REPLACED to POPULATE prev_hash / row_hash / chain_seq for every new audit
--     row, forming an append-only SHA-256 hash chain (each row binds the previous row's hash).
--   • accounting.verify_audit_chain(p_from bigint) — walks the chain in chain_seq order, recomputes
--     each row_hash, and reports the first break (insertion / modification / deletion / reordering).
--   • accounting.audit_chain_status() -> jsonb — a thin {verified,total_rows,first_break_seq,...}
--     summary for the UI integrity badge.
--
-- DOUBLE-ENTRY (G3): this phase moves NO money and posts ZERO journal entries. Vacuously satisfied.
--
-- DESIGN — global single chain, serialized by an advisory xact lock:
--   The chain is ONE global sequence across all accounting tables (chain_seq is a global bigint).
--   accounting.audit() takes pg_advisory_xact_lock(<const>) so concurrent writers cannot interleave
--   and produce duplicate/forked chain_seq or a prev_hash race. TRADEOFF: this serializes audit-row
--   INSERTS (one at a time) — acceptable for this app's write volume, but a HUMAN MUST VERIFY whether
--   a single global chain is acceptable at scale or whether per-table chains are preferable (noted in
--   the build report). The lock is transaction-scoped, so it is released at COMMIT/ROLLBACK of the
--   originating business transaction.
--
-- CANONICALIZATION: row_hash = sha256( coalesce(prev_hash,'') || '|' || canonical_payload ), hex.
--   canonical_payload is a fixed-order, NUL-delimited string of the audit fields. before_data /
--   after_data are serialized via jsonb::text — Postgres stores jsonb object keys in a canonical
--   (sorted) order, so jsonb::text is deterministic for identical content. The SAME helper is used by
--   the verifier, so determinism is structural, not coincidental.
--
-- BACKFILL of pre-existing rows (rows inserted before this migration have NULL chain columns):
--   This is a ONE-TIME, human-run operation (NOT auto-run here — re-running would FORK the chain).
--   After this migration is applied, an admin runs ONCE:
--     select accounting.backfill_audit_chain();
--   which hashes every still-NULL row in (at, id) order, continuing from the last hashed row. It
--   REFUSES to touch rows that already have a row_hash. See its body + the HUMAN-VERIFY list.
--
-- This migration is IDEMPOTENT (create or replace function only — no DDL state, no table changes).
--
-- ROLLBACK (restore the pre-E2 audit() body verbatim from migration 002; hash columns stay — they
--   are additive and were already present):
--   DROP FUNCTION IF EXISTS accounting.backfill_audit_chain();
--   DROP FUNCTION IF EXISTS accounting.audit_chain_status();
--   DROP FUNCTION IF EXISTS accounting.verify_audit_chain(bigint);
--   DROP FUNCTION IF EXISTS accounting._audit_canonical(text, uuid, text, uuid, jsonb, jsonb, text[], timestamptz);
--   CREATE OR REPLACE FUNCTION accounting.audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path = accounting, public, pg_catalog AS $body$
--   DECLARE
--     v_actor uuid := auth.uid(); v_email text; v_before jsonb; v_after jsonb;
--     v_changed text[]; v_record_id uuid;
--   BEGIN
--     IF v_actor IS NOT NULL THEN SELECT p.email INTO v_email FROM public.profiles p WHERE p.id = v_actor; END IF;
--     IF (tg_op = 'DELETE') THEN v_before := to_jsonb(old); v_after := NULL;
--     ELSIF (tg_op = 'UPDATE') THEN v_before := to_jsonb(old); v_after := to_jsonb(new);
--       SELECT array_agg(b.key ORDER BY b.key) INTO v_changed FROM jsonb_each(v_before) b
--        WHERE b.value IS DISTINCT FROM (v_after -> b.key);
--     ELSE v_before := NULL; v_after := to_jsonb(new); END IF;
--     v_record_id := nullif(coalesce(v_after ->> 'id', v_before ->> 'id'), '')::uuid;
--     INSERT INTO accounting.audit_log
--       (table_name, record_id, action, actor_id, actor_email, before_data, after_data, changed_fields)
--     VALUES (tg_table_name, v_record_id, tg_op, v_actor, v_email, v_before, v_after, v_changed);
--     IF tg_op = 'DELETE' THEN RETURN old; END IF; RETURN new;
--   END; $body$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Deterministic canonical serializer (used by BOTH trigger and verifier)
-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABLE so its output depends only on its inputs. Fixed field order; NUL (\x01 sentinel) field
-- delimiter that cannot appear in the text fields. coalesce so NULLs serialize stably. timestamptz
-- is rendered to microsecond ISO-8601 in UTC for a stable cross-session representation.
create or replace function accounting._audit_canonical(
  p_table_name    text,
  p_record_id     uuid,
  p_action        text,
  p_actor_id      uuid,
  p_before_data   jsonb,
  p_after_data    jsonb,
  p_changed_fields text[],
  p_at            timestamptz
)
returns text
language sql
immutable
-- search_path pinned (advisor 0011): the body uses only built-ins (chr, coalesce, to_char,
-- array_to_string), so pg_catalog alone is sufficient and there is no schema-resolution surface.
set search_path = pg_catalog
as $$
  select
    coalesce(p_table_name, '')                                  || chr(1) ||
    coalesce(p_record_id::text, '')                             || chr(1) ||
    coalesce(p_action, '')                                      || chr(1) ||
    coalesce(p_actor_id::text, '')                              || chr(1) ||
    coalesce(p_before_data::text, '')                           || chr(1) ||
    coalesce(p_after_data::text, '')                            || chr(1) ||
    coalesce(array_to_string(p_changed_fields, ','), '')        || chr(1) ||
    coalesce(to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '');
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) audit() — now populates the hash chain (logic above the INSERT is byte-identical to 002)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.audit()
returns trigger
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_record_id uuid;
  v_at timestamptz := now();
  v_prev_hash text;
  v_chain_seq bigint;
  v_canonical text;
  v_row_hash text;
begin
  if v_actor is not null then
    select p.email into v_email from public.profiles p where p.id = v_actor;
  end if;

  if (tg_op = 'DELETE') then
    v_before := to_jsonb(old);
    v_after := null;
  elsif (tg_op = 'UPDATE') then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    select array_agg(b.key order by b.key)
      into v_changed
      from jsonb_each(v_before) b
     where b.value is distinct from (v_after -> b.key);
  else -- INSERT
    v_before := null;
    v_after := to_jsonb(new);
  end if;

  v_record_id := nullif(coalesce(v_after ->> 'id', v_before ->> 'id'), '')::uuid;

  -- ── HASH CHAIN ──────────────────────────────────────────────────────────────
  -- Serialize concurrent audit writers so chain_seq/prev_hash are race-free. The lock is
  -- transaction-scoped (released at COMMIT/ROLLBACK of the business txn).
  perform pg_advisory_xact_lock(hashtext('accounting.audit_log.chain'));

  -- Tail of the chain: highest chain_seq row drives both next seq and prev_hash. Rows with a NULL
  -- chain_seq (legacy, pre-E2, not yet backfilled) are ignored for the tail so the live chain is
  -- well-defined from genesis = first row written under this function.
  select chain_seq, row_hash
    into v_chain_seq, v_prev_hash
    from accounting.audit_log
   where chain_seq is not null
   order by chain_seq desc
   limit 1;

  v_chain_seq := coalesce(v_chain_seq, 0) + 1;  -- genesis row gets chain_seq = 1, prev_hash = NULL

  v_canonical := accounting._audit_canonical(
    tg_table_name, v_record_id, tg_op, v_actor, v_before, v_after, v_changed, v_at);
  v_row_hash := encode(
    extensions.digest(coalesce(v_prev_hash, '') || '|' || v_canonical, 'sha256'), 'hex');

  insert into accounting.audit_log
    (table_name, record_id, action, actor_id, actor_email, before_data, after_data, changed_fields,
     prev_hash, row_hash, chain_seq, at)
  values
    (tg_table_name, v_record_id, tg_op, v_actor, v_email, v_before, v_after, v_changed,
     v_prev_hash, v_row_hash, v_chain_seq, v_at);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) verify_audit_chain — recompute every row_hash and report the first break
-- ─────────────────────────────────────────────────────────────────────────────
-- can_read()-gated. Walks chained rows (chain_seq not null) ascending; for each row recomputes the
-- expected row_hash from the SAME canonical serializer + the previous row's STORED row_hash and
-- compares. ok=false on the first row whose stored hash != recomputed hash, OR whose stored prev_hash
-- != the prior row's stored row_hash (detects reordering/deletion), OR whose chain_seq is not exactly
-- prev+1 (detects a missing/duplicated seq). Returns one row per inspected chain_seq.
create or replace function accounting.verify_audit_chain(p_from bigint default 1)
returns table(
  chain_seq      bigint,
  ok             boolean,
  reason         text,
  stored_hash    text,
  expected_hash  text
)
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  r record;
  v_expected_prev text := null;   -- the row_hash the current row SHOULD chain from
  v_expected_seq  bigint := null; -- the chain_seq the current row SHOULD have (prev seq + 1)
  v_canonical text;
  v_recomputed text;
  v_ok boolean;
  v_reason text;
begin
  if not accounting.can_read() then
    raise exception 'insufficient privileges to verify the audit chain'
      using errcode = 'insufficient_privilege';
  end if;

  for r in
    select al.chain_seq, al.prev_hash, al.row_hash,
           al.table_name, al.record_id, al.action, al.actor_id,
           al.before_data, al.after_data, al.changed_fields, al.at
      from accounting.audit_log al
     where al.chain_seq is not null
       and al.chain_seq >= p_from
     order by al.chain_seq asc
  loop
    v_ok := true;
    v_reason := 'ok';

    -- (a) sequence contiguity (only enforced once we have a predecessor in-range)
    if v_expected_seq is not null and r.chain_seq <> v_expected_seq then
      v_ok := false;
      v_reason := format('chain_seq gap: expected %s, found %s', v_expected_seq, r.chain_seq);
    end if;

    -- (b) link continuity: stored prev_hash must equal the prior row's stored row_hash
    if v_ok and v_expected_prev is not null and coalesce(r.prev_hash, '') <> v_expected_prev then
      v_ok := false;
      v_reason := 'prev_hash does not match prior row (reorder/deletion/insertion)';
    end if;

    -- (c) content integrity: recompute this row's hash from its canonical payload + stored prev_hash
    v_canonical := accounting._audit_canonical(
      r.table_name, r.record_id, r.action, r.actor_id,
      r.before_data, r.after_data, r.changed_fields, r.at);
    v_recomputed := encode(
      extensions.digest(coalesce(r.prev_hash, '') || '|' || v_canonical, 'sha256'), 'hex');
    if v_ok and coalesce(r.row_hash, '') <> v_recomputed then
      v_ok := false;
      v_reason := 'row_hash mismatch (row contents altered)';
    end if;

    chain_seq     := r.chain_seq;
    ok            := v_ok;
    reason        := v_reason;
    stored_hash   := r.row_hash;
    expected_hash := v_recomputed;
    return next;

    -- advance expectations to this row (we chain from the STORED hash so a single corrupted row is
    -- reported once, not cascaded as N failures downstream).
    v_expected_prev := r.row_hash;
    v_expected_seq  := r.chain_seq + 1;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) audit_chain_status — compact summary for the UI integrity badge
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function accounting.audit_chain_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  v_total       bigint;
  v_unchained   bigint;
  v_first_break bigint;
begin
  if not accounting.can_read() then
    raise exception 'insufficient privileges to read audit chain status'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) filter (where chain_seq is not null),
         count(*) filter (where chain_seq is null)
    into v_total, v_unchained
    from accounting.audit_log;

  select min(v.chain_seq) into v_first_break
    from accounting.verify_audit_chain(1) v
   where v.ok = false;

  return jsonb_build_object(
    'verified',        (v_first_break is null),
    'chainedRows',     v_total,
    'unchainedRows',   v_unchained,    -- legacy rows awaiting one-time backfill_audit_chain()
    'firstBreakSeq',   v_first_break
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) backfill_audit_chain — ONE-TIME hashing of pre-E2 rows (admin-run, NOT auto-run)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hashes every audit row that still has a NULL row_hash, in (at, id) order, continuing the chain
-- from the current tail. accounting_admin-only. IDEMPOTENT in the safe direction: it only ever fills
-- NULL rows and never rewrites a row that already has a hash, so re-running after a partial run
-- finishes the job WITHOUT forking the chain. (Running it once after a tamper would "bless" the
-- tamper — that is why it is a supervised, one-time human step, on the HUMAN-VERIFY list.)
create or replace function accounting.backfill_audit_chain()
returns bigint
language plpgsql
security definer
set search_path = extensions, accounting, public, pg_catalog
as $$
declare
  r record;
  v_prev_hash text;
  v_chain_seq bigint;
  v_canonical text;
  v_row_hash text;
  v_done bigint := 0;
begin
  if not accounting.has_role('accounting_admin') then
    raise exception 'only an accounting_admin may backfill the audit chain'
      using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtext('accounting.audit_log.chain'));

  select chain_seq, row_hash
    into v_chain_seq, v_prev_hash
    from accounting.audit_log
   where chain_seq is not null
   order by chain_seq desc
   limit 1;
  v_chain_seq := coalesce(v_chain_seq, 0);

  for r in
    select id, table_name, record_id, action, actor_id,
           before_data, after_data, changed_fields, at
      from accounting.audit_log
     where row_hash is null
     order by at asc, id asc
  loop
    v_chain_seq := v_chain_seq + 1;
    v_canonical := accounting._audit_canonical(
      r.table_name, r.record_id, r.action, r.actor_id,
      r.before_data, r.after_data, r.changed_fields, r.at);
    v_row_hash := encode(
      extensions.digest(coalesce(v_prev_hash, '') || '|' || v_canonical, 'sha256'), 'hex');

    update accounting.audit_log
       set prev_hash = v_prev_hash, row_hash = v_row_hash, chain_seq = v_chain_seq
     where id = r.id;

    v_prev_hash := v_row_hash;
    v_done := v_done + 1;
  end loop;

  return v_done;
end;
$$;

-- backfill is an admin-only maintenance op; keep it off anon/public (default grants cover
-- authenticated, but the in-body has_role('accounting_admin') check is the real gate).
revoke execute on function accounting.backfill_audit_chain() from public;
revoke execute on function accounting.backfill_audit_chain() from anon;

grant execute on function accounting._audit_canonical(text, uuid, text, uuid, jsonb, jsonb, text[], timestamptz)
  to authenticated, service_role;
grant execute on function accounting.verify_audit_chain(bigint) to authenticated, service_role;
grant execute on function accounting.audit_chain_status()       to authenticated, service_role;
grant execute on function accounting.backfill_audit_chain()     to authenticated, service_role;
