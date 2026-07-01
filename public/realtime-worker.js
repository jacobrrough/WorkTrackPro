// Supabase Realtime heartbeat worker (see supabaseClient.ts `realtime.worker`).
//
// The default realtime-js heartbeat is a setInterval on the MAIN thread
// (RealtimeClient._startHeartbeat). Browsers throttle main-thread timers in
// backgrounded tabs / locked phones (and heavy CPU load starves them in dev),
// so heartbeats stop, Supabase drops the socket after ~60s of silence, and the
// app logs "[realtime:core] TIMED_OUT — reconnecting" in a cycle. Worker timers
// are exempt from tab throttling, and each tick postMessages the main thread
// awake to send the heartbeat.
//
// Served same-origin (script-src 'self' in public/_headers) instead of using
// realtime-js's default Blob-URL worker, which our CSP would block. The
// protocol mirrors realtime-js's built-in WORKER_SCRIPT exactly: receive
// {event:'start', interval}, then post {event:'keepAlive'} every interval.
addEventListener('message', (e) => {
  if (e.data.event === 'start') {
    setInterval(() => postMessage({ event: 'keepAlive' }), e.data.interval);
  }
});
