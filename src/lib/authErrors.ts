/**
 * Typed error thrown when a Supabase operation is blocked because the session
 * is missing or expired. Throwing a typed class (instead of a plain Error) lets
 * callers distinguish "auth problem" from "network problem" without string-matching.
 */
export class AuthSessionError extends Error {
  readonly isAuthSessionError = true;
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'AuthSessionError';
  }
}

/**
 * Returns true when `err` is a Supabase / PostgREST authentication failure.
 * Checks HTTP status codes, PostgREST error codes, and JWT message strings so
 * we catch the error no matter which layer of the stack it surfaces from.
 */
export function isAuthError(err: unknown): boolean {
  if (err instanceof AuthSessionError) return true;
  if (err == null || typeof err !== 'object') return false;

  const e = err as Record<string, unknown>;

  // PostgREST "JWT required" error code
  if (e['code'] === 'PGRST301') return true;

  // PostgreSQL "insufficient_privilege" — RLS blocked an unauthenticated user
  if (e['code'] === '42501') return true;

  // HTTP status from Supabase REST or Storage
  const status = Number(e['status']);
  if (status === 401 || status === 403) return true;

  // JWT-related message strings (case-insensitive)
  const msg = typeof e['message'] === 'string' ? e['message'].toLowerCase() : '';
  return (
    msg.includes('jwt expired') ||
    msg.includes('not authenticated') ||
    msg.includes('invalid jwt') ||
    msg.includes('pgrst301')
  );
}
