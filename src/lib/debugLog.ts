/**
 * Debug session logging: POSTs to debug log server on first free port in 7243..7262.
 * Tries ports in parallel; first success wins. No-op if server not running.
 */
const DEBUG_LOG_PORTS = Array.from({ length: 20 }, (_, i) => 7243 + i);
const INGEST_PATH = '/ingest/420c3f8e-a11f-4fdd-8f0d-e05619cdd04d';
const SESSION_ID = '7c14cd';

export function debugLog(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  Promise.any(
    DEBUG_LOG_PORTS.map((port) =>
      fetch(`http://127.0.0.1:${port}${INGEST_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION_ID },
        body,
      }).then((r) => (r.ok ? r : Promise.reject(new Error('not ok'))))
    )
  ).catch(() => {});
  if (typeof console !== 'undefined' && console.log) {
    console.log('[WTP_DEBUG]', body);
  }
}
