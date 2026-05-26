import { useEffect, useRef, useCallback } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useDashboardPreferences, useUpdateDashboardPreferences } from './useDashboardPreferences';
import type { DashboardPreferences } from '@/core/types';

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

export function useDashboardPreferencesSync(enabled: boolean) {
  const { state: navState, updateState } = useNavigation();
  const { data: serverData, isSuccess } = useDashboardPreferences(enabled);
  const { mutate: updateServer } = useUpdateDashboardPreferences();
  const hasSynced = useRef(false);

  useEffect(() => {
    if (!isSuccess || !serverData || hasSynced.current) return;
    hasSynced.current = true;

    const localOrder = navState.quickActionOrder;
    const localHidden = navState.hiddenQuickActions;
    const localHasCustomizations = localOrder.length > 0 || localHidden.length > 0;

    const serverOrder = serverData.preferences.quickActionOrder;
    const serverHidden = serverData.preferences.hiddenQuickActions;
    const serverHasCustomizations = serverOrder.length > 0 || serverHidden.length > 0;

    if (!localHasCustomizations && !serverHasCustomizations) return;

    const localTs = getLocalTimestamp();
    const serverTs = serverData.updatedAt;

    if (serverHasCustomizations && (!localTs || serverTs > localTs)) {
      updateState({
        quickActionOrder: serverOrder,
        hiddenQuickActions: serverHidden,
      });
      setLocalTimestamp(serverTs);
    } else if (localHasCustomizations) {
      const prefs: DashboardPreferences = {
        quickActionOrder: localOrder,
        hiddenQuickActions: localHidden,
      };
      updateServer(prefs);
    }
  }, [
    isSuccess,
    serverData,
    navState.quickActionOrder,
    navState.hiddenQuickActions,
    updateState,
    updateServer,
  ]);

  const syncToServer = useCallback(
    (prefs: DashboardPreferences) => {
      const now = new Date().toISOString();
      setLocalTimestamp(now);
      updateServer(prefs);
    },
    [updateServer]
  );

  return { syncToServer };
}
