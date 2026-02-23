import { useCallback } from 'react';
import { useApp } from '@/AppContext';
import { useSettings } from '@/contexts/SettingsContext';
import { checkOnSite } from '@/lib/geoUtils';
import { useToast } from '@/Toast';

/**
 * Returns a clock-in function that runs the on-site geofence check when required by org settings.
 * Applies only to standard (non-admin) users; admins can clock in from anywhere.
 */
export function useClockInWithOnSiteCheck(): (jobId: string) => Promise<boolean> {
  const { clockIn, currentUser } = useApp();
  const { settings } = useSettings();
  const { showToast } = useToast();

  return useCallback(
    async (jobId: string): Promise<boolean> => {
      const { requireOnSite, siteLat, siteLng, siteRadiusMeters } = settings;
      const skipCheck = currentUser?.isAdmin === true;
      if (
        !skipCheck &&
        requireOnSite &&
        siteLat != null &&
        siteLng != null &&
        siteRadiusMeters != null &&
        siteRadiusMeters >= 10
      ) {
        const result = await checkOnSite({
          siteLat,
          siteLng,
          radiusMeters: siteRadiusMeters,
        });
        if (!result.allowed) {
          const msg =
            result.reason === 'permission_denied'
              ? 'Allow location to clock in on site.'
              : result.reason === 'outside_geofence'
                ? 'You must be on site to clock in.'
                : result.reason === 'timeout'
                  ? 'Location timed out. Try again.'
                  : 'Location required to clock in.';
          showToast(msg, 'error');
          return false;
        }
      }
      return clockIn(jobId);
    },
    [clockIn, currentUser?.isAdmin, settings.requireOnSite, settings.siteLat, settings.siteLng, settings.siteRadiusMeters, showToast]
  );
}
