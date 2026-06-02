// WorkTrackAccounting — TAX-SYNC scheduled function (ADVISORY-ONLY)
// ============================================================================
// Implements docs/BIGCAPITAL_MINED_REFERENCE.md §4, backend lane.
//
// WHAT THIS DOES
//   • QUARTERLY (cron `0 6 1 1,4,7,10 *` — 06:00 on the 1st of Jan/Apr/Jul/Oct)
//     and on a manual admin "check now" (POST /api/tax-table-refresh), for each
//     ACTIVE accounting.tax_table_sources row:
//       1. fetch the OFFICIAL downloadable data file (prefer official_file_url;
//          fall back to url) — preferred over fragile HTML scraping;
//       2. parse it (best-effort, source-specific — see lib/taxTableParsers.mjs)
//          to a normalized { jurisdiction, rate, effectiveDate } set;
//       3. compute a content-hash and INSERT one accounting.tax_table_snapshots
//          row (append-only pull history);
//       4. DIFF the parsed set against the active accounting.tax_rates;
//       5. on any mismatch, INSERT one accounting.tax_table_drift row (status
//          'open'). THAT ROW IS THE ADMIN ALERT — it stays entirely within
//          accounting.* (the admin UI surfaces open drift via a badge + list).
//
// HARD ISOLATION GATE (the reason this is safe to ship to production OFF)
//   • The function is gated on the SERVER env var ACCOUNTING_TAX_SYNC_ENABLED.
//     When it is unset / not a truthy value, the function EXITS IMMEDIATELY with
//     NO external fetch and NO database write. A frontend build flag cannot gate
//     a scheduled function, so THIS server gate is the isolation guarantee for
//     the auto-refresh engine. Default is OFF; a human flips it on only when the
//     module graduates AND the parsers have been verified against the live files.
//
// NON-NEGOTIABLE INVARIANTS HONORED
//   • NEVER mutates accounting.tax_rates. The only path that changes a stored
//     rate is the explicit, admin-confirmed accounting.apply_tax_table_drift RPC
//     (called from the UI, never here). This function only writes append-only
//     snapshots and 'open' drift alerts.
//   • Stays entirely within accounting.* — it writes ZERO public.* /
//     system_notifications rows (email/push delivery is a DEFERRED enhancement
//     needing a separate cross-schema sign-off).
//   • Fail-safe: any fetch/parse error is RECORDED as a snapshot with a non-null
//     `error` (and no drift) — a failure never corrupts stored rates and never
//     throws past the per-source boundary.
//   • Untrusted input: response bodies are size-capped before parsing; parsers
//     are defensive; fetches are rate-limited (sequential + small inter-fetch
//     delay + per-request timeout).
//   • G3 vacuous: posts ZERO journal entries, moves ZERO money (advisory-only).
//
// CONFIG / WIRING
//   • Service role: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same vars the
//     other functions use). The service role bypasses RLS; the `accounting`
//     schema must be in the project's PostgREST exposed schemas (it already is —
//     the browser module reads it). Reached via supabase.schema('accounting').
//   • Manual check-now requires an accounting_admin caller (global approved admin
//     OR the accounting_admin role) — mirrors accounting.has_role('accounting_admin').
//   • Returns JSON { ok, message?, error? } for the UI seam
//     (src/services/api/accounting/taxTableSync.ts).
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import {
  resolveParser,
  normalizeParsedSet,
  contentHashOf,
  buildDiff,
  severityOf,
} from './lib/taxTableParsers.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// ── Tunables (defensive defaults for untrusted external fetches) ─────────────
const FETCH_TIMEOUT_MS = 20000; // per-source fetch timeout
const MAX_BODY_BYTES = 8 * 1024 * 1024; // size-cap a response body before parsing
const RAW_STORE_CAP = 200000; // cap the raw text we persist in a snapshot (~200KB)
const INTER_FETCH_DELAY_MS = 1500; // polite gap between sources (rate-limit)

// ── Env-gate helper ──────────────────────────────────────────────────────────
/** The hard server gate. TRUE only for an explicit truthy value; anything else
 * (unset, '', 'false', '0', 'off', 'no') keeps the function inert. */
function isSyncEnabled() {
  const v = (process.env.ACCOUNTING_TAX_SYNC_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'enabled';
}

/** The service-role client (public schema). Accounting tables are reached via
 * `.schema('accounting')` — the same proven pattern as the browser module's
 * accountingClient.ts — so a single client covers both public reads (profiles /
 * roles for the admin check) and accounting writes. Null when unconfigured. */
function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the caller from a Bearer token and confirm accounting_admin authority
 * (global approved admin OR the accounting_admin role). Returns the user or null. */
async function verifyAccountingAdmin(pub, authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const {
    data: { user },
    error: authError,
  } = await pub.auth.getUser(token);
  if (authError || !user) return null;

  // Global approved admin ⇒ every accounting role (mirrors accounting.has_role).
  const { data: profile } = await pub
    .from('profiles')
    .select('is_admin, is_approved')
    .eq('id', user.id)
    .single();
  if (profile && profile.is_admin && profile.is_approved !== false) return user;

  // Otherwise require the explicit accounting_admin role.
  const { data: roleRow } = await pub
    .schema('accounting')
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'accounting_admin')
    .maybeSingle();
  if (roleRow) return user;

  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Fetch one source's official file (untrusted, size-capped, timed out) ─────
/**
 * Fetch the preferred official file (official_file_url, else url). Returns
 * { text, status, finalUrl } on success. Throws on network / non-2xx / oversize
 * so the caller records a snapshot.error (fail-safe). The body is read as text
 * and hard-capped; binary bodies (e.g. PDFs) are returned as-is for the parser
 * to recognize and skip — we never mis-scan binary as a rate table.
 */
async function fetchSourceFile(source) {
  const target = (source.official_file_url || source.url || '').trim();
  if (!target) throw new Error('source has no official_file_url or url to fetch');
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error(`source URL is not a valid absolute URL: ${target}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`refusing non-http(s) source URL scheme: ${url.protocol}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // identify the bot; many gov data portals reject an empty UA
        'User-Agent': 'WorkTrackPro-TaxSync/1.0 (+advisory tax-table refresh)',
        Accept: 'text/csv, application/json, text/plain, */*',
      },
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e?.name === 'AbortError') throw new Error(`fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    throw new Error(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`fetch returned HTTP ${res.status}`);
  }

  // Bail early on an obviously-oversize body (when the server reports length).
  const len = Number(res.headers.get('content-length') || '0');
  if (len && len > MAX_BODY_BYTES) {
    throw new Error(`response too large (${len} bytes > ${MAX_BODY_BYTES} cap)`);
  }

  // Read as text but cap defensively even when content-length lied / was absent.
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new Error(`response too large (${buf.byteLength} bytes > ${MAX_BODY_BYTES} cap)`);
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return { text, status: res.status, finalUrl: res.url || url.toString() };
}

// ── Process one source end-to-end: fetch → parse → snapshot → diff → drift ───
/**
 * Returns a per-source result summary. NEVER throws — every failure path records
 * a snapshot with `error` (no drift) and returns a failed summary, so one bad
 * source cannot abort the run or corrupt anything (fail-safe).
 */
async function processSource(acct, source) {
  const summary = {
    source: source.name,
    sourceId: source.id,
    fetched: false,
    parsedCount: 0,
    snapshotId: null,
    driftId: null,
    changed: 0,
    error: null,
  };

  // 1) Fetch (fail-safe — record the error as a snapshot, no drift).
  let raw = '';
  try {
    const fetched = await fetchSourceFile(source);
    raw = fetched.text ?? '';
    summary.fetched = true;
  } catch (e) {
    summary.error = `fetch: ${e instanceof Error ? e.message : String(e)}`;
    await insertSnapshot(acct, {
      source_id: source.id,
      content_hash: null,
      parsed: null,
      raw: null,
      error: summary.error,
    });
    await touchSource(acct, source.id);
    return summary;
  }

  // 2) Parse (defensive; a parser that throws is treated as a parse failure).
  let parsedSet = [];
  try {
    const parser = resolveParser(source);
    if (!parser) throw new Error(`no parser registered for kind="${source.kind}"`);
    const rawEntries = parser(raw);
    parsedSet = normalizeParsedSet(rawEntries);
    summary.parsedCount = parsedSet.length;
  } catch (e) {
    summary.error = `parse: ${e instanceof Error ? e.message : String(e)}`;
    await insertSnapshot(acct, {
      source_id: source.id,
      content_hash: null,
      parsed: null,
      raw: capRaw(raw),
      error: summary.error,
    });
    await touchSource(acct, source.id);
    return summary;
  }

  // 3) Snapshot (always — even an empty parse is a recorded, hashed pull).
  const hash = contentHashOf(parsedSet);
  const snapshotId = await insertSnapshot(acct, {
    source_id: source.id,
    content_hash: hash,
    parsed: parsedSet,
    raw: capRaw(raw),
    error: parsedSet.length === 0 ? 'parser produced no usable rate rows (VERIFY parser against live file)' : null,
  });
  summary.snapshotId = snapshotId;

  // If the parse produced nothing usable, do not diff (no false drift). The
  // empty-parse error above flags it for a human to re-verify the parser.
  if (parsedSet.length === 0) {
    await touchSource(acct, source.id);
    return summary;
  }

  // 4) Diff vs the active stored rates for this source's domain.
  let activeRates = [];
  try {
    activeRates = await loadActiveRates(acct, source);
  } catch (e) {
    // A read failure here is non-fatal: we already snapshotted. Record + move on.
    summary.error = `diff-read: ${e instanceof Error ? e.message : String(e)}`;
    await touchSource(acct, source.id);
    return summary;
  }

  const diff = buildDiff(parsedSet, activeRates);

  // 5) Insert an 'open' drift ONLY when there is something to review.
  if (diff.length > 0) {
    try {
      const driftId = await insertDrift(acct, {
        source_id: source.id,
        snapshot_id: snapshotId,
        diff,
        severity: severityOf(diff),
        status: 'open',
      });
      summary.driftId = driftId;
      summary.changed = diff.length;
    } catch (e) {
      summary.error = `drift-insert: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  await touchSource(acct, source.id);
  return summary;
}

function capRaw(raw) {
  if (typeof raw !== 'string') return null;
  return raw.length > RAW_STORE_CAP ? raw.slice(0, RAW_STORE_CAP) : raw;
}

// ── DB writes (accounting schema only; service role) ─────────────────────────

async function insertSnapshot(acct, row) {
  const { data, error } = await acct
    .from('tax_table_snapshots')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`tax_table_snapshots insert failed: ${error.message}`);
  return data?.id ?? null;
}

async function insertDrift(acct, row) {
  const { data, error } = await acct
    .from('tax_table_drift')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`tax_table_drift insert failed: ${error.message}`);
  return data?.id ?? null;
}

/** Stamp last_checked_at so the UI shows the pull time even when nothing changed.
 * Best-effort: a failure here must not fail the run. */
async function touchSource(acct, sourceId) {
  try {
    await acct
      .from('tax_table_sources')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('id', sourceId);
  } catch {
    /* non-fatal */
  }
}

/** Load the active stored rates relevant to a source. For 'sales' that is the
 * active accounting.tax_rates set (CDTFA/state+district). For 'payroll' there is
 * no separate rate store yet (payroll module is later, Phase C2), so we diff
 * against any active tax_rates whose name matches a parsed payroll component —
 * i.e. the same accounting.tax_rates table the apply RPC writes. We load the full
 * active set and let buildDiff match by exact name; this keeps the matching rule
 * identical to the apply RPC (which targets tax_rates by name) for BOTH kinds. */
async function loadActiveRates(acct, _source) {
  const { data, error } = await acct
    .from('tax_rates')
    .select('id, name, rate, jurisdiction, effective_date')
    .eq('is_active', true);
  if (error) throw new Error(`tax_rates read failed: ${error.message}`);
  return data ?? [];
}

// ── The shared run (used by both the cron and the manual trigger) ────────────
/**
 * Run the refresh across all active sources. Sequential + rate-limited. Returns
 * a structured result. Assumes the env gate already passed and the client built.
 */
async function runRefresh(acct, trigger) {
  const { data: sources, error } = await acct
    .from('tax_table_sources')
    .select('id, name, kind, jurisdiction, url, official_file_url, active')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) {
    return { ok: false, error: `could not load sources: ${error.message}` };
  }
  if (!sources || sources.length === 0) {
    return { ok: true, message: 'No active tax-table sources to check.', results: [] };
  }

  const results = [];
  for (let i = 0; i < sources.length; i++) {
    if (i > 0) await sleep(INTER_FETCH_DELAY_MS); // rate-limit between sources
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential (rate-limit)
    const r = await processSource(acct, sources[i]);
    results.push(r);
  }

  const driftCount = results.filter((r) => r.driftId).length;
  const failed = results.filter((r) => r.error).length;
  const message =
    `Checked ${results.length} source(s) (${trigger}). ` +
    `${driftCount} with new drift, ${failed} with errors.`;
  return { ok: true, message, results };
}

// ── HTTP / scheduled handler (Netlify Functions V2) ──────────────────────────

export default async (request) => {
  // CORS preflight for the browser "check now".
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }

  // Identify a scheduled (cron) invocation. Netlify invokes scheduled functions
  // with a JSON body carrying `next_run`; a manual admin trigger is a normal POST
  // with a Bearer token. We branch on the presence of that token.
  const authHeader = request.headers.get('authorization') || '';
  const isManual = authHeader.startsWith('Bearer ');

  if (!isManual && request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  // ── HARD ENV GATE — before ANY fetch or DB write. ──
  // When OFF (default): no external fetch, no DB write, no role lookup. This is
  // the isolation guarantee for the scheduled engine. We return a 200 with a
  // clear 'disabled' message so the UI "check now" reports it cleanly rather than
  // looking broken.
  if (!isSyncEnabled()) {
    return new Response(
      JSON.stringify({
        ok: true,
        disabled: true,
        message:
          'Tax-table sync is disabled on the server (ACCOUNTING_TAX_SYNC_ENABLED is off). ' +
          'No external fetch or database write was performed.',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  // The gate passed. Build the service-role client (no fetch / DB write yet).
  const client = getServiceClient();
  if (!client) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Tax-table sync is not configured (missing service-role credentials).' }),
      { status: 500, headers: corsHeaders }
    );
  }

  // ── Manual "check now" must be an accounting_admin. The cron path (no Bearer)
  //    runs with the service role and skips this user check. ──
  if (isManual) {
    let admin = null;
    try {
      admin = await verifyAccountingAdmin(client, authHeader);
    } catch {
      admin = null;
    }
    if (!admin) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Accounting admin access required.' }),
        { status: 403, headers: corsHeaders }
      );
    }
  }

  // All accounting-schema reads/writes go through the schema-scoped accessor
  // (same pattern as the browser module's accountingClient.ts).
  const acct = client.schema('accounting');

  try {
    const result = await runRefresh(acct, isManual ? 'manual' : 'scheduled');
    const status = result.ok ? 200 : 500;
    return new Response(JSON.stringify(result), { status, headers: corsHeaders });
  } catch (err) {
    // Top-level fail-safe: never leak a stack; advisory module degrades cleanly.
    console.error('tax-table-refresh unhandled error:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Tax-table refresh failed.',
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

// Netlify Functions V2 config:
//   • schedule → quarterly cron (1st of Jan/Apr/Jul/Oct at 06:00 UTC).
//   • path     → served at /api/tax-table-refresh via the netlify.toml /api/*
//     redirect for the admin UI "check now" (taxTableSync.ts CHECK_NOW_ENDPOINT).
export const config = {
  schedule: '0 6 1 1,4,7,10 *',
  path: '/api/tax-table-refresh',
};
