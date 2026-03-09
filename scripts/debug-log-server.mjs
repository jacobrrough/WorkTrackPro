/**
 * Debug log server: receives POST from app and appends NDJSON to debug-7c14cd.log in project root.
 * Tries ports 7243..7262 until one is free. Run: node scripts/debug-log-server.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, '..', 'debug-7c14cd.log');
const PORT_START = Number(process.env.DEBUG_LOG_PORT) || 7243;
const PORT_END = PORT_START + 20;

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Debug-Session-Id',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url && req.url.startsWith('/ingest/')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const line =
          JSON.stringify({ ...payload, timestamp: payload.timestamp ?? Date.now() }) + '\n';
        fs.appendFileSync(LOG_PATH, line);
      } catch (e) {
        fs.appendFileSync(LOG_PATH, JSON.stringify({ error: String(e), raw: body }) + '\n');
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end('{}');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

function tryListen(port) {
  if (port > PORT_END) {
    console.error(`No free port in range ${PORT_START}..${PORT_END}`);
    process.exit(1);
  }
  server.once('listening', () => {
    console.log(`Debug log server: http://127.0.0.1:${port} → ${LOG_PATH}`);
  });
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      tryListen(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1');
}
tryListen(PORT_START);
