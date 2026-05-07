/* eslint-disable react-refresh/only-export-components -- exports hook + provider for this context */
import React, { createContext, useContext, useCallback } from 'react';
import { useApp } from '@/AppContext';
import type { ClockPunchResult } from '@/core/clockPunch';
import { useClockInWithOnSiteCheck } from '@/hooks/useClockInWithOnSiteCheck';
import { useSettings } from '@/contexts/SettingsContext';
import { OnSiteGate } from '@/components/OnSiteGate';

interface ClockInContextValue {
  clockIn: (jobId: string) => Promise<ClockPunchResult>;
  onClockInByCode: (
    code: number
  ) => Promise<{ success: boolean; message: string; queued?: boolean; authExpired?: boolean }>;
}

const ClockInContext = createContext<ClockInContextValue | null>(null);

export function useClockIn(): ClockInContextValue | null {
  return useContext(ClockInContext);
}

interface ClockInProviderProps {
  children: React.ReactNode;
}

/**
 * Provides on-site-checked clockIn and onClockInByCode, and optionally gates content with OnSiteGate when enforceOnSiteAtLogin.
 * Must be used inside SettingsProvider and AppContext (AppShell).
 */
// On-site gate (enforce at login) applies only to standard users. Admins can use the app from anywhere.
export const ClockInProvider: React.FC<ClockInProviderProps> = ({ children }) => {
  const { getJobByCode, logout, currentUser } = useApp();
  const wrappedClockIn = useClockInWithOnSiteCheck();
  const { settings } = useSettings();

  // Wraps wrappedClockIn so every consumer (JobDetail, JobList, ClockInScreen)
  // automatically gets the logout() call when authExpired is true — no need to
  // repeat that logic in every component that has a clock-in button.
  const clockInWithAuth = useCallback(
    async (jobId: string): Promise<ClockPunchResult> => {
      const result = await wrappedClockIn(jobId);
      if (result.authExpired) logout();
      return result;
    },
    [wrappedClockIn, logout]
  );

  const onClockInByCode = useCallback(
    async (
      code: number
    ): Promise<{ success: boolean; message: string; queued?: boolean; authExpired?: boolean }> => {
      const job = await getJobByCode(code);
      if (!job) return { success: false, message: 'Job not found' };
      const { ok, queued, authExpired } = await clockInWithAuth(job.id);
      if (ok) return { success: true, message: 'Clocked in' };
      if (authExpired) {
        // logout() already called inside clockInWithAuth above
        return {
          success: false,
          message: 'Session expired — please log in again',
          authExpired: true,
        };
      }
      if (queued) {
        return {
          success: false,
          message: 'Saved offline — will sync when connected',
          queued: true,
        };
      }
      return { success: false, message: 'Failed to clock in' };
    },
    [getJobByCode, clockInWithAuth]
  );

  const value: ClockInContextValue = {
    clockIn: clockInWithAuth,
    onClockInByCode,
  };

  const isStandardUser = currentUser != null && !currentUser.isAdmin;
  const enforceAtLogin =
    isStandardUser &&
    settings.requireOnSite &&
    settings.enforceOnSiteAtLogin &&
    settings.siteLat != null &&
    settings.siteLng != null &&
    settings.siteRadiusMeters != null &&
    settings.siteRadiusMeters >= 10;

  const content = enforceAtLogin ? (
    <OnSiteGate
      onLogout={logout}
      enforceAtLogin
      siteLat={settings.siteLat ?? 0}
      siteLng={settings.siteLng ?? 0}
      radiusMeters={settings.siteRadiusMeters ?? 100}
    >
      {children}
    </OnSiteGate>
  ) : (
    children
  );

  return <ClockInContext.Provider value={value}>{content}</ClockInContext.Provider>;
};
