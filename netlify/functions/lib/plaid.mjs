// Tiny Plaid REST client — WorkTrackAccounting bank-feeds backend.
//
// Raw `fetch` only; we deliberately do NOT depend on the `plaid` npm SDK (keeps the
// Netlify function bundle small and avoids a heavy transitive tree). Pure ESM, Node 20.
//
// HOUSE STYLE (mirrors netlify/functions/qbo-oauth.mjs): credentials come from the env
// ONLY (PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV); errors surface a generic-but-useful
// message; secrets are NEVER logged. Plaid's client_id, secret, access_token and
// public_token must never appear in a log line — only Plaid's own error_code/error_message
// (which are non-secret) are echoed.
//
// BASE URL by environment:
//   PLAID_ENV='production' -> https://production.plaid.com
//   anything else (incl. 'sandbox', unset) -> https://sandbox.plaid.com
// (Plaid's legacy 'development' tier is retired; sandbox is the safe default.)

const PRODUCTION_BASE = 'https://production.plaid.com';
const SANDBOX_BASE = 'https://sandbox.plaid.com';

// Resolve the API base from the env on every call (not cached at module load) so a redeploy
// that flips PLAID_ENV — and tests that set it per-case — see the current value.
function getBaseUrl() {
  const env = (process.env.PLAID_ENV || '').trim().toLowerCase();
  return env === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

// POST JSON to Plaid. The client_id/secret are injected here so callers never handle them.
// Throws an Error on a non-2xx response, carrying Plaid's error_code/error_message (and the
// HTTP status + request_id) for callers to branch on — e.g. syncItem() checks error_code
// === 'ITEM_LOGIN_REQUIRED'. The thrown Error's `message` is safe to surface to the client.
export async function plaidPost(path, body) {
  const url = getBaseUrl() + path;

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        ...body,
      }),
    });
  } catch (err) {
    // Network / DNS failure — never includes credentials, but keep the message generic.
    throw new Error(`Plaid request failed: ${err?.message || 'network error'}`);
  }

  // Parse the JSON body once; Plaid returns JSON for both success and error responses.
  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    const code = data?.error_code || 'PLAID_ERROR';
    const msg = data?.error_message || `Plaid request failed (HTTP ${resp.status})`;
    // Log only Plaid's non-secret diagnostics (NEVER the request body / tokens).
    console.error('plaid error:', resp.status, code, data?.request_id || '');
    const error = new Error(msg);
    error.plaidErrorCode = code;
    error.plaidErrorMessage = msg;
    error.status = resp.status;
    error.requestId = data?.request_id || null;
    return Promise.reject(error);
  }

  return data;
}

// ── Thin endpoint wrappers ──────────────────────────────────────────────────
// Each returns Plaid's raw JSON payload. access_token, when present, is passed straight
// through to plaidPost and never logged.

// Create a Link token. Default (initial) link is for the 'transactions' product. If an
// existing accessToken is supplied we enter UPDATE mode (re-auth an Item whose login broke):
// per Plaid's contract you pass access_token and MUST OMIT `products`.
export function createLinkToken({ clientUserId, accessToken } = {}) {
  const body = {
    user: { client_user_id: clientUserId },
    client_name: 'WorkTrackPro',
    country_codes: ['US'],
    language: 'en',
  };
  // OAuth support: when PLAID_REDIRECT_URI is configured, set it on the SHARED body (applies to
  // BOTH initial and update mode) so OAuth-required institutions (e.g. Chase) can redirect the
  // browser back to the app to finish Link. Unset = omitted entirely, keeping sandbox / non-OAuth
  // banks working exactly as before. The redirect URI must be registered in the Plaid dashboard.
  const redirectUri = (process.env.PLAID_REDIRECT_URI || '').trim();
  if (redirectUri) body.redirect_uri = redirectUri;
  if (accessToken) {
    // UPDATE mode — re-authenticate an existing Item; products must be omitted.
    body.access_token = accessToken;
  } else {
    body.products = ['transactions'];
  }
  return plaidPost('/link/token/create', body);
}

// Exchange a short-lived public_token (from Link) for a long-lived access_token + item_id.
export function exchangePublicToken(publicToken) {
  return plaidPost('/item/public_token/exchange', { public_token: publicToken });
}

// List the accounts (and balances) under an Item.
export function getAccounts(accessToken) {
  return plaidPost('/accounts/get', { access_token: accessToken });
}

// Fetch Item metadata (status, institution_id, available products, last error).
export function getItem(accessToken) {
  return plaidPost('/item/get', { access_token: accessToken });
}

// Look up an institution's display details by id (used to cache institution_name).
export function getInstitution(institutionId) {
  return plaidPost('/institutions/get_by_id', {
    institution_id: institutionId,
    country_codes: ['US'],
  });
}

// Incremental transactions sync. Returns the raw { added, modified, removed, next_cursor,
// has_more }. Pass the prior cursor to fetch only changes since then; omit/null for the
// first page of a brand-new Item.
export function transactionsSync(accessToken, cursor) {
  const body = { access_token: accessToken };
  if (cursor) body.cursor = cursor;
  return plaidPost('/transactions/sync', body);
}

// Invalidate an Item (disconnect). Plaid stops billing and revokes the access_token.
export function removeItem(accessToken) {
  return plaidPost('/item/remove', { access_token: accessToken });
}
