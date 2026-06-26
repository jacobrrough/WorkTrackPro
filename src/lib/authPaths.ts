// Single source of truth for "is this an internal employee-app path?" — used both
// by App.tsx's safeReturnTo (validating a returnTo before <Navigate>) and by
// hardLogout (building the /login?returnTo target before window.location.replace).
// Keeping ONE predicate is deliberate: window.location.replace honors absolute
// URLs, so the allow-list that guards it must never silently drift from the one
// the router uses.
//
// NOTE: this is the *protected* employee-app surface only. It deliberately
// EXCLUDES /login — a returnTo must never resolve back to the login page, or a
// post-login redirect would loop to itself. Do not add /login here.
export function isInternalAppPath(path: string): boolean {
  return path === '/app' || path.startsWith('/app/') || path.startsWith('/app?');
}
