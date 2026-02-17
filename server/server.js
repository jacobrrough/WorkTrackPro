/**
 * Production server for WorkTrack Pro.
 * Serves the Vite build and proxies /api and /_ to PocketBase.
 * Use with Cloudflare Tunnel so HTTPS is handled by Cloudflare.
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const POCKETBASE_INTERNAL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8091';
const DIST = path.join(__dirname, '..', 'dist');

const app = express();

// Proxy PocketBase API and admin to local PocketBase
app.use(
  '/api',
  createProxyMiddleware({
    target: POCKETBASE_INTERNAL,
    changeOrigin: true,
    ws: true,
  })
);
app.use(
  '/_',
  createProxyMiddleware({
    target: POCKETBASE_INTERNAL,
    changeOrigin: true,
    ws: true,
  })
);

// Serve static build (SPA)
app.use(express.static(DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WorkTrack Pro server: http://0.0.0.0:${PORT}`);
  console.log(`PocketBase proxy: ${POCKETBASE_INTERNAL}`);
  console.log('Ready for Cloudflare Tunnel.');
});
