import React, { useState, useEffect } from 'react';
import { checkOnSite } from '@/lib/geoUtils';

interface OnSiteGateProps {
  children: React.ReactNode;
  onLogout: () => void;
  /** When true, block children until user is within geofence */
  enforceAtLogin: boolean;
  siteLat: number;
  siteLng: number;
  radiusMeters: number;
}

/**
 * When enforceAtLogin is true, checks location and only renders children if user is on site.
 * Otherwise renders children immediately.
 */
export const OnSiteGate: React.FC<OnSiteGateProps> = ({
  children,
  onLogout,
  enforceAtLogin,
  siteLat,
  siteLng,
  radiusMeters,
}) => {
  const [status, setStatus] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (!enforceAtLogin) {
      setStatus('allowed');
      return;
    }
    let cancelled = false;
    checkOnSite({ siteLat, siteLng, radiusMeters }).then((result) => {
      if (cancelled) return;
      if (result.allowed) {
        setStatus('allowed');
      } else {
        setStatus('denied');
        setReason(
          result.reason === 'permission_denied'
            ? 'Location permission denied. Allow location to use the app on site.'
            : result.reason === 'timeout'
              ? 'Location request timed out. Please try again.'
              : result.reason === 'outside_geofence'
                ? "You're not within the allowed site area. Come on site to use the app."
                : 'Location unavailable. Enable location and try again.'
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enforceAtLogin, siteLat, siteLng, radiusMeters]);

  if (!enforceAtLogin || status === 'allowed') {
    return <>{children}</>;
  }

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark px-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="mt-4 text-slate-400">Checking location...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark px-4">
      <div className="max-w-sm rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-amber-400">location_off</span>
        <h2 className="mt-4 text-lg font-bold text-white">On-site required</h2>
        <p className="mt-2 text-sm text-slate-300">{reason}</p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-6 min-h-[44px] touch-manipulation rounded-sm border border-white/20 bg-white/10 px-6 py-3 font-medium text-white transition-colors hover:bg-white/20"
        >
          Log out
        </button>
      </div>
    </div>
  );
};
