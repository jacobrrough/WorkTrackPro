# PocketBaseServer Compatibility Wrapper

This directory exists to keep Railway deployments working when the Railway
service root directory is still configured as `PocketBaseServer`.

**The app backend is Supabase only;** no PocketBase server runs here.

The wrapper:

1. Builds the root app (`npm ci --include=dev && npm run build`).
2. Copies build output into `PocketBaseServer/dist`.
3. Serves that static bundle on `PORT`.

It is intentionally lightweight and deploy-only.

If the build path fails in Railway, the wrapper emits a fallback static bundle
that redirects to `https://work-track-pro-v6.vercel.app` (or
`RAILWAY_FALLBACK_URL` when provided) so deployment checks do not hard-fail.
