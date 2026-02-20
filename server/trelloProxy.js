/**
 * Trello Attachment Proxy Server
 * Proxies Trello attachment downloads to bypass CORS restrictions
 * Runs on port 3001 during development
 */
import express from 'express';

const app = express();
const PORT = Number(process.env.TRELLO_PROXY_PORT) || 3001;

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Proxy endpoint: /api/trello-attachment/:cardId/:attachmentId/:filename
app.get('/api/trello-attachment/:cardId/:attachmentId/:filename(*)', async (req, res) => {
  try {
    const { cardId, attachmentId, filename: rawFilename } = req.params;
    const { key, token } = req.query;

    if (!key || !token) {
      return res.status(400).json({ error: 'Missing key or token query parameters' });
    }

    let filename = typeof rawFilename === 'string' ? rawFilename : '';
    try {
      filename = decodeURIComponent(filename);
    } catch {
      // leave as-is if already decoded or invalid
    }
    const authHeader = `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`;
    const encodedFilename = encodeURIComponent(filename);
    const candidates = [
      `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}/download/${encodedFilename}`,
    ];

    // Fetch metadata for canonical URL fallback.
    try {
      const metaRes = await fetch(
        `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}?fields=url`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: authHeader },
        }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta?.url) candidates.push(meta.url);
      }
    } catch {
      // best-effort
    }

    let trelloResponse = null;
    let lastStatus = 500;
    let lastError = 'All Trello attachment fetch candidates failed';
    for (const candidate of candidates) {
      const response = await fetch(candidate, {
        method: 'GET',
        headers: { Accept: '*/*', Authorization: authHeader },
      });
      if (response.ok) {
        trelloResponse = response;
        break;
      }
      lastStatus = response.status;
      lastError = await response.text();
    }

    if (!trelloResponse) {
      console.error(`Trello API error (${lastStatus}):`, String(lastError).substring(0, 300));
      res.setHeader('Content-Type', 'application/json');
      return res.status(lastStatus).json({
        error: `Trello API error: ${lastStatus}`,
        details: String(lastError).substring(0, 200),
      });
    }

    const contentType = trelloResponse.headers.get('content-type') || 'application/octet-stream';
    const contentLength = trelloResponse.headers.get('content-length');
    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '\\"')}"`);

    const arrayBuffer = await trelloResponse.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Trello proxy error:', error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'trello-proxy' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Trello attachment proxy running on http://127.0.0.1:${PORT}`);
});
