// Reusable Resend mailer for the Netlify functions (extracted verbatim in behavior from
// submit-proposal.js so the proposal flow and the new accounting email/dunning functions
// share ONE hardened sender). Pure ESM; no Supabase or app imports.
//
// What it provides:
//   • sendResendEmail()        — POST /emails with up to 3 attempts and 429-aware backoff
//                                (Retry-After / x-ratelimit-reset honored), returning the
//                                provider message id.
//   • getResendEmailLastEvent()— GET /emails/:id to poll the last delivery event.
//   • isTerminalEmailFailure() — classify a last_event as a hard bounce/failure.
//   • escapeHtml / sanitizeText / normalizeResendError / sleep — small shared helpers.
//
// Env: RESEND_API_KEY must be set (the caller validates presence; sendResendEmail also
// guards and returns a clear error so it can never throw on a missing key).

export function sanitizeText(input) {
  return String(input ?? '').trim();
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeResendError(rawError) {
  const text = sanitizeText(rawError);
  if (!text) return 'Email delivery failed.';
  return text.replace(/^Resend error:\s*/i, '').trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Derive a backoff delay (ms) from a 429 response: prefer Retry-After (seconds or HTTP
 * date), then x-ratelimit-reset (seconds), else a jittered fallback that keeps us under
 * Resend's ~2 req/sec limit. Mirrors submit-proposal.js exactly.
 */
export function parseRetryDelayMs(response, attempt) {
  const retryAfter = sanitizeText(response.headers.get('retry-after'));
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(250, Math.ceil(seconds * 1000));
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(250, retryAt - Date.now());
    }
  }

  const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(resetSeconds) && resetSeconds >= 0) {
    return Math.max(250, Math.ceil(resetSeconds * 1000));
  }

  return 600 + attempt * 350;
}

/**
 * Send one email through Resend with retry + 429 backoff. Returns
 * { ok:true, id, status } or { ok:false, error, status? }. Never throws on a missing key
 * or transport error — the caller surfaces `error`.
 */
export async function sendResendEmail({ from, to, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'Missing RESEND_API_KEY' };
  if (!from) return { ok: false, error: 'Missing email From address' };
  if (!to) return { ok: false, error: 'Missing email To address' };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html,
          text,
          ...(replyTo ? { reply_to: [replyTo] } : {}),
        }),
      });
    } catch (e) {
      return { ok: false, error: `Resend request failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const messageId = typeof payload?.id === 'string' ? payload.id : '';
      if (!messageId) {
        return {
          ok: false,
          error: 'Resend accepted request but did not return an email id.',
          status: response.status,
        };
      }
      return { ok: true, id: messageId, status: response.status };
    }

    const body = await response.text().catch(() => '');
    const isRateLimited = response.status === 429;
    const canRetry = isRateLimited && attempt < maxAttempts;
    if (!canRetry) {
      return {
        ok: false,
        error: `Resend error: ${response.status} ${body}`.trim(),
        status: response.status,
      };
    }

    const delayMs = parseRetryDelayMs(response, attempt);
    await sleep(delayMs);
  }

  return { ok: false, error: 'Email retry attempts exhausted.' };
}

/** Poll a sent email's last delivery event (e.g. 'delivered', 'bounced'). Null on any error. */
export async function getResendEmailLastEvent(emailId) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !emailId) return null;

  try {
    const response = await fetch(`https://api.resend.com/emails/${emailId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const lastEvent = sanitizeText(payload?.last_event).toLowerCase();
    return lastEvent || null;
  } catch {
    return null;
  }
}

/** A last_event that means the message will not be delivered. */
export function isTerminalEmailFailure(lastEvent) {
  return ['bounced', 'failed', 'suppressed', 'complained', 'canceled'].includes(lastEvent);
}
