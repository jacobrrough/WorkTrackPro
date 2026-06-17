import { supabase } from '../supabaseClient';

/**
 * Plaid bank feeds — client service (Phase 0).
 *
 * Thin seam over the Plaid Netlify functions (netlify/functions/plaid-*.mjs, each routed
 * by netlify.toml as /api/* -> /.netlify/functions/:splat). Every admin call sends the
 * current Supabase session access token as a `Bearer` header; each function verifies it
 * server-side (supabase.auth.getUser -> profiles.is_admin) and holds the Plaid
 * client_id/secret + the per-Item access tokens — none of which ever reach the browser.
 *
 * SECURITY: Plaid access tokens are stored ENCRYPTED on accounting.plaid_items and are
 * NEVER returned to the client. This service only ever sees the short-lived Link/public
 * tokens (which it forwards) and non-secret status/count fields. It NEVER receives or
 * handles an access_token.
 *
 * Mirrors src/services/api/accounting/qboConnection.ts for the bearer-auth + JSON-parse
 * skeleton; unlike QBO (a single ?action= dispatcher) Plaid uses one function per path, so
 * each method targets its own endpoint.
 *
 * Methods surface either a typed result or throw, matching how each caller consumes them:
 * the status read returns [] on failure (it drives an always-rendered list) while the
 * actions throw so React Query's mutation error state can render an inline banner.
 */

/** Relative bases — netlify.toml rewrites /api/* to each function. */
const PLAID_LINK_TOKEN_ENDPOINT = '/api/plaid-link-token';
const PLAID_EXCHANGE_ENDPOINT = '/api/plaid-exchange';
const PLAID_STATUS_ENDPOINT = '/api/plaid-status';
const PLAID_SYNC_ENDPOINT = '/api/plaid-sync';
const PLAID_DISCONNECT_ENDPOINT = '/api/plaid-disconnect';

/** A connection's lifecycle, as constrained by accounting.plaid_items.status. */
export type PlaidItemStatus_State = 'active' | 'login_required' | 'error' | 'disconnected';

/**
 * One connected institution (a Plaid "Item"), as reported by plaid-status. SAFE fields
 * only — the function never returns access_token or the sync cursor.
 *
 * `id` is the accounting.plaid_items PRIMARY KEY (uuid). `itemId` is Plaid's stable Item
 * id. Disconnect/sync-by-one and the bank-account wiring (bank_accounts.plaid_item_id ->
 * plaid_items.id) reference these — see the notes on each method.
 */
export interface PlaidItemStatus {
  /** accounting.plaid_items.id (uuid PK) — what bank_accounts.plaid_item_id references. */
  id: string;
  /** Plaid Item id (stable per connection). */
  itemId: string;
  institutionName: string | null;
  status: PlaidItemStatus_State;
  lastError: string | null;
  lastSyncAt: string | null;
  connectedAt: string | null;
}

/** One Plaid account under an Item, returned by the exchange (safe fields only). */
export interface PlaidLinkedAccount {
  plaidAccountId: string;
  name: string | null;
  mask: string | null;
  subtype: string | null;
  type: string | null;
}

/** Result of completing a Link flow: the Item + its accounts to map onto bank accounts. */
export interface ExchangePublicTokenResult {
  itemId: string;
  institutionName: string | null;
  accounts: PlaidLinkedAccount[];
}

/** Per-item failure surfaced by a sync run (one bad Item never aborts the others). */
export interface PlaidSyncError {
  /** accounting.plaid_items.id of the Item that failed. */
  itemId: string;
  error: string;
}

/** Aggregate counts from a "Sync now" run across the targeted Item(s). */
export interface PlaidSyncResult {
  synced: number;
  added: number;
  modified: number;
  removed: number;
  errors?: PlaidSyncError[];
}

/** Resolve the current session bearer token, or null when signed out. */
async function getAccessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Issue an authenticated request to a Plaid function and parse its JSON body. Throws an
 * Error whose message is the function's generic `error` (never a secret) on a non-OK
 * status, an unreachable function, or a missing session — so callers can surface it in a
 * mutation error banner. `getStatus` catches this to degrade to an empty list.
 */
async function call<T>(
  endpoint: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated.');

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Could not reach the Plaid service.');
  }

  // Tolerate an empty / non-JSON body (e.g. an unexpected 5xx with no payload).
  const parsed = (await response.json().catch(() => null)) as
    | (Partial<T> & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(parsed?.error || `HTTP ${response.status}`);
  }
  return (parsed ?? {}) as T;
}

export const plaidService = {
  /**
   * Mint a short-lived Plaid Link token for react-plaid-link. Pass an `itemId` (the Plaid
   * Item id) to open Link in UPDATE mode to re-authenticate a broken connection; omit it
   * for an initial connect. Returns only { linkToken } — no secret is exposed.
   */
  async getLinkToken(itemId?: string): Promise<{ linkToken: string }> {
    const res = await call<{ linkToken?: string }>(PLAID_LINK_TOKEN_ENDPOINT, 'POST', {
      itemId: itemId?.trim() || undefined,
    });
    if (!res.linkToken) throw new Error('Plaid did not return a link token.');
    return { linkToken: res.linkToken };
  },

  /**
   * Complete a Link flow: hand the function the short-lived public_token from
   * react-plaid-link. The function exchanges it for the long-lived access_token + item_id
   * (stored ENCRYPTED server-side), fetches the institution + account list, and returns the
   * Item + its accounts (safe fields only) for the UI to map onto bank accounts. The
   * access_token is NEVER returned here.
   */
  async exchangePublicToken(publicToken: string): Promise<ExchangePublicTokenResult> {
    const res = await call<Partial<ExchangePublicTokenResult>>(PLAID_EXCHANGE_ENDPOINT, 'POST', {
      publicToken,
    });
    return {
      itemId: res.itemId ?? '',
      institutionName: res.institutionName ?? null,
      accounts: Array.isArray(res.accounts) ? res.accounts : [],
    };
  },

  /**
   * List the connected Plaid Items (SAFE fields only). Never throws — any failure degrades
   * to an empty list so the always-rendered connections list can show its empty/error state
   * separately (mirrors qboConnectionService.getStatus treating failure as "not connected").
   */
  async getStatus(): Promise<PlaidItemStatus[]> {
    try {
      const res = await call<{ items?: PlaidItemStatus[] }>(PLAID_STATUS_ENDPOINT, 'GET');
      return Array.isArray(res.items) ? res.items : [];
    } catch {
      return [];
    }
  },

  /**
   * Run "Sync now": pull posted transactions into accounting.bank_transactions. Pass an
   * `itemId` (the accounting.plaid_items.id) to sync one connection, or omit it to sync every
   * active Item. Returns aggregate counts; `errors` lists any per-item failures (one bad Item
   * never aborts the rest). The function only ever returns counts — never a token.
   */
  async syncNow(itemId?: string): Promise<PlaidSyncResult> {
    const res = await call<Partial<PlaidSyncResult>>(PLAID_SYNC_ENDPOINT, 'POST', {
      itemId: itemId?.trim() || undefined,
    });
    return {
      synced: res.synced ?? 0,
      added: res.added ?? 0,
      modified: res.modified ?? 0,
      removed: res.removed ?? 0,
      ...(Array.isArray(res.errors) && res.errors.length > 0 ? { errors: res.errors } : {}),
    };
  },

  /**
   * Disconnect one Plaid Item (by its Plaid item_id): the function best-effort revokes the
   * token at Plaid, marks the row 'disconnected' + NULLs its stored access_token (keeping the
   * row for history), and clears the Plaid link columns on any wired bank accounts so they
   * stop syncing. Returns { ok: true }.
   */
  async disconnect(itemId: string): Promise<{ ok: boolean }> {
    const res = await call<{ ok?: boolean }>(PLAID_DISCONNECT_ENDPOINT, 'POST', { itemId });
    return { ok: res.ok === true };
  },
};
