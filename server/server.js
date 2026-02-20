/**
 * Production server for WorkTrack Pro.
 * Serves the Vite build and proxies /api and /_ to PocketBase.
 * Also includes Trello attachment proxy to bypass CORS.
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

// Trello attachment proxy endpoint (bypasses CORS)
app.get('/api/trello-attachment/:cardId/:attachmentId/:filename(*)', async (req, res) => {
  try {
    const { cardId, attachmentId, filename } = req.params;
    const { key, token } = req.query;

    if (!key || !token) {
      return res.status(400).json({ error: 'Missing key or token query parameters' });
    }

    // Build Trello API URL
    const encodedFilename = encodeURIComponent(filename);
    const trelloUrl = `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}/download/${encodedFilename}?key=${key}&token=${token}`;

    // Fetch from Trello
    const trelloResponse = await fetch(trelloUrl, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
      },
    });

    if (!trelloResponse.ok) {
      const errorText = await trelloResponse.text();
      console.error(`Trello API error (${trelloResponse.status}):`, errorText);
      return res.status(trelloResponse.status).json({
        error: `Trello API error: ${trelloResponse.status}`,
        details: errorText.substring(0, 200),
      });
    }

    // Get content type and content
    const contentType = trelloResponse.headers.get('content-type') || 'application/octet-stream';
    const contentLength = trelloResponse.headers.get('content-length');

    // Set response headers
    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the response
    const arrayBuffer = await trelloResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('Trello proxy error:', error);
    res.status(500).json({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

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
