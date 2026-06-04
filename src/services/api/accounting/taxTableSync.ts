import type {
  TaxRate,
  TaxTableDrift,
  TaxTableDriftStatus,
  TaxTableSnapshot,
  TaxTableSource,
} from '../../../features/accounting/types';
import { applicableDiffEntries } from '../../../features/accounting/taxTableDiff';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import {
  mapTaxRateRow,
  mapTaxTableDriftRow,
  mapTaxTableSnapshotRow,
  mapTaxTableSourceRow,
  type Row,
} from './mappers';

/**
 * TAX-SYNC — quarterly tax-table auto-refresh + drift alert (ADVISORY-ONLY).
 *
 * This service is the API seam for the accounting.tax_table_* tables (migration 022) and
 * the two accounting_admin-only RPCs (apply_tax_table_drift / dismiss_tax_table_drift).
 *
 * ADVISORY-ONLY + ISOLATION (the invariants that make this safe — see §4):
 *  - Nothing here moves money or posts a journal entry (G3 vacuous). The ONLY books change
 *    is a stored reference rate, and only via the explicit admin APPLY RPC below; the
 *    scheduled function NEVER mutates accounting.tax_rates.
 *  - Everything stays within accounting.* — no public.* / system_notifications writes. The
 *    open-drift rows ARE the in-app admin alert (surfaced by the UI badge + list).
 *  - The quarterly refresh + manual "check now" run in the SERVER (a Netlify scheduled /
 *    callable function, service-role, hard-gated on the server env ACCOUNTING_TAX_SYNC_ENABLED,
 *    default OFF). A frontend flag can't gate a scheduled function, so that server gate is
 *    the isolation guarantee. checkNow() here just POSTs to that function — it does NOT
 *    fetch external data itself.
 *
 * Reads THROW so React Query surfaces failures (module convention). RPC/write wrappers
 * return a `{ ok, error }`-style result, carrying the DB message (e.g. the privilege error
 * a non-admin gets, or the terminal-state guard) for inline display — they never throw on
 * an expected DB rejection.
 *
 * G9: "Not certified tax software. Always verify with a CPA/EA." is shown on every
 * TAX-SYNC screen by the UI lane (the API cannot enforce a banner).
 */

/** The Netlify function path that runs a manual refresh ("check now"). Routed by
 * netlify.toml: /api/* → /.netlify/functions/:splat. Authored by the backend lane. */
const CHECK_NOW_ENDPOINT = '/api/tax-table-refresh';

/** Read embed that hydrates each drift's source name + kind for list/detail display. */
const DRIFT_WITH_SOURCE_SELECT = '*, source:tax_table_sources(name, kind)';

/** The outcome of applying a drift: the changed-rate count the UI can confirm/report. */
export interface ApplyDriftResult {
  ok: boolean;
  /** Number of diff entries that were applicable (would change a rate). 0 on failure. */
  applied: number;
  error?: string;
}

/** The outcome of a manual "check now" trigger. */
export interface CheckNowResult {
  ok: boolean;
  /** Optional human status from the function (e.g. "disabled", "2 sources checked"). */
  message?: string;
  error?: string;
}

export const taxTableSyncService = {
  // ── Sources ─────────────────────────────────────────────────────────────────

  /** All tax-table sources (active first, then by name). Reads throw. */
  async listSources(includeInactive = true): Promise<TaxTableSource[]> {
    let query = acct()
      .from('tax_table_sources')
      .select('*')
      .order('active', { ascending: false })
      .order('name', { ascending: true });
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapTaxTableSourceRow);
  },

  async getSourceById(id: string): Promise<TaxTableSource | null> {
    const { data, error } = await acct()
      .from('tax_table_sources')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapTaxTableSourceRow(data as Row);
  },

  // ── Snapshots (append-only pull history) ──────────────────────────────────────

  /**
   * Snapshot history for one source, newest first (the `raw` text is omitted to keep the
   * list payload small — it can be large + untrusted; fetch it via getSnapshotById). Reads
   * throw. `limit` caps the rows returned (default 50).
   */
  async listSnapshots(sourceId: string, limit = 50): Promise<TaxTableSnapshot[]> {
    const { data, error } = await acct()
      .from('tax_table_snapshots')
      .select('id, source_id, fetched_at, content_hash, parsed, error, created_at')
      .eq('source_id', sourceId)
      .order('fetched_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapTaxTableSnapshotRow);
  },

  /** One snapshot WITH its raw fetched text (for an admin to inspect the source payload). */
  async getSnapshotById(id: string): Promise<TaxTableSnapshot | null> {
    const { data, error } = await acct()
      .from('tax_table_snapshots')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapTaxTableSnapshotRow(data as Row);
  },

  // ── Drift (the in-accounting admin alert) ─────────────────────────────────────

  /**
   * Drift rows, newest first, optionally filtered by status (e.g. 'open' for the inbox).
   * Each row is hydrated with its source name/kind. Reads throw.
   */
  async listDrift(status?: TaxTableDriftStatus): Promise<TaxTableDrift[]> {
    let query = acct()
      .from('tax_table_drift')
      .select(DRIFT_WITH_SOURCE_SELECT)
      .order('detected_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapTaxTableDriftRow);
  },

  /** Convenience: just the OPEN drift (the actionable inbox the badge counts). */
  async listOpenDrift(): Promise<TaxTableDrift[]> {
    return this.listDrift('open');
  },

  /**
   * Count of OPEN drift — the number the admin "Tax table updates" badge shows. Uses a
   * head+exact count so no rows are transferred. Reads throw.
   */
  async countOpenDrift(): Promise<number> {
    const { count, error } = await acct()
      .from('tax_table_drift')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');
    if (error) throw error;
    return count ?? 0;
  },

  /** One drift row (with its source hydrated) for the detail screen. Reads throw on a real
   * error; a missing id resolves to null. */
  async getDriftById(id: string): Promise<TaxTableDrift | null> {
    const { data, error } = await acct()
      .from('tax_table_drift')
      .select(DRIFT_WITH_SOURCE_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapTaxTableDriftRow(data as Row);
  },

  /**
   * The ACTIVE stored tax rates whose names a drift's diff targets — what the detail screen
   * shows in the "currently stored" column next to each proposed change, so an admin sees
   * old-vs-new before applying. Returns a Map keyed by exact rate name (the apply RPC also
   * matches by exact name). Only the applicable diff entries (those Apply would act on) are
   * looked up. Reads throw.
   */
  async getCurrentRatesForDrift(drift: TaxTableDrift): Promise<Map<string, TaxRate>> {
    const names = Array.from(new Set(applicableDiffEntries(drift.diff).map((e) => e.rateName)));
    if (names.length === 0) return new Map();
    const { data, error } = await acct()
      .from('tax_rates')
      .select('*')
      .in('name', names)
      .eq('is_active', true);
    if (error) throw error;
    const byName = new Map<string, TaxRate>();
    for (const row of (data ?? []) as Row[]) {
      const rate = mapTaxRateRow(row);
      // If multiple active rates share a name, the apply RPC's UPDATE ... WHERE name=
      // touches them all; for the preview we keep the first (display only).
      if (!byName.has(rate.name)) byName.set(rate.name, rate);
    }
    return byName;
  },

  // ── Admin actions (RPCs) ──────────────────────────────────────────────────────

  /**
   * APPLY a drift's proposed rates to accounting.tax_rates, then mark the drift 'applied'.
   * Calls the SECURITY DEFINER, accounting_admin-ONLY RPC accounting.apply_tax_table_drift
   * — the ONLY path that mutates accounting.tax_rates (the scheduled function never does).
   * A non-admin gets `insufficient_privilege`; an already applied/dismissed drift is
   * rejected by the RPC's terminal-state guard. On the DB rejection we return `{ ok:false,
   * error }` (never throw). `applied` echoes how many diff entries were applicable so the UI
   * can report "N rate(s) updated".
   *
   * NOTE: the RPC itself does NOT post a journal entry — changing a stored tax rate is
   * reference data, not a financial transaction (G3 vacuous). It only affects how FUTURE
   * invoices compute tax, each of which posts its own balanced JE through the A1 path.
   */
  async applyDrift(
    driftId: string,
    diffForCount?: TaxTableDrift['diff']
  ): Promise<ApplyDriftResult> {
    const { error } = await acct().rpc('apply_tax_table_drift', { p_drift_id: driftId });
    if (error) return { ok: false, applied: 0, error: error.message };
    const applied = diffForCount ? applicableDiffEntries(diffForCount).length : 0;
    return { ok: true, applied };
  },

  /**
   * DISMISS a drift (no rate change) — marks it 'dismissed'. Calls the accounting_admin-ONLY
   * RPC accounting.dismiss_tax_table_drift; same privilege + terminal-state guards as apply.
   * Returns `{ ok, error }`; never throws on a DB rejection.
   */
  async dismissDrift(driftId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct().rpc('dismiss_tax_table_drift', { p_drift_id: driftId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // ── Manual "check now" (server-side; advisory) ────────────────────────────────

  /**
   * Trigger a manual refresh ("check now") by POSTing to the server function that the
   * quarterly cron also runs (service-role, server-env-gated). This NEVER fetches external
   * data in the browser and NEVER writes the DB directly — it only asks the gated function
   * to run. The function is inert unless the server env ACCOUNTING_TAX_SYNC_ENABLED is set,
   * in which case it fetches each source's OFFICIAL file, snapshots + diffs it, and inserts
   * any 'open' drift. Authed with the caller's Supabase access token.
   *
   * Fails safe: a missing/disabled function (e.g. 404 before the backend lane deploys it,
   * or a non-2xx) returns `{ ok:false, error }` for inline display rather than throwing.
   * After a successful run the caller should invalidate the taxTableSync subtree to pick up
   * new snapshots/drift (the hook does this).
   */
  async checkNow(): Promise<CheckNowResult> {
    let token: string | undefined;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      token = session?.access_token;
    } catch {
      token = undefined;
    }
    if (!token) return { ok: false, error: 'Not authenticated.' };

    let response: Response;
    try {
      response = await fetch(CHECK_NOW_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ trigger: 'manual' }),
      });
    } catch (e) {
      // Network error / function not reachable — advisory, so degrade gracefully.
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Could not reach the refresh service.',
      };
    }

    // Parse a JSON body when present; tolerate an empty/non-JSON body.
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      error?: string;
    } | null;

    if (!response.ok) {
      if (response.status === 404) {
        return {
          ok: false,
          error: 'Tax-table refresh is not available yet (the scheduled function is not deployed).',
        };
      }
      return { ok: false, error: body?.error || `Refresh failed (HTTP ${response.status}).` };
    }
    return { ok: true, message: body?.message };
  },
};
