import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const indexFile = path.join(distDir, 'index.html');
const host = '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const mimeByExt = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const ensureDist = () => {
  if (existsSync(indexFile)) {
    return;
  }

  console.warn('PocketBaseServer/dist missing. Running build script.');
  const buildResult = spawnSync(process.execPath, ['./build.mjs'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env,
  });

  if (buildResult.status !== 0 || !existsSync(indexFile)) {
    console.error('Unable to generate PocketBaseServer/dist for startup.');
    process.exit(1);
  }
};

const sendFile = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeByExt[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Failed to read file');
  });
  stream.pipe(res);
};

ensureDist();

const server = createServer(async (req, res) => {
  const requestUrl = req.url ?? '/';
  const pathname = decodeURIComponent(requestUrl.split('?')[0] || '/');
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = normalized === '/' ? '/index.html' : normalized;
  const filePath = path.join(distDir, requestedPath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      sendFile(res, filePath);
      return;
    }
  } catch {
    // Fall through to SPA fallback / 404 handling below.
  }

  if (path.extname(requestedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  sendFile(res, indexFile);
});

server.listen(port, host, () => {
  console.log(`PocketBaseServer compat serving at http://${host}:${port}`);
});

