// src/web/server.ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './api.js';
import { createToursRouter } from './tours-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 17890;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createApiRouter());
app.use('/api/tours', createToursRouter());
// Serve the generated HTML reports and screenshots directly
app.use('/data', express.static(path.join(__dirname, '..', '..', '..', 'data')));

// SPA fallback — Express 5 requires named catch-all parameter
app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`klook-cli web dashboard: http://localhost:${PORT}`);
});
