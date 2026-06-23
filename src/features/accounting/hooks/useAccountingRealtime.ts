import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeToPrivateBroadcast, broadcastTopics } from '@/services/api/realtimeBroadcast';
import { ACCOUNTING_QUERY_KEYS } from '../constants';

/**
 * Live-updates accounting screens via Broadcast-from-Database. The accounting.* tables
 * carry a trigger (migration *_accounting_realtime_broadcast) that calls
 * realtime.broadcast_changes() to the private 'accounting' topic on every AR/AP change.
 * Here we subscribe and invalidate the matching React Query caches so any open accounting
 * view refetches.
 *
 * Mounted in AccountingRouter, so it is active ONLY while an accounting screen is open
 * (and only for admins/accounting users — AdminGuard + the realtime.messages RLS both
 * enforce that). Invalidations are debounced+deduped so a burst (e.g. one payment applied
 * across several invoices) collapses into a single refetch per affected subtree.
 */

// Map a changed accounting table to the query-key prefixes that should refetch.
// React Query matches by prefix, so a list/detail/sub-list subtree is covered by its root.
function keysForTable(table: string): readonly unknown[][] {
  switch (table) {
    case 'invoices':
      return [
        [...ACCOUNTING_QUERY_KEYS.invoices],
        [...ACCOUNTING_QUERY_KEYS.reports],
        [...ACCOUNTING_QUERY_KEYS.jobCosting],
      ];
    case 'payments':
      // Customer payments shift invoice balances too.
      return [
        [...ACCOUNTING_QUERY_KEYS.payments],
        [...ACCOUNTING_QUERY_KEYS.invoices],
        [...ACCOUNTING_QUERY_KEYS.reports],
      ];
    case 'bills':
      return [
        [...ACCOUNTING_QUERY_KEYS.bills],
        [...ACCOUNTING_QUERY_KEYS.reports],
        [...ACCOUNTING_QUERY_KEYS.jobCosting],
      ];
    case 'vendor_payments':
      return [
        [...ACCOUNTING_QUERY_KEYS.vendorPayments],
        [...ACCOUNTING_QUERY_KEYS.bills],
        [...ACCOUNTING_QUERY_KEYS.reports],
      ];
    default:
      // Unknown table: refetch the whole accounting subtree (only active queries refetch).
      return [[...ACCOUNTING_QUERY_KEYS.all]];
  }
}

export function useAccountingRealtime(): void {
  const queryClient = useQueryClient();
  const pendingTables = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = (): void => {
      flushTimer.current = null;
      const tables = Array.from(pendingTables.current);
      pendingTables.current.clear();

      const invalidated = new Set<string>();
      for (const table of tables) {
        for (const key of keysForTable(table)) {
          const id = JSON.stringify(key);
          if (invalidated.has(id)) continue;
          invalidated.add(id);
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    };

    const unsub = subscribeToPrivateBroadcast(
      broadcastTopics.accounting(),
      ['INSERT', 'UPDATE', 'DELETE'],
      (_event, payload) => {
        const table = typeof payload.table === 'string' ? payload.table : 'unknown';
        pendingTables.current.add(table);
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(flush, 250);
      }
    );

    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      unsub();
    };
  }, [queryClient]);
}
