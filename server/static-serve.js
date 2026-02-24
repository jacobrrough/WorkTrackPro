/**
 * Minimal static server for production (Railway, etc.).
 * Serves the Vite build (dist) and SPA fallback. Reads PORT from env.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const DIST = path.join(__dirname, '..', 'dist');

const app = express();
app.use(express.static(DIST));
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serving at http://0.0.0.0:${PORT}`);
});
