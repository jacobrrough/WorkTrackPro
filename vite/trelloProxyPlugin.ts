import type { Plugin } from 'vite';

const TRELLO_PROXY_PREFIX = '/api/trello-attachment/';

export function trelloProxyPlugin(): Plugin {
  return {
    name: 'trello-attachment-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || !req.url?.startsWith(TRELLO_PROXY_PREFIX)) {
          next();
          return;
        }

        (async () => {
          const url = new URL(req.url as string, `http://${req.headers.host}`);
          const pathParts = url.pathname.slice(TRELLO_PROXY_PREFIX.length).split('/');
          if (pathParts.length < 3) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Invalid path: need /api/trello-attachment/cardId/attachmentId/filename',
              })
            );
            return;
          }

          const [cardId, attachmentId, ...filenameParts] = pathParts;
          const filename = filenameParts.join('/');
          const key = url.searchParams.get('key');
          const token = url.searchParams.get('token');
          const sourceUrl = url.searchParams.get('sourceUrl');

          if (!key || !token) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing key or token query parameters' }));
            return;
          }

          let decodedFilename = filename;
          try {
            decodedFilename = decodeURIComponent(filename);
          } catch {
            // use as-is
          }

          const withAuth = (target: string): string => {
            try {
              const parsed = new URL(target);
              if (!parsed.hostname.toLowerCase().endsWith('trello.com')) return target;
              if (!parsed.searchParams.get('key')) parsed.searchParams.set('key', key);
              if (!parsed.searchParams.get('token')) parsed.searchParams.set('token', token);
              return parsed.toString();
            } catch {
              return target;
            }
          };

          const candidates: string[] = [];
          if (sourceUrl) candidates.push(withAuth(sourceUrl));
          const encodedFilename = encodeURIComponent(decodedFilename);
          candidates.push(
            `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}/download/${encodedFilename}?key=${encodeURIComponent(
              key
            )}&token=${encodeURIComponent(token)}`
          );

          // Metadata lookup fallback: retrieve canonical attachment URL then fetch it.
          const metadataUrl = `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}?fields=url&key=${encodeURIComponent(
            key
          )}&token=${encodeURIComponent(token)}`;
          try {
            const metaRes = await fetch(metadataUrl, { method: 'GET', headers: { Accept: 'application/json' } });
            if (metaRes.ok) {
              const meta = (await metaRes.json()) as { url?: string };
              if (meta.url) candidates.push(withAuth(meta.url));
            }
          } catch {
            // best-effort
          }

          let lastStatus = 500;
          let lastBody = 'All Trello attachment fetch candidates failed';
          for (const candidate of candidates) {
            const trelloRes = await fetch(candidate, { method: 'GET', headers: { Accept: '*/*' } });
            if (!trelloRes.ok) {
              lastStatus = trelloRes.status;
              lastBody = await trelloRes.text();
              continue;
            }

            const contentType = trelloRes.headers.get('content-type') || 'application/octet-stream';
            const contentLength = trelloRes.headers.get('content-length');
            res.statusCode = 200;
            res.setHeader('Content-Type', contentType);
            if (contentLength) res.setHeader('Content-Length', contentLength);
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${decodedFilename.replace(/"/g, '\\"')}"`
            );
            const buf = await trelloRes.arrayBuffer();
            res.end(Buffer.from(buf));
            return;
          }

          res.statusCode = lastStatus;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: `Trello API error: ${lastStatus}`,
              details: String(lastBody).substring(0, 200),
            })
          );
        })().catch((err) => {
          console.error('[Vite Trello proxy]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'Proxy error',
              message: err instanceof Error ? err.message : String(err),
            })
          );
        });
      });
    },
  };
}
