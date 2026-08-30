import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import askHandler from '../api/ask.js';
import indexHandler from '../api/index.js';
import uploadHandler from '../api/upload.js';
import aiHandler from '../api/ai.js';
import draftsHandler from '../api/drafts.js';
import meHandler from '../api/me.js';
import configHandler from '../api/config.js';
import assetsHandler from '../api/assets.js';
import sharesHandler from '../serverless/teaching-share-api.js';
import authProxy from '../serverless/auth-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const app = express();
const port = Number(process.env.PORT || 8787);

// Keep byte uploads ahead of JSON parsing so the PDF stream remains untouched.
app.post('/api/upload', uploadHandler);
app.post('/api/index/documents/upload', uploadHandler);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.on('finish', () => console.log(`[api] ${req.method} ${req.originalUrl} → ${res.statusCode}`));
  next();
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'live-teacher-guide' }));
app.get('/api/config', configHandler);
app.all('/api/auth', authProxy);
app.post('/api/ask', askHandler);
app.all('/api/me', meHandler);
app.use('/api/ai', aiHandler);
app.use('/api/drafts', draftsHandler);
app.use('/api/assets', assetsHandler);
app.use('/api/shares', sharesHandler);
app.use('/api/index', indexHandler);
app.use(express.static(path.join(rootDir, 'dist')));
app.get('*splat', (_req, res) => res.sendFile(path.join(rootDir, 'dist/index.html')));
app.listen(port, '127.0.0.1', () => console.log(`活教参 Demo: http://127.0.0.1:${port}`));
