'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { getPool } = require('./db');
const M = require('./middleware');
const { HttpError } = require('./services');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy || false);

// ---- security headers ----
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(M.attachUser);

// ---- API ----
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, M.csrfGuard);
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---- pages: each role's page is only served to signed-in users of that view ----
const pub = path.join(__dirname, '..', 'public');
app.get('/client.html', M.pageGuard('client'), (req, res) => res.sendFile(path.join(pub, 'client.html')));
app.get('/seller.html', M.pageGuard('seller'), (req, res) => res.sendFile(path.join(pub, 'seller.html')));
app.get('/admin.html', M.pageGuard('admin'), (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(pub, { index: false, etag: true, dotfiles: 'deny', setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));   // always revalidate so updates show up

// ---- errors ----
app.use((err, req, res, next) => {          // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  if (err.number === 2627 || err.number === 2601) return res.status(409).json({ error: 'That value already exists.' });
  if (err.number === 547) return res.status(409).json({ error: 'This record is in use and cannot be changed that way.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

getPool().then(() => {
  if (config.isProd && !config.secureCookies) console.warn('WARNING: production is running without SECURE_COOKIES=1. Serve it over HTTPS and set SECURE_COOKIES=1.');
  app.listen(config.port, () => console.log(`[${config.env.toUpperCase()}] L'Or de Cambodge POS running at http://localhost:${config.port}/login.html  (database: ${config.db.database})`));
}).catch((e) => { console.error('Cannot connect to SQL Server:', e.message); process.exit(1); });
