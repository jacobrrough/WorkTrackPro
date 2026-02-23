/**
 * Geofence / on-site check for WorkTrack Pro.
 * Uses browser Geolocation API; requires HTTPS (or localhost) and user permission.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_AGE_MS = 60_000;

export interface GeoPosition {
  latitude: number;
  longitude: number;
}

/**
 * Haversine distance in meters between two lat/lng points.
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Returns true if (userLat, userLng) is within radiusMeters of (siteLat, siteLng).
 */
export function isWithinRadius(
  siteLat: number,
  siteLng: number,
  radiusMeters: number,
  userLat: number,
  userLng: number
): boolean {
  return distanceMeters(siteLat, siteLng, userLat, userLng) <= radiusMeters;
}

export type GetCurrentPositionResult =
  | { ok: true; position: GeoPosition }
  | { ok: false; error: 'unsupported' | 'permission_denied' | 'timeout' | 'unavailable' };

/**
 * Get current device position. Requires HTTPS (or localhost) and user permission.
 */
export function getCurrentPosition(options?: {
  timeoutMs?: number;
  maxAgeMs?: number;
}): Promise<GetCurrentPositionResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, error: 'unsupported' });
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          ok: true,
          position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        });
      },
      (err) => {
        const error =
          err.code === 1
            ? 'permission_denied'
            : err.code === 3
              ? 'timeout'
              : 'unavailable';
        resolve({ ok: false, error });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maxAgeMs }
    );
  });
}

/**
 * Check if the user is currently within the configured site geofence.
 * Returns { allowed: true } or { allowed: false, reason }.
 */
export async function checkOnSite(options: {
  siteLat: number;
  siteLng: number;
  radiusMeters: number;
}): Promise<
  | { allowed: true }
  | { allowed: false; reason: 'unsupported' | 'permission_denied' | 'timeout' | 'unavailable' | 'outside_geofence' }
> {
  const { siteLat, siteLng, radiusMeters } = options;
  const result = await getCurrentPosition({ timeoutMs: 12_000 });
  if (!result.ok) {
    return { allowed: false, reason: result.error };
  }
  const within = isWithinRadius(
    siteLat,
    siteLng,
    radiusMeters,
    result.position.latitude,
    result.position.longitude
  );
  if (!within) {
    return { allowed: false, reason: 'outside_geofence' };
  }
  return { allowed: true };
}
