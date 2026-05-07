/**
 * Debounces realtime refresh calls by key (e.g. job ID) so rapid
 * related-table changes batch into a single refetch.
 */
export function createRealtimeDebouncer(delayMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function debounce(key: string, callback: () => void): void {
    const existing = timers.get(key);
    if (existing != null) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        callback();
      }, delayMs)
    );
  }

  function cleanup(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { debounce, cleanup };
}
