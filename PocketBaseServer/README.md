# PocketBaseServer Compatibility Wrapper

This directory exists to keep Railway deployments working when the Railway
service root directory is still configured as `PocketBaseServer`.

The current app lives at repository root, so this wrapper:

1. Builds the root app (`npm ci --include=dev && npm run build`).
2. Copies build output into `PocketBaseServer/dist`.
3. Serves that static bundle on `PORT`.

It is intentionally lightweight and deploy-only.
