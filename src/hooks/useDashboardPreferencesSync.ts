import { useEffect, useRef, useCallback } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useDashboardPreferences, useUpdateDashboardPreferences } from './useDashboardPreferences';
import type { DashboardPreferences } from '@/core/types';

// Records the server version (its updatedAt) this device is currently in sync
// with. Owned solely by this hook — the navigation state no longer stamps it,
// so a local re-render can never make a device look "newer" than the server it
// just pulled from.
const LS_TIMESTAMP_KEY = 'dashboardPrefs_updatedAt';

function getLocalTimestamp(): string | null {
  try {
    return localStorage.getItem(LS_TIMESTAMP_KEY);
  } catch {
    return null;
  }
}

function setLocalTimestamp(ts: string) {
  try {
    localStorage.setItem(LS_TIMESTAMP_KEY, ts);
  } catch {
    // best-effort
  }
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function samePrefs(a: DashboardPreferences, b: DashboardPreferences): boolean {
  return (
    sameList(a.quickActionOrder, b.quickActionOrder) &&
    sameList(a.hiddenQuickActions, b.hiddenQuickActions)
  );
}

// Parse an ISO timestamp to epoch ms for ordering. Returns null when missing or
// unparseable so callers treat it as "unknown" instead of ordering it wrong —
// and so DB round-trip format differences ("Z" vs "+00:00") never break a raw
// string compare.
function tsToMs(ts: string | null): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

function hasCustomizations(prefs: DashboardPreferences): boolean {
  return prefs.quickActionOrder.length > 0 || prefs.hiddenQuickActions.length > 0;
}

export function useDashboardPreferencesSync(enabled: boolean) {
  const { state: navState, updateState } = useNavigation();
  const { data: serverData, isSuccess } = useDashboardPreferences(enabled);
  const { mutate: updateServer } = useUpdateDashboardPreferences();
  const hasSynced = useRef(false);

  const syncToServer = useCallback(
    (prefs: DashboardPreferences) => {
      const now = new Date().toISOString();
      setLocalTimestamp(now);
      updateServer({ preferences: prefs, updatedAt: now });
    },
    [updateServer]
  );

  useEffect(() => {
    // Wait for a real server result. getPreferences now throws on read errors,
    // so isSuccess only flips true on genuine data — a flaky read can no longer
    // masquerade as an empty default and lock the layout to default. Because we
    // only set hasSynced once we actually reconcile, a failed read followed by a
    // successful retry still reconciles correctly.
    if (!isSuccess || !serverData || hasSynced.current) return;
    hasSynced.current = true;

    const localPrefs: DashboardPreferences = {
      quickActionOrder: navState.quickActionOrder,
      hiddenQuickActions: navState.hiddenQuickActions,
    };
    const serverPrefs = serverData.preferences;
    const serverTs = serverData.updatedAt;

    // Already identical — just record the server version we are in sync with.
    // This also stops the steady-state churn of re-pushing matching prefs on
    // every dashboard mount.
    if (samePrefs(localPrefs, serverPrefs)) {
      if (serverTs) setLocalTimestamp(serverTs);
      return;
    }

    const localMs = tsToMs(getLocalTimestamp());
    const serverMs = tsToMs(serverTs);

    // Server wins when it carries a customization that is newer than the last
    // version this device synced with — or when we cannot prove local is newer
    // (this device never synced, or the server timestamp is unparseable).
    // Adopting the server copy in the uncertain case avoids pushing local over a
    // real server customization we have no reliable way to compare against.
    const serverIsNewer =
      hasCustomizations(serverPrefs) &&
      (localMs === null || serverMs === null || serverMs > localMs);

    if (serverIsNewer) {
      updateState({
        quickActionOrder: serverPrefs.quickActionOrder,
        hiddenQuickActions: serverPrefs.hiddenQuickActions,
      });
      if (serverTs) setLocalTimestamp(serverTs);
    } else if (hasCustomizations(localPrefs)) {
      syncToServer(localPrefs);
    }
  }, [
    isSuccess,
    serverData,
    navState.quickActionOrder,
    navState.hiddenQuickActions,
    updateState,
    syncToServer,
  ]);

  return { syncToServer };
}
