// WorkTrackAccounting — PHASE E (E5) shared rate-limit + input-hardening helpers
// ============================================================================
// ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. Requires a SECURITY review before it is
//     enabled. This module is DESIGNED to be INERT by default: every helper is a NO-OP unless the
//     SERVER env var ACCOUNTING_SECURITY_HARDENING_ENABLED is explicitly truthy. A Netlify function
//     cannot be gated by a frontend build flag, so THIS server gate is the isolation guarantee — it
//     means dropping these calls into the existing functions does NOT change their behavior until an
//     operator flips the env on. Default OFF.
//
// WHAT THIS PROVIDES (best-effort, dependency-free, no external store):
//   • isHardeningEnabled()         — the hard server gate (truthy env only; else inert).
//   • rateLimit(key, perWindow, windowMs) — a per-WARM-INSTANCE fixed-window counter. Returns
//       { limited, remaining, retryAfterSec }. When the gate is OFF it ALWAYS returns
//       { limited:false } (never blocks). LIMITATION: Netlify functions are horizontally scaled and
//       cold-start, so this in-memory counter is a coarse, best-effort throttle per instance — it is
//       NOT a distributed rate limiter. A real deployment should back this with Upstash/Redis or the
//       Netlify rate-limit primitive. This is on the HUMAN-VERIFY list.
//   • clientKeyFromEvent(event, salt) — a stable bucket key from the client IP (x-nf-client-connection-ip
//       / x-forwarded-for) + an optional route salt, so limits are per-caller-per-route.
//   • enforceBodyLimit(event, maxBytes) — reject an over-cap request body (input hardening). Inert
//       when the gate is OFF. Returns { tooLarge, bytes }.
//   • safeJsonParse(text, fallback) — never-throw JSON parse for untrusted bodies.
//   • tooManyRequestsResponse / payloadTooLargeResponse — standard 429 / 413 responses.
//
// DEFAULT LIMITS come from env (which mirror the seeded accounting.settings 'security_rate_limits'
// row, migration 033) with safe fallbacks, so the values are operator-tunable without code changes:
//   ACCOUNTING_RL_DEFAULT_PER_MINUTE, ACCOUNTING_RL_TAX_REFRESH_PER_HOUR,
//   ACCOUNTING_RL_SUBMIT_PROPOSAL_PER_HOUR, ACCOUNTING_RL_ADDON_PER_MINUTE, ACCOUNTING_RL_MAX_BODY_BYTES.
//
// G3: nothing here moves money or posts a journal entry. It is a server-side guard only.
// ============================================================================

/** TRUE only for an explicit truthy value; anything else (unset/''/'false'/'0'/'off'/'no') = inert. */
export function isHardeningEnabled() {
  const v = (process.env.ACCOUNTING_SECURITY_HARDENING_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'enabled';
}

/** Read an integer env var with a fallback (used for the operator-tunable default limits). */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The resolved default limits (env-overridable; mirror the seeded settings row). */
export const LIMITS = {
  defaultPerMinute: () => envInt('ACCOUNTING_RL_DEFAULT_PER_MINUTE', 30),
  taxRefreshPerHour: () => envInt('ACCOUNTING_RL_TAX_REFRESH_PER_HOUR', 12),
  submitProposalPerHour: () => envInt('ACCOUNTING_RL_SUBMIT_PROPOSAL_PER_HOUR', 20),
  addonPerMinute: () => envInt('ACCOUNTING_RL_ADDON_PER_MINUTE', 60),
  maxBodyBytes: () => envInt('ACCOUNTING_RL_MAX_BODY_BYTES', 262144),
};

// ── In-memory fixed-window counter (per warm instance; best-effort) ───────────
// Map<bucketKey, { count, resetAt }>. Survives only within a warm function instance. A light sweep
// on access keeps the map from growing unbounded across many distinct keys.
const buckets = new Map();
let lastSweep = 0;

function sweep(now) {
  // Sweep at most once per 60s to bound the cost.
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Fixed-window rate-limit check for `key`. Allows `perWindow` hits per `windowMs`. Returns
 * { limited, remaining, retryAfterSec }. When hardening is OFF this is a NO-OP that always allows.
 * Best-effort + per-instance (see the file header LIMITATION).
 */
export function rateLimit(key, perWindow, windowMs) {
  if (!isHardeningEnabled()) return { limited: false, remaining: perWindow, retryAfterSec: 0 };
  const now = Date.now();
  sweep(now);
  const limit = Number.isFinite(perWindow) && perWindow > 0 ? Math.floor(perWindow) : 1;
  const win = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000;

  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + win };
    buckets.set(key, entry);
  }
  entry.count += 1;
  const over = entry.count > limit;
  return {
    limited: over,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSec: over ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0,
  };
}

/** Extract the client IP from the Netlify/standard headers (handler-event shape). */
function clientIpFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return 'unknown';
  const get = (name) => headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  const nf = get('x-nf-client-connection-ip');
  if (nf) return String(nf).trim();
  const fwd = get('x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim(); // first hop = original client
  const real = get('x-real-ip');
  if (real) return String(real).trim();
  return 'unknown';
}

/**
 * A stable bucket key for a caller on a route. Combines the client IP with a route `salt` so a
 * caller's limit on one endpoint is independent of another. Works for the Netlify "handler-event"
 * shape (event.headers). For the Functions-V2 Request shape, pass a plain headers object built from
 * request.headers (see eventLikeFromRequest below).
 */
export function clientKeyFromEvent(event, salt = '') {
  const headers = event?.headers ?? {};
  return `${salt}:${clientIpFromHeaders(headers)}`;
}

/**
 * Body-size guard (input hardening). Returns { tooLarge, bytes }. Inert (never tooLarge) when the
 * gate is OFF. Measures the UTF-8 byte length of the raw body string. Defends against an oversize
 * JSON payload before it is parsed. `maxBytes` defaults to the configured cap.
 */
export function enforceBodyLimit(event, maxBytes = LIMITS.maxBodyBytes()) {
  if (!isHardeningEnabled()) return { tooLarge: false, bytes: 0 };
  const body = event?.body;
  if (body == null) return { tooLarge: false, bytes: 0 };
  let bytes;
  try {
    bytes = Buffer.byteLength(typeof body === 'string' ? body : String(body), 'utf8');
  } catch {
    bytes = String(body).length;
  }
  return { tooLarge: bytes > maxBytes, bytes };
}

/** Never-throw JSON parse for untrusted request bodies. Returns `fallback` on any error. */
export function safeJsonParse(text, fallback = {}) {
  if (typeof text !== 'string' || text.trim() === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Standard 429 Too Many Requests (handler-event response shape). */
export function tooManyRequestsResponse(corsHeaders, retryAfterSec = 1) {
  return {
    statusCode: 429,
    headers: { ...corsHeaders, 'Retry-After': String(Math.max(1, retryAfterSec)) },
    body: JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
  };
}

/** Standard 413 Payload Too Large (handler-event response shape). */
export function payloadTooLargeResponse(corsHeaders, maxBytes) {
  return {
    statusCode: 413,
    headers: corsHeaders,
    body: JSON.stringify({ error: `Request body too large (max ${maxBytes} bytes).` }),
  };
}

// ── Functions-V2 (Request/Response) adapters ─────────────────────────────────
// The tax-table-refresh function uses the Functions-V2 Request/Response API (not handler-event).
// These build a minimal event-like object from a Request and a Web Response for a 429, so the SAME
// limiter serves both function styles.

/** Build a minimal { headers } event-like object from a Functions-V2 Request for clientKeyFromEvent. */
export function eventLikeFromRequest(request) {
  const headers = {};
  try {
    // request.headers is a Headers instance (iterable of [name, value]); names are already lower-cased.
    for (const [k, v] of request.headers) headers[k] = v;
  } catch {
    /* tolerate a non-iterable headers object */
  }
  return { headers };
}

/** A Functions-V2 429 Web Response (used by the tax-table-refresh manual trigger). */
export function tooManyRequestsWebResponse(corsHeaders, retryAfterSec = 1) {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
    {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': String(Math.max(1, retryAfterSec)) },
    }
  );
}
