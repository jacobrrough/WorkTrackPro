import { createHash, timingSafeEqual } from 'node:crypto';

// Shared auth for the Gmail Add-on endpoints (boards-for-addon, create-card-from-email).
// Kept in one place so the two endpoints can't drift on their auth check.

// Constant-time string compare. Hashing both sides to a fixed 32-byte digest lets
// timingSafeEqual run without leaking length (and without throwing on length
// mismatch), so a token guess can't be refined by measuring response time.
export function constantTimeEqual(a, b) {
  const ha = createHash('sha256').update(String(a), 'utf8').digest();
  const hb = createHash('sha256').update(String(b), 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

// Pure Bearer-token check. A missing/empty expected key never authorizes, the header
// must carry a "Bearer " prefix, and the trimmed token must equal the key (compared in
// constant time). Exported so the boundary can be unit-tested without a Netlify event.
export function isAuthorized(authHeader, expectedKey) {
  if (!expectedKey) return false;
  const auth = (authHeader || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  return constantTimeEqual(auth.slice(7).trim(), expectedKey);
}
