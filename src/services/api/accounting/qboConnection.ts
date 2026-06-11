import { supabase } from '../supabaseClient';

/**
 * QuickBooks Online OAuth — client service (Phase 0).
 *
 * Thin seam over the `qbo-oauth` Netlify function (netlify/functions/qbo-oauth.mjs,
 * routed by netlify.toml as /api/* → /.netlify/functions/:splat). Every admin call
 * sends the current Supabase session access token as a `Bearer` header; the function
 * verifies it server-side (supabase.auth.getUser → profiles.is_admin) and holds the
 * Intuit client secret + tokens — none of which ever reach the browser.
 *
 * The OAuth callback (`/api/qbo-oauth/callback`) is hit by Intuit directly, not from
 * here, so there is no client method for it.
 *
 * Reads return a typed result rather than throwing so the view can render an inline
 * status/error banner (module convention — no toast library in the accounting module).
 */

/** Relative base — netlify.toml rewrites /api/* to the function. */
const QBO_OAUTH_ENDPOINT = '/api/qbo-oauth';

/** Connection status, as reported by the function from the single qbo_connection row. */
export interface QboStatus {
  connected: boolean;
  realmId?: string | null;
  companyName?: string | null;
  connectedAt?: string | null;
  lastSyncAt?: string | null;
  /** High-water mark for incremental syncs (the prior sync run's start time). */
  lastCdcCursor?: string | null;
}

/** Live company info fetched from the Intuit API (used by "Test connection"). */
export interface QboCompanyInfo {
  companyName?: string | null;
  legalName?: string | null;
  country?: string | null;
  realmId?: string | null;
}

/** Generic success/failure envelope for the action endpoints. */
export interface QboActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
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
 * Issue an authenticated GET/POST to the qbo-oauth function and parse its JSON body.
 * On a non-OK HTTP status, surfaces the function's generic `error` (never a secret).
 */
async function call<T>(action: string, method: 'GET' | 'POST'): Promise<QboActionResult<T>> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Not authenticated.' };

  let response: Response;
  try {
    response = await fetch(`${QBO_OAUTH_ENDPOINT}?action=${action}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not reach the QuickBooks service.',
    };
  }

  // Tolerate an empty / non-JSON body (e.g. an unexpected 5xx with no payload).
  const body = (await response.json().catch(() => null)) as
    | (Partial<T> & { error?: string })
    | null;

  if (!response.ok) {
    return { ok: false, error: body?.error || `HTTP ${response.status}` };
  }
  return { ok: true, data: (body ?? {}) as T };
}

export const qboConnectionService = {
  /** Current connection status from the single qbo_connection row. */
  async getStatus(): Promise<QboStatus> {
    const res = await call<QboStatus>('status', 'GET');
    if (!res.ok || !res.data) {
      // Treat any failure as "not connected" for display; the view shows the error
      // separately. Never throw — this drives the always-rendered status banner.
      return { connected: false };
    }
    return { ...res.data, connected: !!res.data.connected };
  },

  /**
   * Begin the OAuth handshake: ask the function for a signed Intuit authorize URL,
   * then redirect the browser to Intuit. Intuit later calls our /callback, which
   * persists the tokens and 302s back to the integrations screen with ?qbo=connected.
   * Returns an error string only when the URL could not be obtained (no redirect).
   */
  async startAuthorize(): Promise<{ ok: boolean; error?: string }> {
    const res = await call<{ url: string }>('authorize', 'GET');
    if (!res.ok || !res.data?.url) {
      return { ok: false, error: res.error || 'Could not start the QuickBooks connection.' };
    }
    window.location.href = res.data.url;
    return { ok: true };
  },

  /** Disconnect: delete the stored connection (and its tokens) server-side. */
  async disconnect(): Promise<{ ok: boolean; error?: string }> {
    const res = await call<{ ok: boolean }>('disconnect', 'POST');
    if (!res.ok) return { ok: false, error: res.error || 'Could not disconnect QuickBooks.' };
    return { ok: true };
  },

  /**
   * Verify the connection end-to-end: the function refreshes the access token if
   * needed, then calls the Intuit companyinfo endpoint and returns the company name.
   */
  async testCompanyInfo(): Promise<QboActionResult<QboCompanyInfo>> {
    return call<QboCompanyInfo>('companyinfo', 'GET');
  },
};
