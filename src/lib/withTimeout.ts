// Prevents a hanging network call from blocking the UI indefinitely. This guards
// against "lie-fi" — a captive or degraded Wi-Fi connection where navigator.onLine
// is still true but the request neither resolves nor rejects. On timeout the promise
// rejects so callers can fall back (e.g. queue a clock punch offline) instead of
// spinning forever.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Network call timed out after ${ms}ms`)), ms);
  });
  // Clear the timer once either side settles so a fast success doesn't leak a pending
  // timer (and its closure) for the full `ms` on this hot, repeatedly-tapped path.
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
