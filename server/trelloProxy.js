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
    const encodedFilename = encodeURIComponent(filename);
    const trelloUrl = `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}/download/${encodedFilename}?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;

    const trelloResponse = await fetch(trelloUrl, {
      method: 'GET',
      headers: { Accept: '*/*' },
    });

    if (!trelloResponse.ok) {
      const errorText = await trelloResponse.text();
      console.error(`Trello API error (${trelloResponse.status}):`, errorText.substring(0, 300));
      res.setHeader('Content-Type', 'application/json');
      return res.status(trelloResponse.status).json({
        error: `Trello API error: ${trelloResponse.status}`,
        details: errorText.substring(0, 200),
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
